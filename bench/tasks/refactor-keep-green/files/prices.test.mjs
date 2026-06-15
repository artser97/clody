import { test } from 'node:test'
import assert from 'node:assert'
import { retailPrice, wholesalePrice } from './prices.mjs'

test('prices unchanged', () => {
  assert.strictEqual(retailPrice(10), 12)
  assert.strictEqual(wholesalePrice(10), 10.8)
})
