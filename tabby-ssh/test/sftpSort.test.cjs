/* Run in CI: node tabby-ssh/test/sftpSort.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const source = fs.readFileSync('tabby-ssh/src/session/sftpSort.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports })
const { sortSFTPFiles } = moduleExports
const file = (name, isDirectory, time) => ({ name, isDirectory, modified: new Date(time) })
const files = [
    file('z', false, '2024-01-02T00:00:00Z'),
    file('folderB', true, '2024-01-03T00:00:00Z'),
    file('b', false, '2024-01-01T00:00:00Z'),
    file('folderA', true, '2024-01-01T00:00:00Z'),
    file('a', false, '2024-01-01T00:00:00Z'),
    file('invalid', false, 'invalid'),
]
const names = (field, direction) => Array.from(sortSFTPFiles(files, field, direction), x => x.name)
assert.deepEqual(names('name', 'ascending'), ['folderA', 'folderB', 'a', 'b', 'invalid', 'z'])
assert.deepEqual(names('name', 'descending'), ['folderB', 'folderA', 'z', 'invalid', 'b', 'a'])
assert.deepEqual(names('modified', 'ascending'), ['folderA', 'folderB', 'a', 'b', 'z', 'invalid'])
assert.deepEqual(names('modified', 'descending'), ['folderB', 'folderA', 'z', 'a', 'b', 'invalid'])
assert.equal(files[0].name, 'z', 'sorting must not mutate the original array')
const panelSource = fs.readFileSync('tabby-ssh/src/components/sftpPanel.component.ts', 'utf8')
const tree = ts.createSourceFile('sftpPanel.component.ts', panelSource, ts.ScriptTarget.Latest, true)
const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name?.text === 'SFTPPanelComponent')
const select = type.members.find(x => x.name?.getText(tree) === 'selectSort').getText(tree)
const filter = type.members.find(x => x.name?.getText(tree) === 'updateFilteredList').getText(tree)
const panelJS = ts.transpileModule(`class Panel { ${select} ${filter} }\nexports.Panel = Panel`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText
const panelExports = {}
vm.runInNewContext(panelJS, { exports: panelExports, sortSFTPFiles })
const panel = new panelExports.Panel()
panel.fileList = files
panel.showFilter = true
panel.filterText = 'a'
const changes = []
panel.sortFieldChange = { emit: value => changes.push(value) }
panel.sortDirectionChange = { emit: value => changes.push(value) }
panel.selectSort('modified', 'descending')
assert.deepEqual(changes, ['modified', 'descending'])
assert.deepEqual(Array.from(panel.filteredFileList, x => x.name), ['folderA', 'a', 'invalid'])
console.log('sftpSort: name/time ascending/descending and invalid timestamps passed')
