import { mkdir, rm } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  IndexingProgressCallback,
  IngestOptions,
  IngestResult,
  Provider,
  ProviderConfig,
  SearchOptions,
} from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"
import { logger } from "../../utils/logger"
import { GSPOT_PROMPTS } from "./prompts"

const providerDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(providerDir, "../../../../../..")
const helperPath = resolve(providerDir, "worker.ts")

interface WorkerResult {
  documentIds?: string[]
  results?: unknown[]
}

function parseWorkerJson(stdout: string): WorkerResult {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  for (const line of lines.reverse()) {
    if (!line.startsWith("{")) continue
    return JSON.parse(line) as WorkerResult
  }

  throw new Error(`gspot worker produced no JSON output: ${stdout}`)
}

async function runWorker(command: string, payload: unknown): Promise<WorkerResult> {
  const proc = Bun.spawn(["bun", "run", helperPath, command], {
    cwd: repoRoot,
    env: {
      ...process.env,
      GSPOT_REPO_ROOT: repoRoot,
      DOTENV_CONFIG_QUIET: "true",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  })

  proc.stdin.write(JSON.stringify(payload))
  proc.stdin.end()

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(`gspot worker failed (${exitCode}): ${stderr || stdout}`)
  }

  return parseWorkerJson(stdout)
}

export class GSpotProvider implements Provider {
  name = "gspot"
  prompts = GSPOT_PROMPTS
  concurrency = {
    default: 1,
    ingest: 1,
    indexing: 1,
    search: 1,
  }

  async initialize(_config: ProviderConfig): Promise<void> {
    await mkdir(resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot"), {
      recursive: true,
    })
    logger.info("Initialized g-spot local memory provider")
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const result = await runWorker("ingest", {
      containerTag: options.containerTag,
      sessions,
    })

    return { documentIds: result.documentIds ?? [] }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    onProgress?.({
      completedIds: result.documentIds,
      failedIds: [],
      total: result.documentIds.length,
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    const result = await runWorker("search", {
      containerTag: options.containerTag,
      query,
      limit: options.limit ?? 10,
      threshold: options.threshold ?? 0.3,
    })

    return result.results ?? []
  }

  async clear(containerTag: string): Promise<void> {
    await runWorker("clear", { containerTag })
  }
}

export default GSpotProvider
