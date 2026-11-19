/* Run on Linux CI with tmux and an isolated local SSH server. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')
const shellQuote = require('shell-quote')
const russh = require('russh')
const vm = require('node:vm')

const source = fs.readFileSync('tabby-ssh/src/session/ssh.ts', 'utf8')
const tree = ts.createSourceFile('ssh.ts', source, ts.ScriptTarget.Latest, true)
const type = tree.statements.find(x => ts.isClassDeclaration(x) && x.name.text === 'SSHSession')
const methods = ['queryTmux', 'queryCurrentWorkingDirectory', 'runDirectoryProbe', 'openShellChannel',
    'startShellChannel', 'listLoginTerminals', 'bindLoginTerminal', 'shellStartQueue', 'shellIdentities', 'shellsStarted']
const members = methods.map(name => type.members.find(x => x.name?.getText(tree) === name).getText(tree)).join('\n')
const probeSource = fs.readFileSync('tabby-ssh/src/session/workingDirectoryProbe.ts', 'utf8')
const probeJS = ts.transpileModule(probeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const probeExports = {}
vm.runInNewContext(probeJS, { exports: probeExports })
const js = ts.transpileModule(`class QueryTest { ${members} }\nexports.QueryTest = QueryTest`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText

const moduleExports = {}
vm.runInNewContext(js, { exports: moduleExports, russh, shellQuote, WORKING_DIRECTORY_PROBE: probeExports.WORKING_DIRECTORY_PROBE, Buffer, setTimeout, clearTimeout })

async function main () {
    const version = execFileSync('tmux', ['-V'], { encoding: 'utf8' }).trim()
    assert.equal(version, `tmux ${process.env.EXPECT_TMUX_VERSION}`)
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-tmux-ci-'))
    const first = path.join(temp, 'one space')
    const second = path.join(temp, 'two')
    fs.mkdirSync(first)
    fs.mkdirSync(second)
    assert.ok(process.env.TMUX_TMPDIR, 'CI must provide an isolated TMUX_TMPDIR')
    delete process.env.TMUX
    const tmux = args => execFileSync('tmux', args, { encoding: 'utf8', env: process.env })
    let connection = null
    let shell = null
    let sibling = null
    try {
        tmux(['new-session', '-d', '-s', 'tabby-test', '-c', first, 'sleep 120'])
        tmux(['split-window', '-d', '-t', 'tabby-test', '-c', second, 'sleep 120'])
        const query = new moduleExports.QueryTest()
        const transport = await russh.SshTransport.newSocket(`127.0.0.1:${process.env.TEST_SSH_PORT}`)
        const client = await russh.SSHClient.connect(transport, async () => true)
        const key = await russh.KeyPair.parse(fs.readFileSync(process.env.TEST_SSH_KEY, 'utf8'))
        connection = await client.authenticateWithKeyPair(os.userInfo().username, key, null)
        if (!(connection instanceof russh.AuthenticatedSSHClient)) {
            throw new Error(`test SSH authentication failed: ${JSON.stringify(connection)}`)
        }
        query.ssh = connection
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
        query.profile = { options: {} }
        query.logger = console
        ;[shell, sibling] = await Promise.all([query.openShellChannel({}), query.openShellChannel({})])
        // Subscribe before writing so terminal output is consumed as in the UI.
        shell.data$.subscribe(() => {})
        sibling.data$.subscribe(() => {})
        const current = (ch, socketPath = '', executable = '') => query.queryCurrentWorkingDirectory(socketPath, executable, ch)
        async function waitForPath (ch, expected, label) {
            let last
            for (let i = 0; i < 30; i++) {
                try { last = await current(ch) } catch (error) { last = error.message }
                if (last === expected) return
                await new Promise(resolve => setTimeout(resolve, 100))
            }
            assert.fail(`${label}: expected ${expected}, got ${last}`)
        }
        await shell.write(Buffer.from(`cd ${shellQuote.quote([first])}\n`))
        await sibling.write(Buffer.from(`cd ${shellQuote.quote([second])}\n`))
        await waitForPath(shell, first, 'first multiplexed tab')
        await waitForPath(sibling, second, 'second multiplexed tab')
        // Attach normally (not "exec tmux") and deliberately leave both Tabby
        // override fields empty. The remote default server is isolated by CI.
        const active = dirs.indexOf(second)
        const other = 1 - active
        tmux(['select-pane', '-t', panes[active]])
        await shell.write(Buffer.from(`${shellQuote.quote([process.env.TMUX_BINARY, 'attach-session', '-t', 'tabby-test'])}\n`))
        await waitForPath(shell, second, 'tmux defaults')
        tmux(['select-pane', '-t', panes[other]])
        assert.equal(await current(shell), dirs[other])
        assert.equal(await current(shell, socket), dirs[other])
        assert.equal(await current(shell, '', process.env.TMUX_BINARY), dirs[other])
        assert.equal(await current(shell, socket, process.env.TMUX_BINARY), dirs[other])
        assert.equal(await current(sibling), second)
        console.log(`${version}: discovered ${panes.length} panes and their working directories over SSH`)
    } finally {
        if (sibling) await sibling.close().catch(() => null)
        if (shell) await shell.close().catch(() => null)
        if (connection instanceof russh.AuthenticatedSSHClient) await connection.disconnect()
        try { tmux(['kill-server']) } catch {}
        fs.rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
