import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert'

execFileSync('node', ['--test'], { encoding: 'utf8' })
const source = readFileSync('prices.mjs', 'utf8')
assert.ok(source.includes('applyTax'), 'expected an applyTax helper')
assert.strictEqual(source.match(/\* 0\.2/g)?.length ?? 0, 1, 'tax rate should appear exactly once')
console.log('ok')
