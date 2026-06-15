import { test } from 'node:test'
import assert from 'node:assert'
import { isPalindrome } from './lib.mjs'

test('detects palindromes ignoring case and spaces', () => {
  assert.strictEqual(isPalindrome('Race car'), true)
  assert.strictEqual(isPalindrome('hello'), false)
  assert.strictEqual(isPalindrome(''), true)
})
