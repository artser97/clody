import { test } from 'node:test'
import assert from 'node:assert'
import { getTimeout } from './client.mjs'

test('reads timeoutMs from config', () => {
  assert.strictEqual(getTimeout(), 5000)
})
