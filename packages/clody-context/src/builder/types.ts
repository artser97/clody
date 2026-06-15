export interface ContextSignals {
  queryText: string
  mentionedFiles: string[]
  recentErrors: string[]
  sessionId: string
  workingDirectory: string
}

export interface BuiltContext {
  systemPromptPrefix: string
  chunksUsed: number
  memoriesUsed: number
  estimatedTokens: number
}

export interface IncomingMessage {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string | Array<{ type: 'text'; text: string }>; is_error?: boolean }
