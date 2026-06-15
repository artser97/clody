export interface RetrievalParams {
  query: string
  workingDirectory: string
  mentionedFiles?: string[]
  maxChunks: number
  maxTokens: number
}

export interface CodeChunk {
  filePath: string
  snippet: string
  relevanceScore: number
  reason: 'symbol-match' | 'semantic' | 'recent-edit' | 'mentioned'
}

export interface RetrievalResult {
  chunks: CodeChunk[]
  totalTokens: number
  durationMs: number
}

export interface Embedder {
  embed(inputs: string[]): Promise<{ embeddings: number[][] }>
}
