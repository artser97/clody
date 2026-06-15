import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes
const GIT_TIMEOUT_MS = 5000

interface CacheEntry {
  files: string[]
  fetchedAt: number
}

export class RecentEditsCache {
  private cache = new Map<string, CacheEntry>()
  private inflight = new Map<string, Promise<string[]>>()

  async getRecentFiles(cwd: string): Promise<string[]> {
    const entry = this.cache.get(cwd)
    const now = Date.now()

    if (entry && now - entry.fetchedAt < CACHE_TTL_MS) {
      return entry.files
    }

    const existing = this.inflight.get(cwd)
    if (existing) return existing

    const promise = this.fetchFromGit(cwd)
      .finally(() => {
        this.inflight.delete(cwd)
      })
    this.inflight.set(cwd, promise)
    return promise
  }

  private async fetchFromGit(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        'git',
        ['log', '--name-only', '--pretty=format:', '-20', '--', '.'],
        { cwd, encoding: 'utf-8', timeout: GIT_TIMEOUT_MS }
      )
      const lines = stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
      const files = [...new Set(lines)]
      this.cache.set(cwd, { files, fetchedAt: Date.now() })
      return files
    } catch {
      // Negative cache: a failing git (non-repo cwd, git missing) must not be
      // retried on every request
      const files: string[] = []
      this.cache.set(cwd, { files, fetchedAt: Date.now() })
      return files
    }
  }
}
