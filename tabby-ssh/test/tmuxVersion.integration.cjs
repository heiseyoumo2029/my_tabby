/* Run on Linux CI with tmux, typescript and shell-quote installed. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const ts = require('typescript')
const shellQuote = require('shell-quote')
const vm = require('node:vm')

const source = fs.readFileSync('tabby-ssh/src/session/ssh.ts', 'utf8')
const tree = ts.createSourceFile('ssh.ts', source, ts.ScriptTarget.Latest, true)
const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name.text === 'SSHSession')
const query = type.members.find(x => x.name && x.name.getText(tree) === 'queryTmux')
const js = ts.transpileModule(`class QueryTest { ${query.getText(tree)} }\nexports.QueryTest = QueryTest`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

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
        return {
            data$: new Event(), extendedData$: new Event(), eof$: new Event(), closed$: new Event(),
            async close () {},
            async requestExec (command) {
                const child = spawn('/bin/sh', ['-c', command], { env: process.env })
                child.stdout.on('data', data => this.data$.emit(data))
                child.stderr.on('data', data => this.extendedData$.emit([1, data]))
                child.on('close', () => { this.eof$.emit(); this.closed$.emit() })
            },
        }
    }
}
const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports, russh: { AuthenticatedSSHClient }, shellQuote, Buffer, setTimeout, clearTimeout })

async function main () {
    const version = execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim()
    assert.equal(version, `tmux ${process.env.EXPECT_TMUX_VERSION}`)
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-tmux-ci-'))
    const first = path.join(temp, 'one space')
    const second = path.join(temp, 'two')
    fs.mkdirSync(first)
    fs.mkdirSync(second)
    process.env.TMUX_TMPDIR = temp
    delete process.env.TMUX
    const tmux = args => execFileSync('tmux', args, { encoding: 'utf8', env: process.env })
    try {
        tmux(['new-session', '-d', '-s', 'tabby-test', '-c', first, 'sleep 120'])
        tmux(['split-window', '-d', '-t', 'tabby-test', '-c', second, 'sleep 120'])
        const query = new moduleExports.QueryTest()
        query.ssh = new AuthenticatedSSHClient()
        const lines = (await query.queryTmux()).trim().split('\n')
        assert.equal(lines.length, 2)
        const panes = lines.map(line => {
            const match = /^(%[0-9]+) (.*)$/.exec(line)
            assert.ok(match, `unparseable pane: ${line}`)
            return match[1]
        })
        const dirs = await Promise.all(panes.map(async pane => (await query.queryTmux(pane)).trim()))
        assert.deepEqual(new Set(dirs), new Set([first, second]))
        const socket = tmux(['display-message', '-p', '#{socket_path}']).trim()
        assert.equal((await query.queryTmux(undefined, socket)).trim().split('\n').length, 2)
        assert.equal((await query.queryTmux(panes[0], socket, process.env.TMUX_BINARY)).trim(), dirs[0])
        console.log(`${version}: discovered ${panes.length} panes and their working directories`)
    } finally {
        try { tmux(['kill-server']) } catch {}
        fs.rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
