import { test } from 'node:test'
import assert from 'node:assert'
import { readTotal } from './stats.mjs'

test('sums generated values', () => {
  assert.strictEqual(readTotal(), 60)
})
