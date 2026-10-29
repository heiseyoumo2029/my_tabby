/* Run in CI: node tabby-ssh/test/sshControls.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path').posix
const ts = require('typescript')
const vm = require('node:vm')

function method (file, className, name) {
    const text = fs.readFileSync(file, 'utf8')
    const tree = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name?.text === className)
    return type.members.find(x => x.name?.getText(tree) === name).getText(tree)
}
const copy = method('tabby-ssh/src/components/sshTab.component.ts', 'SSHTabComponent', 'copyConnectionDetail')
const confirm = method('tabby-ssh/src/components/sftpTransferDestinationModal.component.ts', 'SFTPTransferDestinationModalComponent', 'confirm')
const cancel = method('tabby-ssh/src/components/sftpTransferDestinationModal.component.ts', 'SFTPTransferDestinationModalComponent', 'cancel')
const program = `class Copy { ${copy} } class Destination { ${confirm} ${cancel} }\nexports.Copy = Copy; exports.Destination = Destination`
const js = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports, path })

async function main () {
    const copied = []
    const c = new moduleExports.Copy()
    c.profile = { options: { host: '192.168.1.2', port: 2222 } }
    c.platform = { setClipboard: content => copied.push(content.text) }
    c.copyConnectionDetail('host')
    c.copyConnectionDetail('port')
    c.copyConnectionDetail('address')
    c.profile.options.host = '2001:db8::1'
    c.profile.options.port = undefined
    c.copyConnectionDetail('address')
    assert.deepEqual(copied, ['192.168.1.2', '2222', '192.168.1.2:2222', '[2001:db8::1]:22'])

    const d = new moduleExports.Destination()
    const closed = []
    d.translate = { instant: message => message }
    d.modal = { close: value => closed.push(value), dismiss: () => closed.push('dismissed') }
    d.session = { openSFTP: async () => ({ stat: async name => ({ isDirectory: name !== '/file' }) }) }
    d.destinationPath = 'relative'
    await d.confirm()
    assert.equal(d.error, 'Enter an absolute destination directory')
    assert.equal(closed.length, 0)
    d.destinationPath = '/file'
    await d.confirm()
    assert.equal(d.error, 'Destination is not a directory')
    assert.equal(closed.length, 0)
    d.destinationPath = '/dir with spaces'
    await d.confirm()
    assert.equal(closed[0], '/dir with spaces')
    d.cancel()
    assert.equal(closed[1], 'dismissed')
    console.log('sshControls: copy and destination validation passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
