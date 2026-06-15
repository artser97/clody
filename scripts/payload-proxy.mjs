// Logging proxy: opencode -> :11435 -> ollama :11434
// Dumps every request body to captures/req-<n>.json and logs usage from responses.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const CAPTURE_DIR = path.join(import.meta.dirname, 'captures')
fs.mkdirSync(CAPTURE_DIR, { recursive: true })
let n = 0

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => {
    const body = Buffer.concat(chunks)
    if (body.length > 0 && req.url.includes('/chat/completions')) {
      const file = path.join(CAPTURE_DIR, `req-${String(++n).padStart(3, '0')}.json`)
      fs.writeFileSync(file, body)
      const parsed = JSON.parse(body.toString())
      const sysLen = JSON.stringify(parsed.messages?.filter((m) => m.role === 'system') ?? []).length
      const toolsLen = JSON.stringify(parsed.tools ?? []).length
      const msgsLen = JSON.stringify(parsed.messages ?? []).length
      console.log(
        `[req ${n}] ${req.url} model=${parsed.model} chars: system=${sysLen} allMessages=${msgsLen} tools=${toolsLen} (${parsed.tools?.length ?? 0} tools)`
      )
    }
    const upstream = http.request(
      { host: '127.0.0.1', port: 11434, path: req.url, method: req.method, headers: { ...req.headers, host: '127.0.0.1:11434' } },
      (up) => {
        res.writeHead(up.statusCode, up.headers)
        let tail = ''
        up.on('data', (c) => {
          tail = (tail + c.toString()).slice(-4000)
          res.write(c)
        })
        up.on('end', () => {
          const m = tail.match(/"usage":\s*\{[^}]*\}/)
          if (m) console.log(`[res ${n}] ${m[0]}`)
          res.end()
        })
      }
    )
    upstream.on('error', (e) => {
      console.error('upstream error', e.message)
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    res.on('error', () => {})
    req.on('error', () => {})
    upstream.end(body)
  })
})

process.on('uncaughtException', (e) => console.error('uncaught', e.message))

server.listen(11435, () => console.log('proxy on :11435 -> :11434'))
