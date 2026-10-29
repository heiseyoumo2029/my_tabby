/* Run in CI: node tabby-ssh/test/reconnectAll.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const text = fs.readFileSync('tabby-ssh/src/components/sshTab.component.ts', 'utf8')
const tree = ts.createSourceFile('sshTab.component.ts', text, ts.ScriptTarget.Latest, true)
const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name?.text === 'SSHTabComponent')
const method = type.members.find(x => x.name?.getText(tree) === 'reconnectAllSSH').getText(tree)
const program = `class SSHTabComponent { get reconnectingAllSSH () { return SSHTabComponent.reconnectingAllSSH } ${method} }\nexports.SSHTabComponent = SSHTabComponent`
const js = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
class SplitTabComponent { constructor (tabs) { this.tabs = tabs } getAllTabs () { return this.tabs } }
const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports, SplitTabComponent, _: x => x })
const { SSHTabComponent } = moduleExports

function tab (open, connecting = false) {
    const t = new SSHTabComponent()
    t.session = { open }
    t.connectingSSH = connecting
    t.calls = 0
    t.reconnect = async () => { t.calls++; t.session.open = true }
    return t
}
async function main () {
    const active = tab(true)
    const disconnected = tab(false)
    const connecting = tab(false, true)
    const caller = tab(true)
    let choice = 0
    caller.app = { tabs: [active, new SplitTabComponent([disconnected, connecting]), caller] }
    caller.platform = { showMessageBox: async () => ({ response: choice }) }
    caller.translate = { instant: x => x }
    caller.notifications = { notice: () => {}, error: () => {} }
    caller.logger = { error: () => {} }
    await caller.reconnectAllSSH()
    assert.equal(active.calls, 0)
    assert.equal(disconnected.calls, 1)
    assert.equal(connecting.calls, 0)
    assert.equal(caller.calls, 0)
    choice = 1
    await caller.reconnectAllSSH()
    assert.equal(active.calls, 1)
    assert.equal(disconnected.calls, 2)
    assert.equal(connecting.calls, 0)
    assert.equal(caller.calls, 1)
    choice = 2
    await caller.reconnectAllSSH()
    assert.equal(active.calls, 1)
    assert.equal(disconnected.calls, 2)
    console.log('reconnectAll: disconnected-only, all, connecting and cancel passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
