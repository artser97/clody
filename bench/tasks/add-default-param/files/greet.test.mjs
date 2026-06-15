import { test } from 'node:test'
import assert from 'node:assert'
import { greet } from './greet.mjs'

test('greets by name and by default', () => {
  assert.strictEqual(greet('Ada'), 'Hello, Ada!')
  assert.strictEqual(greet(), 'Hello, world!')
})
