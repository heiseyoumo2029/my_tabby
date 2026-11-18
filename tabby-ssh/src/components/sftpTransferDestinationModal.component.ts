import { Component, Input } from '@angular/core'
import { NgbActiveModal } from '@ng-bootstrap/ng-bootstrap'
import { TranslateService } from 'tabby-core'
import { posix as path } from 'path'
import { SSHSession } from '../session/ssh'

/** @hidden */
@Component({
    templateUrl: './sftpTransferDestinationModal.component.pug',
})
export class SFTPTransferDestinationModalComponent {
    @Input() session: SSHSession
    @Input() destinationPath = '/'
    @Input() target = ''
    @Input() fileName = ''
    @Input() shellPath = ''
    @Input() sftpPath = '/'
    @Input() tmuxSocketPath = ''
    @Input() tmuxExecutablePath = ''
    panes: { id: string, label: string }[] = []
    loadingPanes = false
    error = ''
    checking = false

    async loadTmuxPanes (): Promise<void> {
        if (this.loadingPanes) { return }
        this.loadingPanes = true
        this.error = ''
        try {
            const output = await this.session.queryTmux(undefined, this.tmuxSocketPath, this.tmuxExecutablePath)
            this.panes = output.split('\n').map(line => /^\s*(%[0-9]+)(?:\s+(.*?))?\s*$/.exec(line))
                .filter((match): match is RegExpExecArray => !!match)
                .map(match => ({ id: match[1], label: `${match[2] ?? ''} (${match[1]})` }))
            if (!this.panes.length) { this.error = this.translate.instant('No tmux panes found') }
        } catch (error) {
            this.error = `${this.translate.instant('Could not list tmux panes')}: ${error.message}`
        } finally {
            this.loadingPanes = false
        }
    }

    async selectTmuxPane (id: string): Promise<void> {
        try {
            const cwd = (await this.session.queryTmux(id, this.tmuxSocketPath, this.tmuxExecutablePath)).replace(/\n$/, '')
            if (!path.isAbsolute(cwd)) { throw new Error('tmux did not return an absolute path') }
            this.destinationPath = cwd
            this.error = ''
        } catch (error) {
            this.error = `${this.translate.instant('Could not get tmux pane directory')}: ${error.message}`
        }
    }

    constructor (
        private modal: NgbActiveModal,
        private translate: TranslateService,
    ) { }

    async confirm (): Promise<void> {
        if (this.checking) {
            return
        }
        if (!path.isAbsolute(this.destinationPath)) {
            this.error = this.translate.instant('Enter an absolute destination directory')
            return
        }
        this.checking = true
        this.error = ''
        try {
            const sftp = await this.session.openSFTP()
            const directory = await sftp.stat(this.destinationPath)
            if (!directory.isDirectory) {
                this.error = this.translate.instant('Destination is not a directory')
                return
            }
            this.modal.close(this.destinationPath)
        } catch (error) {
            this.error = `${this.translate.instant('Cannot access destination directory')}: ${error.message}`
        } finally {
            this.checking = false
        }
    }

    cancel (): void {
        this.modal.dismiss()
    }
}
