import { test } from 'node:test'
import assert from 'node:assert'
import { checkout } from './app.mjs'
import { computeTotal } from './util.mjs'

test('computeTotal exists and checkout works', () => {
  assert.strictEqual(computeTotal([{ price: 2 }, { price: 3 }]), 5)
  assert.strictEqual(checkout([{ price: 2 }]), 'total: 2')
})
