import { readFileSync } from 'node:fs'
import assert from 'node:assert'

const answer = readFileSync('ANSWER.md', 'utf8')
assert.ok(answer.includes('server.mjs'), `expected server.mjs in: ${answer}`)
assert.ok(!answer.includes('client.mjs'), 'wrong file named')
console.log('ok')
