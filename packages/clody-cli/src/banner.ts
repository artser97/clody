// packages/clody-cli/src/banner.ts
/**
 * clody session banner: the ANSI-Shadow wordmark with a teal->violet gradient,
 * a gradient section rule, and a bulleted status readout. Color/TTY gating and
 * the palette come from the shared brand kit (style.ts).
 */
import { TEAL, VIOLET, paint, dim, rule, GLYPH, supportsColor, lerpColor } from "./style"

export interface BannerStatus {
  version: string
  model?: string
  ctxLabel?: string
  accelerator: string
}

const WORDMARK = [
  " ██████╗██╗      ██████╗ ██████╗ ██╗   ██╗",
  "██╔════╝██║     ██╔═══██╗██╔══██╗╚██╗ ██╔╝",
  "██║     ██║     ██║   ██║██║  ██║ ╚████╔╝ ",
  "██║     ██║     ██║   ██║██║  ██║  ╚██╔╝  ",
  "╚██████╗███████╗╚██████╔╝██████╔╝   ██║   ",
  " ╚═════╝╚══════╝ ╚═════╝ ╚═════╝    ╚═╝   ",
]

function paintLine(line: string, t: number, color: boolean): string {
  return color ? paint(lerpColor(TEAL, VIOLET, t), line, color) : line
}

export function renderBanner(status: BannerStatus, color: boolean): string {
  const last = WORDMARK.length - 1
  const art = WORDMARK.map((line, i) => paintLine(line, i / last, color)).join("\n")
  const ruleLine = rule("CLODY", color)
  const tagline = dim(` local-model coding agent · v${status.version}`, color)
  const items = [status.model, status.ctxLabel, status.accelerator]
    .filter((s): s is string => Boolean(s))
    .map((s) => `${paint(TEAL, GLYPH.item, color)} ${s}`)
    .join("   ")
  const statusLine = `  ${items}`
  return `${art}\n${ruleLine}\n${tagline}\n${statusLine}\n`
}

/** Print the banner to stdout when interactive; no-op otherwise. */
export function printBanner(status: BannerStatus): void {
  if (!process.stdout.isTTY) return
  process.stdout.write(renderBanner(status, supportsColor()) + "\n")
}
