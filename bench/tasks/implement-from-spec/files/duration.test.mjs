import { test } from 'node:test'
import assert from 'node:assert'
import { parseDuration } from './duration.mjs'

test('parses combined units', () => {
  assert.strictEqual(parseDuration('1h30m'), 5400)
  assert.strictEqual(parseDuration('45s'), 45)
  assert.strictEqual(parseDuration('2m5s'), 125)
  assert.strictEqual(parseDuration(''), 0)
})

test('throws on invalid input', () => {
  assert.throws(() => parseDuration('abc'), { name: 'TypeError' })
})
