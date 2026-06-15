// packages/clody-cli/src/style.ts
/**
 * clody brand kit: the single source of the teal->violet visual identity for all
 * CLI chrome (banner, status lines, wizard framing, prompts). Color is gated once
 * via supportsColor(); with NO_COLOR or a non-TTY stdout every helper emits plain
 * text. Painters take an explicit `color` param (default supportsColor()) so they
 * are deterministically testable.
 */
export type RGB = readonly [number, number, number]

export const TEAL: RGB = [0, 200, 180]
export const VIOLET: RGB = [150, 90, 255]
export const SUCCESS: RGB = [43, 224, 166]
export const INFO: RGB = [34, 200, 224]
export const WARN: RGB = [255, 180, 84]
export const ERROR: RGB = [255, 107, 129]
export const MUTED: RGB = [138, 138, 160]

export function supportsColor(): boolean {
  return Boolean(process.stdout.isTTY) && !("NO_COLOR" in process.env)
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t)
}

/** Interpolate between two RGB colors at t in [0,1]. */
export function lerpColor(from: RGB, to: RGB, t: number): RGB {
  return [lerp(from[0], to[0], t), lerp(from[1], to[1], t), lerp(from[2], to[2], t)]
}

export function paint(rgb: RGB, s: string, color = supportsColor()): string {
  if (!color) return s
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${s}\x1b[0m`
}

export function gradient(s: string, color = supportsColor()): string {
  if (!color) return s
  const chars = [...s]
  const last = Math.max(chars.length - 1, 1)
  const body = chars
    .map((ch, i) => {
      const t = i / last
      const r = lerp(TEAL[0], VIOLET[0], t)
      const g = lerp(TEAL[1], VIOLET[1], t)
      const b = lerp(TEAL[2], VIOLET[2], t)
      return `\x1b[38;2;${r};${g};${b}m${ch}`
    })
    .join("")
  return body + "\x1b[0m"
}

export function bold(s: string, color = supportsColor()): string {
  return color ? `\x1b[1m${s}\x1b[0m` : s
}

export function dim(s: string, color = supportsColor()): string {
  return color ? `\x1b[2m${s}\x1b[0m` : s
}

export const GLYPH = {
  ok: "✔",
  warn: "⚠",
  err: "✖",
  step: "◇",
  item: "⬡",
} as const

export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const

/** Pure formatter: "  <glyph> <msg>" with the glyph painted; testable without IO. */
export function format(glyph: string, rgb: RGB, msg: string, color = supportsColor()): string {
  return `  ${paint(rgb, glyph, color)} ${msg}`
}

/** Gradient section header, e.g. `▰▱ CLODY ──────────`. */
export function rule(title: string, color = supportsColor()): string {
  const head = `▰▱ ${title} `
  const width = 44
  const dashes = "─".repeat(Math.max(width - [...head].length, 0))
  return gradient(head + dashes, color)
}

/** Gradient progress bar; fraction clamped to [0,1]. */
export function bar(fraction: number, width = 18, color = supportsColor()): string {
  const f = Math.max(0, Math.min(1, fraction))
  const filled = Math.round(f * width)
  const body = "█".repeat(filled) + "░".repeat(width - filled)
  return gradient(body, color)
}

// IO helpers: step/ok/item -> stdout; warn/err -> stderr.
export function step(msg: string): void {
  console.log(format(GLYPH.step, VIOLET, msg))
}
export function ok(msg: string): void {
  console.log(format(GLYPH.ok, SUCCESS, msg))
}
export function item(msg: string): void {
  console.log(format(GLYPH.item, TEAL, msg))
}
export function warn(msg: string): void {
  console.error(format(GLYPH.warn, WARN, msg))
}
export function err(msg: string): void {
  console.error(format(GLYPH.err, ERROR, msg))
}
