import { test } from 'node:test'
import assert from 'node:assert'
import { sortScores } from './scores.mjs'

test('sorts scores', () => {
  assert.deepStrictEqual(sortScores([2, 3, 1]), [3, 2, 1])
})
