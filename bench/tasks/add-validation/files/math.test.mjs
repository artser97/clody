import { test } from 'node:test'
import assert from 'node:assert'
import { divide } from './math.mjs'

test('divides normally', () => {
  assert.strictEqual(divide(6, 2), 3)
})

test('throws RangeError on zero divisor', () => {
  assert.throws(() => divide(1, 0), { name: 'RangeError', message: 'division by zero' })
})
