/* Run in CI: node tabby-core/test-transfer-location.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('tabby-core/src/components/transfersMenu.component.ts', 'utf8')
const tree = ts.createSourceFile('transfersMenu.component.ts', source, ts.ScriptTarget.Latest, true)
const component = tree.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'TransfersMenuComponent')
const method = component.members.find(node => node.name?.getText(tree) === 'showTransfer').getText(tree)
const js = ts.transpileModule(`class Menu { ${method} }\nexports.Menu = Menu`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
class FileDownload { getLocalPath () { return '/tmp/file' } isCancelled () { return false } }
class DirectoryDownload { getLocalPath () { return '/tmp/folder' } isCancelled () { return false } }
const out = {}
vm.runInNewContext(js, { exports: out, FileDownload, DirectoryDownload })
const actions = []
const menu = new out.Menu()
menu.platform = { showItemInFolder: p => actions.push(['file', p]), openPath: p => actions.push(['folder', p]) }
menu.showTransfer(new FileDownload())
menu.showTransfer(new DirectoryDownload())
menu.showTransfer({ getLocalPath: () => null, isCancelled: () => false })
menu.showTransfer({ getLocalPath: () => '/tmp/cancelled', isCancelled: () => true })
assert.deepEqual(actions, [['file', '/tmp/file'], ['folder', '/tmp/folder']])
console.log('transfer location: local file, directory and unsupported transfers passed')
