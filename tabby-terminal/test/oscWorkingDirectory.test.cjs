/* Run in CI: node tabby-terminal/test/oscWorkingDirectory.test.cjs */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { Subject } = require('rxjs')
class SessionMiddleware {
    constructor () { this.outputToTerminal = new Subject() }
    feedFromSession (data) { this.outputToTerminal.next(data) }
    close () { this.outputToTerminal.complete() }
}
const source = fs.readFileSync('tabby-terminal/src/middleware/oscProcessing.ts', 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
const result = {}
vm.runInNewContext(js, {
    exports: result, Buffer, URL, console,
    require: name => name === 'rxjs' ? { Subject } : name === 'os' ? require('os') : { SessionMiddleware },
})
const parser = new result.OSCProcessor()
const paths = []
const output = []
parser.cwdReported$.subscribe(path => paths.push(path))
parser.outputToTerminal.subscribe(data => output.push(data))
parser.feedFromSession(Buffer.from('\x1b]7;file://server/tmp/a%20b%3Dc\x07'))
parser.feedFromSession(Buffer.from('\x1b]1337;CurrentDir=/tmp/a=b\x07'))
parser.feedFromSession(Buffer.from('\x1b'))
parser.feedFromSession(Buffer.from(']7;file://host/tmp/split\x1b\\'))
parser.feedFromSession(Buffer.from('\x1b]7;https://host/not-a-file\x07'))
parser.feedFromSession(Buffer.from('\x1b]7;file://host/%ZZ\x07'))
assert.deepEqual(paths, ['/tmp/a b=c', '/tmp/a=b', '/tmp/split'])
assert.ok(Buffer.concat(output).includes(Buffer.from('\x1b]7;file://server/tmp/a%20b%3Dc\x07')))
console.log('OSC working directory: OSC 7, OSC 1337, split prefixes and invalid URIs passed')
