import { Injectable } from '@angular/core'
import { NgbModal } from '@ng-bootstrap/ng-bootstrap'
import { AppService, MenuItemOptions, NotificationsService, PlatformService, SplitTabComponent, TranslateService, HostAppService, Platform } from 'tabby-core'
import { posix as path } from 'path'
import { SFTPSession, SFTPFile } from './session/sftp'
import { SFTPContextMenuItemProvider } from './api'
import { SFTPDeleteModalComponent } from './components/sftpDeleteModal.component'
import { SFTPPanelComponent } from './components/sftpPanel.component'
import { SSHTabComponent } from './components/sshTab.component'
import { TabFileTransfer } from './session/tabTransfer'
import { SFTPTransferDestinationModalComponent } from './components/sftpTransferDestinationModal.component'


/** @hidden */
@Injectable()
export class CommonSFTPContextMenu extends SFTPContextMenuItemProvider {
    weight = 10

    constructor (
        private platform: PlatformService,
        private ngbModal: NgbModal,
        private translate: TranslateService,
        private hostApp: HostAppService,
        private app: AppService,
        private notifications: NotificationsService,
    ) {
        super()
    }

    async getItems (item: SFTPFile, panel: SFTPPanelComponent): Promise<MenuItemOptions[]> {
        const items: MenuItemOptions[] = [
            {
                click: async () => {
                    await panel.openCreateDirectoryModal()
                },
                label: this.translate.instant('Create directory'),
            },
        ]

        // Add download folder option for directories (only in electron)
        if (item.isDirectory && this.hostApp.platform !== Platform.Web) {
            items.push({
                click: () => panel.downloadFolder(item),
                label: this.translate.instant('Download directory'),
            })
        }

        if (!item.isDirectory) {
            items.push({
                click: () => panel.downloadItem(item),
                label: this.translate.instant('Download'),
            })
        }

        if (!item.isDirectory && !item.isSymlink && item.name !== '.' && item.name !== '..' && path.basename(item.name) === item.name) {
            const targets = this.app.tabs.flatMap(tab => tab instanceof SplitTabComponent ? tab.getAllTabs() : [tab])
                .filter((tab): tab is SSHTabComponent => tab instanceof SSHTabComponent && !!tab.session?.open && !!tab.sshSession)
            if (targets.length) {
                items.push({
                    label: this.translate.instant('Send to SSH tab'),
                    submenu: targets.map(tab => ({
                        label: `${tab.profile.options.user}@${tab.profile.options.host}:${tab.profile.options.port ?? 22} — ${tab.sftpPath}`,
                        click: () => { this.transferToTab(item, panel, tab) },
                    })),
                })
            }
        }

        items.push({
            click: async () => {
                if ((await this.platform.showMessageBox({
                    type: 'warning',
                    message: this.translate.instant('Delete {fullPath}?', item),
                    defaultId: 0,
                    cancelId: 1,
                    buttons: [
                        this.translate.instant('Delete'),
                        this.translate.instant('Cancel'),
                    ],
                })).response === 0) {
                    await this.deleteItem(item, panel.sftp)
                    panel.navigate(panel.path)
                }
            },
            label: this.translate.instant('Delete'),
        })

        return items
    }

    private async transferToTab (item: SFTPFile, panel: SFTPPanelComponent, tab: SSHTabComponent): Promise<void> {
        try {
            if (!tab.session?.open || !tab.sshSession) {
                throw new Error('Target SSH session is disconnected')
            }
            const sshSession = tab.sshSession
            const modal = this.ngbModal.open(SFTPTransferDestinationModalComponent)
            modal.componentInstance.session = sshSession
            modal.componentInstance.destinationPath = tab.sftpPath
            modal.componentInstance.target = `${tab.profile.options.user}@${tab.profile.options.host}:${tab.profile.options.port ?? 22}`
            modal.componentInstance.fileName = item.name
            const directory: string|null = await modal.result.catch(() => null)
            if (typeof directory !== 'string') {
                return
            }
            if (!tab.session?.open || tab.sshSession !== sshSession) {
                throw new Error('Target SSH session is disconnected')
            }
            const destinationPath = path.join(directory, item.name)
            if (sshSession === panel.session && destinationPath === item.fullPath) {
                throw new Error('Source and destination are the same file')
            }
            const destination = await sshSession.openSFTP()
            const transfer = new TabFileTransfer(item)
            this.platform.registerFileTransfer(transfer)
            try {
                await transfer.run(panel.sftp, destination, destinationPath)
                this.notifications.notice(this.translate.instant('File transfer completed'))
            } catch (error) {
                if (!transfer.isCancelled()) {
                    transfer.cancel()
                    throw error
                }
            }
        } catch (error) {
            this.notifications.error(`${this.translate.instant('File transfer failed')}: ${error.message}`)
        }
    }

    async deleteItem (item: SFTPFile, session: SFTPSession): Promise<void> {
        const modal = this.ngbModal.open(SFTPDeleteModalComponent)
        modal.componentInstance.item = item
        modal.componentInstance.sftp = session
        await modal.result.catch(() => null)
    }
}
