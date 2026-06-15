import { test } from 'node:test'
import assert from 'node:assert'
import { getUpper } from './main.mjs'

test('getUpper upper-cases the stored value', async () => {
  assert.strictEqual(await getUpper(), 'HELLO')
})
