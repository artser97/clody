import { readValue } from './db.mjs'

export async function getUpper() {
  const value = readValue()
  return value.toUpperCase()
}
