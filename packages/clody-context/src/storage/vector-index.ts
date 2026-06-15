/**
 * In-RAM binary-quantized vector index: 1 bit per dimension (sign relative to
 * an optional center vector), Hamming-distance pre-filter. Callers re-rank the
 * returned candidates with exact cosine over full vectors (see
 * SqliteStorage.searchSimilar). At thousands of vectors the full Hamming scan
 * is microseconds — no ANN structure needed.
 *
 * Centering matters: real text embeddings are anisotropic (nonzero corpus
 * mean), and sign bits relative to the mean separate neighbors far better
 * than raw signs. Note for fixture authors: RANDOM uniform vectors are the
 * adversarial case for any sign quantizer (all points are near-orthogonal);
 * realistic recall tests need clustered data.
 */

export function binaryQuantize(vec: Float32Array, center?: Float32Array): Uint32Array {
  const words = new Uint32Array(Math.ceil(vec.length / 32))
  for (let i = 0; i < vec.length; i++) {
    const value = center ? vec[i]! - center[i]! : vec[i]!
    if (value > 0) {
      words[i >> 5] = (words[i >> 5]! | (1 << (i & 31))) >>> 0
    }
  }
  return words
}

function popcount32(x: number): number {
  x -= (x >> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
  x = (x + (x >> 4)) & 0x0f0f0f0f
  return Math.imul(x, 0x01010101) >>> 24
}

export function hammingDistance(a: Uint32Array, b: Uint32Array): number {
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    distance += popcount32((a[i]! ^ b[i]!) >>> 0)
  }
  return distance
}

export class VectorIndex {
  private readonly entries = new Map<number, Uint32Array>()
  private readonly center: Float32Array | undefined

  constructor(readonly dims: number, center?: Float32Array) {
    if (center !== undefined && center.length !== dims) {
      throw new Error(`VectorIndex center dimension mismatch: index is ${dims}, got ${center.length}`)
    }
    this.center = center
  }

  get size(): number {
    return this.entries.size
  }

  add(id: number, vector: Float32Array): void {
    if (vector.length !== this.dims) {
      throw new Error(`VectorIndex dimension mismatch: index is ${this.dims}, got ${vector.length}`)
    }
    this.entries.set(id, binaryQuantize(vector, this.center))
  }

  remove(id: number): void {
    this.entries.delete(id)
  }

  clear(): void {
    this.entries.clear()
  }

  /** Top-k entity ids by Hamming distance to the query, closest first. */
  candidates(query: Float32Array, k: number): number[] {
    const q = binaryQuantize(query, this.center)
    const scored: Array<{ id: number; d: number }> = []
    for (const [id, bits] of this.entries) {
      scored.push({ id, d: hammingDistance(q, bits) })
    }
    scored.sort((a, b) => a.d - b.d)
    return scored.slice(0, k).map((s) => s.id)
  }
}
