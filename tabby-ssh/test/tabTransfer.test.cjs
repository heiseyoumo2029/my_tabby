/* Run with: node tabby-ssh/test/tabTransfer.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

class FileTransfer {
    constructor () { this.bytes = 0; this.cancelled = false }
    increaseProgress (bytes) { this.bytes += bytes }
    isCancelled () { return this.cancelled }
    cancel () { this.cancelled = true; this.close() }
    setStatus () {}
}
const source = fs.readFileSync('tabby-ssh/src/session/tabTransfer.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const moduleExports = {}
vm.runInNewContext(js, {
    exports: moduleExports,
    require: name => name === 'russh' ? { OPEN_READ: 1, OPEN_WRITE: 2, OPEN_CREATE: 8 } : name === 'path' ? require('path') : { FileTransfer },
})
const { TabFileTransfer } = moduleExports

function fixture (content, options = {}) {
    const files = new Map([['/from', Buffer.from(content)]])
    if (options.existing) files.set('/to', Buffer.from('original'))
    const source = {
        async open () {
            let offset = 0
            return {
                async read () {
                    const chunk = files.get('/from').subarray(offset, offset + 3)
                    offset += chunk.length
                    return chunk
                },
                async close () {},
            }
        },
    }
    const destination = {
        async open (name, flags) {
            assert.equal(flags, 2 | 8 | 0x20)
            if (files.has(name)) throw Error('already exists')
            files.set(name, Buffer.alloc(0))
            return {
                async write (chunk) {
                    if (options.failWrite) throw Error('write failed')
                    files.set(name, Buffer.concat([files.get(name), chunk]))
                    if (options.cancel) options.cancel()
                },
                async close () {},
            }
        },
        async unlink (name) { files.delete(name) },
    }
    return { files, source, destination }
}

async function main () {
    const file = { name: 'test', fullPath: '/from', size: 6 }
    let f = fixture('abcdef')
    let t = new TabFileTransfer(file)
    await t.run(f.source, f.destination, '/to')
    assert.equal(f.files.get('/to').toString(), 'abcdef')
    assert.equal(t.bytes, 6)
    assert.equal(t.isComplete(), true)

    f = fixture('abcdef', { existing: true })
    t = new TabFileTransfer(file)
    await assert.rejects(t.run(f.source, f.destination, '/to'), /already exists/)
    assert.equal(f.files.get('/to').toString(), 'original')

    f = fixture('abcdef', { failWrite: true })
    t = new TabFileTransfer(file)
    await assert.rejects(t.run(f.source, f.destination, '/to'), /write failed/)
    assert.equal(f.files.has('/to'), false)

    t = new TabFileTransfer(file)
    f = fixture('abcdef', { cancel: () => t.cancel() })
    await assert.rejects(t.run(f.source, f.destination, '/to'), /cancelled/)
    assert.equal(f.files.has('/to'), false)

    t = new TabFileTransfer({ ...file, size: 0 })
    f = fixture('')
    await t.run(f.source, f.destination, '/to')
    assert.equal(t.isComplete(), true)
    assert.equal(f.files.get('/to').length, 0)

    const directories = new Set()
    const copied = new Map()
    const source = {
        readdir: async p => p === '/source' ? [
            { name: 'sub', fullPath: '/source/sub', isDirectory: true },
            { name: 'a', fullPath: '/source/a', size: 2 },
        ] : [{ name: 'b', fullPath: '/source/sub/b', size: 2 }],
        open: async () => {
            let read = false
            return { read: async () => read ? Buffer.alloc(0) : (read = true, Buffer.from('ok')), close: async () => {} }
        },
    }
    const destination = {
        mkdir: async p => { if (directories.has(p)) throw Error('exists'); directories.add(p) },
        rmdir: async p => directories.delete(p),
        unlink: async p => copied.delete(p),
        open: async p => ({ write: async data => copied.set(p, Buffer.from(data)), close: async () => {} }),
    }
    const folder = { name: 'source', fullPath: '/source', isDirectory: true, size: 0 }
    t = new TabFileTransfer(folder)
    await t.run(source, destination, '/target/source')
    assert.equal(t.getSize(), 4)
    assert.equal(t.bytes, 4)
    assert.equal(copied.get('/target/source/sub/b').toString(), 'ok')
    assert.equal(t.isComplete(), true)
    await assert.rejects(new TabFileTransfer(folder).run(source, destination, '/target/source'), /exists/)
    assert.equal(copied.get('/target/source/a').toString(), 'ok')
    console.log('tabTransfer: file and directory transfer tests passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
