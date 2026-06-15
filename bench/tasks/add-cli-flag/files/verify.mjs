import { execFileSync } from 'node:child_process'
import assert from 'node:assert'

const plain = execFileSync('node', ['cli.mjs', 'hello'], { encoding: 'utf8' }).trim()
assert.strictEqual(plain, 'hello')
const upper = execFileSync('node', ['cli.mjs', 'hello', '--upper'], { encoding: 'utf8' }).trim()
assert.strictEqual(upper, 'HELLO')
console.log('ok')
