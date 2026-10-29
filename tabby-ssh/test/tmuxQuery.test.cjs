/* Run with: node tabby-ssh/test/tmuxQuery.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const vm = require('node:vm')

const source = fs.readFileSync('tabby-ssh/src/session/ssh.ts', 'utf8')
const tree = ts.createSourceFile('ssh.ts', source, ts.ScriptTarget.Latest, true)
const session = tree.statements.find(x => ts.isClassDeclaration(x) && x.name.text === 'SSHSession')
const query = session.members.find(x => x.name && x.name.getText(tree) === 'queryTmux')
const program = `class QueryTest { ${query.getText(tree)} }\nexports.QueryTest = QueryTest`
const js = ts.transpileModule(program, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText

class Event {
    constructor () { this.listeners = [] }
    subscribe (listener) {
        this.listeners.push(listener)
        return { unsubscribe: () => { this.listeners = this.listeners.filter(x => x !== listener) } }
    }
    emit (value) { for (const listener of this.listeners) listener(value) }
}
class AuthenticatedSSHClient {
    async openSessionChannel () { return {} }
    async activateChannel () {
        const channel = this.channel = {
            data$: new Event(), eof$: new Event(), closed$: new Event(),
            async close () { this.closed = true },
            async requestExec (command) {
                this.command = command
                queueMicrotask(() => {
                    this.data$.emit(Buffer.from(command.includes('list-panes') ? '%1 test:0.1\n' : '/tmp/example\n'))
                    this.eof$.emit()
                })
            },
        }
        return channel
    }
}
const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports, russh: { AuthenticatedSSHClient }, Buffer, setTimeout, clearTimeout })

async function main () {
    const query = new moduleExports.QueryTest()
    const ssh = query.ssh = new AuthenticatedSSHClient()
    assert.equal(await query.queryTmux(), '%1 test:0.1\n')
    assert.match(ssh.channel.command, /^tmux list-panes /)
    assert.equal(ssh.channel.closed, true)
    assert.equal(await query.queryTmux('%1'), '/tmp/example\n')
    assert.match(ssh.channel.command, /-t %1 /)
    await assert.rejects(query.queryTmux('%1;echo bad'), /Invalid tmux pane ID/)
    console.log('tmuxQuery: 3 tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
