export interface IndexedFile {
  id: number
  path: string
  hash: string
  language: string | null
  snippet: string
  indexedAt: Date
}

export interface Symbol {
  id: number
  fileId: number
  name: string
  kind: 'function' | 'class' | 'interface' | 'type'
  line: number
  col: number
}

export interface ImportEdge {
  id: number
  fromFileId: number
  toPath: string
}

export type MemoryType = 'repository' | 'failure'

export type MemoryTier = 'working' | 'episodic' | 'semantic'

export interface MemoryEntry {
  id: number
  type: MemoryType
  tier: MemoryTier
  content: string
  tags: string[]
  sessionId: string | null
  createdAt: Date
  lastAccessedAt: Date | null
  accessCount: number
}

export interface EmbeddingRecord {
  entityId: number
  entityType: 'file' | 'memory'
  vector: number[]
}
