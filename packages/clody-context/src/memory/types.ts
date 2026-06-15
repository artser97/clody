import type { MemoryTier } from '../storage'

export interface RepositoryMemory {
  type: 'repository'
  content: string
  tags: string[]
  sessionId?: string
  tier?: MemoryTier
}

export interface FailureMemory {
  type: 'failure'
  content: string
  tags: string[]
  sessionId?: string
  tier?: MemoryTier
}

export type MemoryInput = RepositoryMemory | FailureMemory

export interface IncomingMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: 'text'; text: string }>; is_error?: boolean }

export interface Embedder {
  embed(inputs: string[]): Promise<{ embeddings: number[][] }>
}
