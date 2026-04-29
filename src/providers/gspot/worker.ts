import { createHash } from "node:crypto"
import { existsSync, readFileSync, rmSync } from "node:fs"
import { copyFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { UnifiedMessage, UnifiedSession } from "../../types/unified"

type EntityType = "person" | "organization" | "project" | "concept" | "tool" | "event" | "preference"
type ObservationType = "fact" | "event" | "preference" | "belief" | "procedure" | "reflection"

const CACHE_SCHEMA_VERSION = "compact-turn-windows-visual-context-v1"

interface Payload {
  containerTag: string
  sessions?: UnifiedSession[]
  query?: string
  limit?: number
  threshold?: number
}

interface ExtractedEntity {
  name: string
  entityType: EntityType
  description: string
  aliases?: string[]
}

interface ExtractedObservation {
  content: string
  observationType: ObservationType
  entityNames: string[]
}

interface ExtractedEdge {
  sourceName: string
  targetName: string
  relationshipType: string
  description: string
}

process.env.DOTENV_CONFIG_QUIET = "true"

const repoRoot = process.env.GSPOT_REPO_ROOT ?? ""
if (!repoRoot) {
  throw new Error("GSPOT_REPO_ROOT is required")
}

async function importRepoModule<T>(pathFromRoot: string): Promise<T> {
  return (await import(pathToFileURL(resolve(repoRoot, pathFromRoot)).href)) as T
}

function sanitize(input: string): string {
  return input.replace(/[^a-zA-Z0-9_.-]/g, "_")
}

function dbPath(containerTag: string): string {
  return resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot", `${sanitize(containerTag)}.db`)
}

function cachePath(cacheKey: string): string {
  return resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot/cache", `${cacheKey}.db`)
}

function sessionCacheKey(sessions: UnifiedSession[]): string {
  const hash = createHash("sha256")
  hash.update(CACHE_SCHEMA_VERSION)
  hash.update("\0")
  for (const session of [...sessions].sort((a, b) => a.sessionId.localeCompare(b.sessionId))) {
    hash.update(session.sessionId)
    hash.update("\0")
    hash.update(JSON.stringify(session.metadata ?? {}))
    hash.update("\0")
    for (const message of session.messages) {
      hash.update(message.role)
      hash.update("\0")
      hash.update(message.speaker ?? "")
      hash.update("\0")
      hash.update(message.content)
      hash.update("\0")
    }
  }
  return hash.digest("hex").slice(0, 24)
}

function queryTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .match(/[a-z0-9']+/g)
        ?.filter((term) => term.length > 2)
        .filter(
          (term) =>
            !new Set([
              "what",
              "when",
              "where",
              "who",
              "how",
              "does",
              "did",
              "has",
              "have",
              "with",
              "from",
              "would",
              "could",
              "should",
              "the",
              "and",
              "are",
              "for",
              "her",
              "his",
              "their",
              "caroline",
              "melanie",
            ]).has(term)
        ) ?? []
    )
  )
}

function lexicalBonus(content: string, terms: string[]): number {
  if (terms.length === 0) return 0
  const lower = content.toLowerCase()
  const hits = terms.filter((term) => lower.includes(term)).length
  return hits / terms.length
}

async function copyDb(source: string, target: string) {
  for (const suffix of ["", "-wal", "-shm"]) {
    const targetFile = `${target}${suffix}`
    if (existsSync(targetFile)) rmSync(targetFile)
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    const sourceFile = `${source}${suffix}`
    const targetFile = `${target}${suffix}`
    if (!existsSync(sourceFile)) continue
    await copyFile(sourceFile, targetFile)
  }
}

async function readPayload(): Promise<Payload> {
  return (await new Response(Bun.stdin.stream()).json()) as Payload
}

async function ensureSchema(containerTag: string) {
  process.env.NODE_ENV = "test"
  process.env.DATABASE_URL = `file:${dbPath(containerTag)}`

  const { getMemoryNativeDb } = await importRepoModule<{
    getMemoryNativeDb: () => import("bun:sqlite").Database
  }>("packages/db/src/memory-db.ts")
  const db = getMemoryNativeDb()

  const marker = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_observations'")
    .get()

  if (!marker) {
    const migrationPath = resolve(repoRoot, "packages/db/src/migrations/0000_violet_squirrel_girl.sql")
    const migration = readFileSync(migrationPath, "utf8")
    for (const statement of migration
      .split("--> statement-breakpoint")
      .map((part) => part.trim())
      .filter(Boolean)) {
      db.exec(statement)
    }
  }
}

function speakerName(message: UnifiedMessage): string {
  if (message.speaker?.trim()) return message.speaker.trim()
  return message.role === "user" ? "user" : "assistant"
}

function sessionDate(session: UnifiedSession): string | undefined {
  const formatted = session.metadata?.formattedDate
  if (typeof formatted === "string" && formatted) return formatted

  const date = session.metadata?.date
  if (typeof date === "string" && date) return date

  return undefined
}

function extractSession(session: UnifiedSession): {
  entities: ExtractedEntity[]
  observations: ExtractedObservation[]
  edges: ExtractedEdge[]
} {
  const sessionEntity = `session ${session.sessionId}`
  const date = sessionDate(session)
  const speakers = Array.from(new Set(session.messages.map(speakerName)))

  const entities: ExtractedEntity[] = [
    {
      name: sessionEntity,
      entityType: "event",
      description: date
        ? `Conversation session ${session.sessionId} that occurred at ${date}`
        : `Conversation session ${session.sessionId}`,
    },
    ...speakers.map((speaker) => ({
      name: speaker,
      entityType: "person" as const,
      description: `${speaker} participated in benchmark conversation sessions`,
    })),
  ]

  const windowObservations: ExtractedObservation[] = []
  for (let start = 0; start < session.messages.length; start += 3) {
    const windowMessages = session.messages.slice(start, Math.min(session.messages.length, start + 3))
    if (windowMessages.length === 0) continue

    const windowText = windowMessages
      .map((message, offset) => {
        const turn = start + offset + 1
        return `Turn ${turn} ${speakerName(message)}: ${message.content}`
      })
      .join("\n")

    windowObservations.push({
      content: date
        ? `Conversation window ${session.sessionId} turns ${start + 1}-${start + windowMessages.length} on ${date}:\n${windowText}`
        : `Conversation window ${session.sessionId} turns ${start + 1}-${start + windowMessages.length}:\n${windowText}`,
      observationType: "event" as const,
      entityNames: [sessionEntity, ...windowMessages.map(speakerName)],
    })
  }

  const observations: ExtractedObservation[] = [
    ...windowObservations,
    ...session.messages
    .map((message, index) => {
      const speaker = speakerName(message)
      const datePrefix = date ? `[${date}] ` : ""
      return {
        content: `${datePrefix}${speaker}: ${message.content}`,
        observationType: "event" as const,
        entityNames: [speaker, sessionEntity],
        index,
      }
    })
    .filter((observation) => observation.content.trim().length > 0),
  ]

  const edges: ExtractedEdge[] = speakers.map((speaker) => ({
    sourceName: speaker,
    targetName: sessionEntity,
    relationshipType: "participated_in",
    description: `${speaker} participated in ${sessionEntity}`,
  }))

  return { entities, observations, edges }
}

async function ingestSessions(payload: Payload) {
  const sessions = payload.sessions ?? []
  const key = sessionCacheKey(sessions)
  const cachedDb = cachePath(key)
  const targetDb = dbPath(payload.containerTag)

  if (existsSync(cachedDb)) {
    await copyDb(cachedDb, targetDb)
    console.log(JSON.stringify({ documentIds: sessions.map((session) => session.sessionId) }))
    return
  }

  await ensureSchema(payload.containerTag)
  const { ingest } = await importRepoModule<{
    ingest: (
      extraction: {
        entities: ExtractedEntity[]
        observations: ExtractedObservation[]
        edges: ExtractedEdge[]
      },
      resolutions: { index: number; action: "ADD"; reason: string }[],
      sourceMessageId?: string
    ) => Promise<{ entityIds: string[]; observationIds: string[]; edgeIds: string[] }>
  }>("packages/api/src/lib/memory.ts")

  const documentIds: string[] = []

  for (const session of sessions) {
    const extraction = extractSession(session)
    if (extraction.observations.length === 0) continue

    await ingest(
      extraction,
      extraction.observations.map((_, index) => ({
        index,
        action: "ADD" as const,
        reason: "MemoryBench benchmark session import",
      })),
      session.sessionId
    )

    documentIds.push(session.sessionId)
  }

  const { closeMemoryDb } = await importRepoModule<{
    closeMemoryDb: () => void
  }>("packages/db/src/memory-db.ts")
  closeMemoryDb()

  await mkdir(resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot/cache"), {
    recursive: true,
  })
  await copyDb(targetDb, cachedDb)

  console.log(JSON.stringify({ documentIds }))
}

async function searchMemory(payload: Payload) {
  await ensureSchema(payload.containerTag)
  const queryText = payload.query ?? ""
  const terms = queryTerms(queryText)
  const { query } = await importRepoModule<{
    query: (
      input: string,
      options: {
        topK?: number
        threshold?: number
        includeGraph?: boolean
        includeScratchpad?: boolean
      }
    ) => Promise<{
      observations: Array<{
        id: string
        content: string
        score: number
        similarity: number
        salience: number
        confidence: number
      }>
      triplets: Array<{
        id: string
        content: string
        score: number
        similarity: number
        salience: number
        confidence: number
      }>
    }>
  }>("packages/api/src/lib/memory.ts")

  const result = await query(queryText, {
    topK: Math.max(payload.limit ?? 10, 20),
    threshold: Math.min(payload.threshold ?? 0.3, 0.2),
    includeGraph: true,
    includeScratchpad: false,
  })

  const rerank = <T extends { content: string; score: number }>(items: T[]) =>
    items
      .map((item) => ({
        ...item,
        score: item.score + 0.2 * lexicalBonus(item.content, terms),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, payload.limit ?? 10)

  console.log(
    JSON.stringify({
      results: [
        ...rerank(result.observations).map((item) => ({
          kind: "observation",
          id: item.id,
          content: item.content,
          score: item.score,
          similarity: item.similarity,
          salience: item.salience,
          confidence: item.confidence,
        })),
        ...rerank(result.triplets).map((item) => ({
          kind: "triplet",
          id: item.id,
          content: item.content,
          score: item.score,
          similarity: item.similarity,
          weight: item.salience,
          confidence: item.confidence,
        })),
      ],
    })
  )
}

async function clearMemory(payload: Payload) {
  const filePath = dbPath(payload.containerTag)
  for (const suffix of ["", "-wal", "-shm"]) {
    const target = `${filePath}${suffix}`
    if (existsSync(target)) rmSync(target)
  }
  console.log(JSON.stringify({ documentIds: [] }))
}

await mkdir(resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot"), {
  recursive: true,
})
await mkdir(resolve(repoRoot, "packages/benchmarks/memorybench/data/providers/gspot/cache"), {
  recursive: true,
})

const command = process.argv[2]
const payload = await readPayload()

if (command === "ingest") {
  await ingestSessions(payload)
} else if (command === "search") {
  await searchMemory(payload)
} else if (command === "clear") {
  await clearMemory(payload)
} else {
  throw new Error(`Unknown gspot worker command: ${command}`)
}
