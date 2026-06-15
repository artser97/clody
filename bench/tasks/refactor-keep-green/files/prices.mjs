export function retailPrice(base) {
  const taxed = base + base * 0.2
  return Math.round(taxed * 100) / 100
}

export function wholesalePrice(base) {
  const discounted = base * 0.9
  const taxed = discounted + discounted * 0.2
  return Math.round(taxed * 100) / 100
}
