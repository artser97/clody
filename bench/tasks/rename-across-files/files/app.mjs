import { calc } from './util.mjs'

export function checkout(items) {
  return `total: ${calc(items)}`
}
