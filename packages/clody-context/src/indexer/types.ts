export interface ParsedSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type'
  line: number
  col: number
}

export interface ParseResult {
  symbols: ParsedSymbol[]
  imports: string[]
}

export interface IndexOptions {
  workingDirectory: string
  ignore?: string[]
}

export interface IndexResult {
  filesIndexed: number
  symbolsExtracted: number
  importsFound: number
  durationMs: number
  repoSummary: string
}

export interface Embedder {
  embed(inputs: string[]): Promise<{ embeddings: number[][] }>
}
