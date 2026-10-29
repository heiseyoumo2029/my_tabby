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
    error = ''
    checking = false

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
