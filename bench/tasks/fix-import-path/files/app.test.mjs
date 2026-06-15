import { test } from 'node:test'
import assert from 'node:assert'
import { label } from './app.mjs'

test('label formats numbers', () => {
  assert.strictEqual(label(7), '#7')
})
