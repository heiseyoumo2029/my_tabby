import { SFTPFile } from './sftp'

export type SFTPSortField = 'name'|'modified'
export type SFTPSortDirection = 'ascending'|'descending'

/** Sort within directory and file groups, preserving the panel's directory-first behavior. */
export function sortSFTPFiles (files: SFTPFile[], field: SFTPSortField, direction: SFTPSortDirection): SFTPFile[] {
    return [...files].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
        }
        const nameOrder = a.name.localeCompare(b.name)
        const multiplier = direction === 'ascending' ? 1 : -1
        if (field === 'name') {
            return multiplier * nameOrder
        }
        const aTime = a.modified.getTime()
        const bTime = b.modified.getTime()
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
            return Number.isNaN(aTime) === Number.isNaN(bTime) ? nameOrder : Number.isNaN(aTime) ? 1 : -1
        }
        return multiplier * (aTime - bTime) || nameOrder
    })
}
