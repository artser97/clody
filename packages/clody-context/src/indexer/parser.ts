import Parser from 'tree-sitter'
import TS from 'tree-sitter-typescript'
import type { ParsedSymbol, ParseResult } from './types'

const SYMBOL_NODE_TYPES: Record<string, ParsedSymbol['kind']> = {
  function_declaration: 'function',
  class_declaration: 'class',
  interface_declaration: 'interface',
  type_alias_declaration: 'type',
}

function createParser(language: 'typescript' | 'tsx' = 'typescript'): Parser {
  const parser = new Parser()
  const grammar = language === 'tsx' ? TS.tsx : TS.typescript
  parser.setLanguage(grammar as unknown as Parser.Language)
  return parser
}

let sharedTsParser: Parser | null = null
let sharedTsxParser: Parser | null = null

function getParser(language: 'typescript' | 'tsx' = 'typescript'): Parser {
  if (language === 'tsx') {
    if (!sharedTsxParser) {
      sharedTsxParser = createParser('tsx')
    }
    return sharedTsxParser
  }
  if (!sharedTsParser) {
    sharedTsParser = createParser('typescript')
  }
  return sharedTsParser
}

export function parseTypeScript(source: string, language: 'typescript' | 'tsx' = 'typescript'): ParseResult {
  const parser = getParser(language)
  const tree = parser.parse(source)
  const symbols: ParsedSymbol[] = []
  const imports: string[] = []

  function walk(node: Parser.SyntaxNode): void {
    if (node.type === 'import_statement') {
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child && child.type === 'string') {
          const raw = child.text
          imports.push(raw.slice(1, -1))
          break
        }
      }
      return
    }

    const kind = SYMBOL_NODE_TYPES[node.type]
    if (kind !== undefined) {
      const nameNode = node.childForFieldName('name')
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind,
          line: node.startPosition.row + 1,
          col: node.startPosition.column,
        })
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (child) {
        walk(child)
      }
    }
  }

  walk(tree.rootNode)
  return { symbols, imports }
}
