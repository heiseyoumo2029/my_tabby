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
const query = type.members.find(x => x.name && x.name.getText(tree) === 'queryTmux')
const current = type.members.find(x => x.name && x.name.getText(tree) === 'queryCurrentWorkingDirectory')
const probeSource = fs.readFileSync('tabby-ssh/src/session/workingDirectoryProbe.ts', 'utf8')
const probeJS = ts.transpileModule(probeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const probeExports = {}
vm.runInNewContext(probeJS, { exports: probeExports })
const js = ts.transpileModule(`class QueryTest { ${query.getText(tree)} ${current.getText(tree)} }\nexports.QueryTest = QueryTest`, {
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
        shell = await connection.activateChannel(await connection.openSessionChannel())
        let shellOutput = ''
        shell.data$.subscribe(data => { shellOutput += Buffer.from(data).toString() })
        await shell.requestPTY('xterm', { columns: 80, rows: 24, pixWidth: 0, pixHeight: 0 })
        await shell.requestShell()
        await shell.write(Buffer.from(`cd ${shellQuote.quote([first])}; echo TABBY_READY_123\n`))
        for (let i = 0; i < 50 && !shellOutput.includes('TABBY_READY_123'); i++) await new Promise(resolve => setTimeout(resolve, 100))
        assert.ok(shellOutput.includes('TABBY_READY_123'), 'interactive shell did not start')
        let shellPath = null
        let probeError = null
        for (let i = 0; i < 30; i++) {
            try { shellPath = await query.queryCurrentWorkingDirectory(socket, process.env.TMUX_BINARY) } catch (error) { probeError = error }
            if (shellPath === first) break
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert.equal(shellPath, first, `automatic shell detection failed: ${probeError?.message}`)
        await shell.write(Buffer.from(`exec ${shellQuote.quote([process.env.TMUX_BINARY, '-S', socket, 'attach-session', '-t', 'tabby-test'])}\n`))
        let currentPath = null
        for (let i = 0; i < 30; i++) {
            try { currentPath = await query.queryCurrentWorkingDirectory(socket, process.env.TMUX_BINARY) } catch {}
            if (dirs.includes(currentPath)) break
            await new Promise(resolve => setTimeout(resolve, 100))
        }
        assert.ok(dirs.includes(currentPath), `could not detect active tmux pane: ${currentPath}`)
        const other = currentPath === dirs[0] ? 1 : 0
        tmux(['select-pane', '-t', panes[other]])
        assert.equal(await query.queryCurrentWorkingDirectory(socket, process.env.TMUX_BINARY), dirs[other])
        console.log(`${version}: discovered ${panes.length} panes and their working directories over SSH`)
    } finally {
        if (shell) await shell.close().catch(() => null)
        if (connection instanceof russh.AuthenticatedSSHClient) await connection.disconnect()
        try { tmux(['kill-server']) } catch {}
        fs.rmSync(temp, { recursive: true, force: true })
    }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
