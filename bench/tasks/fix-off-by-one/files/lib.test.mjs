import { test } from 'node:test'
import assert from 'node:assert'
import { lastN } from './lib.mjs'

test('lastN returns the last n elements', () => {
  assert.deepStrictEqual(lastN([1, 2, 3], 2), [2, 3])
  assert.deepStrictEqual(lastN([1, 2, 3], 0), [])
})
