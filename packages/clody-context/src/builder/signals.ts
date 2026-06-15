import type { IncomingMessage, ContextSignals, ContentBlock } from './types'

const FILE_REGEX = /([\w./-]+\.(tsx|ts|jsx|js|py|go|rs|java))/g
const MAX_QUERY_TEXT_LENGTH = 500

function normalizeMentionedPath(filePath: string, workingDirectory: string): string {
  const prefix = workingDirectory.endsWith('/') ? workingDirectory : workingDirectory + '/'
  return filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

function userAuthoredText(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content
  return content
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function extractTextFromBlocks(blocks: ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      parts.push(block.text)
    } else if (block.type === 'tool_result') {
      if (typeof block.content === 'string') {
        parts.push(block.content)
      } else {
        for (const sub of block.content) {
          parts.push(sub.text)
        }
      }
    }
  }
  return parts.join('\n')
}

function extractErrorsFromBlocks(blocks: ContentBlock[]): string[] {
  const errors: string[] = []
  for (const block of blocks) {
    if (block.type === 'tool_result' && block.is_error === true) {
      if (typeof block.content === 'string') {
        errors.push(block.content)
      } else {
        errors.push(block.content.map((c) => c.text).join('\n'))
      }
    }
  }
  return errors
}

export function extractSignals(
  messages: IncomingMessage[],
  sessionId: string,
  workingDirectory: string
): ContextSignals {
  const allText: string[] = []
  const recentErrors: string[] = []

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      allText.push(msg.content)
    } else {
      allText.push(extractTextFromBlocks(msg.content))
      recentErrors.push(...extractErrorsFromBlocks(msg.content))
    }
  }

  const fullText = allText.join('\n')

  const mentionedFiles: string[] = []
  const fileMatches = fullText.matchAll(FILE_REGEX)
  const seen = new Set<string>()
  for (const match of fileMatches) {
    const filePath = match[1]
    if (!filePath) continue
    const normalized = normalizeMentionedPath(filePath, workingDirectory)
    if (!seen.has(normalized)) {
      seen.add(normalized)
      mentionedFiles.push(normalized)
    }
  }

  let queryText = ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (!msg || msg.role !== 'user') continue
    const text = userAuthoredText(msg.content).trim()
    if (text.length > 0) {
      queryText = text.slice(0, MAX_QUERY_TEXT_LENGTH)
      break
    }
  }

  return {
    queryText,
    mentionedFiles,
    recentErrors,
    sessionId,
    workingDirectory,
  }
}
