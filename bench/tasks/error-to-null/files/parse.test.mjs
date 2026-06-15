import { test } from 'node:test'
import assert from 'node:assert'
import { parseSafe } from './parse.mjs'

test('parses valid JSON', () => {
  assert.deepStrictEqual(parseSafe('{"a":1}'), { a: 1 })
})

test('returns null on invalid JSON', () => {
  assert.strictEqual(parseSafe('{nope'), null)
})
