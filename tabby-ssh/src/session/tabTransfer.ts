import * as russh from 'russh'
import { FileTransfer } from 'tabby-core'
import { SFTPFile, SFTPFileHandle, SFTPSession } from './sftp'
import { posix as path } from 'path'

/** A bounded-memory transfer between two already authenticated SFTP sessions. */
export class TabFileTransfer extends FileTransfer {
    private done = false
    private transferSize = 0

    constructor (private file: SFTPFile) {
        super()
        this.transferSize = file.isDirectory ? 0 : file.size
    }

    getName (): string { return this.file.name }
    getSize (): number { return this.transferSize }
    isComplete (): boolean { return this.done }
    close (): void {
        // The asynchronous transfer loop owns and closes both handles.
    }

    async run (source: SFTPSession, destination: SFTPSession, destinationPath: string): Promise<void> {
        if (this.file.isDirectory) {
            await this.runDirectory(source, destination, destinationPath)
            return
        }
        await this.copyFile(source, destination, this.file.fullPath, destinationPath)
        this.done = true
    }

    private async runDirectory (source: SFTPSession, destination: SFTPSession, destinationPath: string): Promise<void> {
        // Reserve the destination before scanning, so existing directories are never merged.
        await destination.mkdir(destinationPath)
        const createdDirectories = [destinationPath]
        const createdFiles: string[] = []
        try {
            const entries: { file: SFTPFile, relative: string }[] = []
            const scan = async (folder: string, relative: string): Promise<void> => {
                if (this.isCancelled()) { throw new Error('Transfer cancelled') }
                for (const file of await source.readdir(folder)) {
                    if (file.name === '.' || file.name === '..') { continue }
                    if (!file.name || path.basename(file.name) !== file.name || file.name.includes('\\')) {
                        throw new Error('Invalid remote filename')
                    }
                    if (file.isSymlink) { throw new Error('Directory contains a symbolic link') }
                    const child = path.join(relative, file.name)
                    entries.push({ file, relative: child })
                    if (file.isDirectory) {
                        await scan(file.fullPath, child)
                    } else {
                        this.transferSize += file.size
                    }
                }
            }
            await scan(this.file.fullPath, '')
            for (const entry of entries) {
                if (this.isCancelled()) { throw new Error('Transfer cancelled') }
                const target = path.join(destinationPath, entry.relative)
                this.setStatus(entry.relative)
                if (entry.file.isDirectory) {
                    await destination.mkdir(target)
                    createdDirectories.push(target)
                } else {
                    await this.copyFile(source, destination, entry.file.fullPath, target)
                    createdFiles.push(target)
                }
            }
            if (this.isCancelled()) { throw new Error('Transfer cancelled') }
            this.setStatus('')
            this.done = true
        } catch (error) {
            for (const file of createdFiles.reverse()) { await destination.unlink(file).catch(() => null) }
            for (const directory of createdDirectories.reverse()) { await destination.rmdir(directory).catch(() => null) }
            throw error
        }
    }

    private async copyFile (source: SFTPSession, destination: SFTPSession, sourcePath: string, destinationPath: string): Promise<void> {
        let input: SFTPFileHandle|null = null
        let output: SFTPFileHandle|null = null
        let created = false
        try {
            input = await source.open(sourcePath, russh.OPEN_READ)
            // SFTP v3 SSH_FXF_EXCL (0x20), together with CREATE, guarantees
            // that an existing file is never truncated or overwritten.
            output = await destination.open(destinationPath, russh.OPEN_WRITE | russh.OPEN_CREATE | 0x20)
            created = true
            while (!this.isCancelled()) {
                const chunk = await input.read()
                if (!chunk.length) {
                    break
                }
                if (this.isCancelled()) {
                    break
                }
                await output.write(chunk)
                this.increaseProgress(chunk.length)
            }
            if (this.isCancelled()) {
                throw new Error('Transfer cancelled')
            }
            await output.close()
            output = null
            await input.close()
            input = null
            if (this.isCancelled()) {
                throw new Error('Transfer cancelled')
            }
        } catch (error) {
            await output?.close().catch(() => null)
            await input?.close().catch(() => null)
            if (created) {
                await destination.unlink(destinationPath).catch(() => null)
            }
            throw error
        }
    }
}
