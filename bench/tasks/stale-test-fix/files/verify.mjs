import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert'

execFileSync('node', ['--test'], { encoding: 'utf8' })
const code = readFileSync('scores.mjs', 'utf8')
assert.ok(code.includes('a - b'), 'code must keep ascending sort per README')
const testSrc = readFileSync('scores.test.mjs', 'utf8')
assert.ok(testSrc.includes('[1, 2, 3]'), 'test must expect ascending order')
console.log('ok')
