import * as russh from 'russh'
import { FileTransfer } from 'tabby-core'
import { SFTPFile, SFTPFileHandle, SFTPSession } from './sftp'

/** A bounded-memory transfer between two already authenticated SFTP sessions. */
export class TabFileTransfer extends FileTransfer {
    private done = false

    constructor (private file: SFTPFile) {
        super()
    }

    getName (): string { return this.file.name }
    getSize (): number { return this.file.size }
    isComplete (): boolean { return this.done }
    close (): void {
        // The asynchronous transfer loop owns and closes both handles.
    }

    async run (source: SFTPSession, destination: SFTPSession, destinationPath: string): Promise<void> {
        let input: SFTPFileHandle|null = null
        let output: SFTPFileHandle|null = null
        let created = false
        try {
            input = await source.open(this.file.fullPath, russh.OPEN_READ)
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
            this.done = true
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
