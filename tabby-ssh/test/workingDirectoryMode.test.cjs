/* Run in CI: node tabby-ssh/test/workingDirectoryMode.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync('tabby-ssh/src/components/sshTab.component.ts', 'utf8')
const tree = ts.createSourceFile('sshTab.component.ts', source, ts.ScriptTarget.Latest, true)
const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name?.text === 'SSHTabComponent')
const method = type.members.find(x => x.name?.getText(tree) === 'resolveCurrentWorkingDirectory')
const js = ts.transpileModule(`class Tab { ${method.getText(tree)} }\nexports.Tab = Tab`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const out = {}
vm.runInNewContext(js, { exports: out })
async function main () {
    const tab = new out.Tab()
    tab.directoryMode = 'auto'
    tab.tmuxSocketPath = '/tmp/socket'
    tab.tmuxExecutablePath = '/usr/bin/tmux'
    tab.session = { open: true, shell: {}, getWorkingDirectory: async () => '/reported' }
    tab.sshSession = { queryCurrentWorkingDirectory: async (socket, executable, shell) => {
        assert.equal(shell, tab.session.shell)
        return '/auto'
    }, queryTmux: async () => '/pane\n' }
    assert.equal(await tab.resolveCurrentWorkingDirectory(), '/auto')
    tab.sshSession.queryCurrentWorkingDirectory = async () => null
    assert.equal(await tab.resolveCurrentWorkingDirectory(), '/reported')
    tab.sshSession.queryCurrentWorkingDirectory = async () => { throw Error('ambiguous') }
    await assert.rejects(tab.resolveCurrentWorkingDirectory(), /ambiguous/)
    tab.sshSession.queryCurrentWorkingDirectory = async () => { throw Object.assign(Error('no PTY'), { allowReport: true }) }
    assert.equal(await tab.resolveCurrentWorkingDirectory(), '/reported')
    tab.session.getWorkingDirectory = async () => null
    await assert.rejects(tab.resolveCurrentWorkingDirectory(), /no PTY/)
    tab.session.open = false
    assert.equal(await tab.resolveCurrentWorkingDirectory(), null)
    tab.directoryMode = 'manual'
    tab.manualWorkingDirectory = '/manual path'
    tab.tmuxSelectedPane = '%5'
    assert.equal(await tab.resolveCurrentWorkingDirectory(), '/manual path')
    tab.manualWorkingDirectory = ''
    assert.equal(await tab.resolveCurrentWorkingDirectory(), '/pane')
    tab.tmuxSelectedPane = ''
    assert.equal(await tab.resolveCurrentWorkingDirectory(), null)
    console.log('working directory mode: auto, fallback, ambiguity and manual modes passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
