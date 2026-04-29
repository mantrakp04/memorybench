import { existsSync, readFileSync, rmSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { UnifiedMessage, UnifiedSession } from "../../types/unified"

type EntityType = "person" | "organization" | "project" | "concept" | "tool" | "event" | "preference"
type ObservationType = "fact" | "event" | "preference" | "belief" | "procedure" | "reflection"

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

  const observations: ExtractedObservation[] = session.messages
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
    .filter((observation) => observation.content.trim().length > 0)

  const edges: ExtractedEdge[] = speakers.map((speaker) => ({
    sourceName: speaker,
    targetName: sessionEntity,
    relationshipType: "participated_in",
    description: `${speaker} participated in ${sessionEntity}`,
  }))

  return { entities, observations, edges }
}

async function ingestSessions(payload: Payload) {
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

  for (const session of payload.sessions ?? []) {
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

  console.log(JSON.stringify({ documentIds }))
}

async function searchMemory(payload: Payload) {
  await ensureSchema(payload.containerTag)
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

  const result = await query(payload.query ?? "", {
    topK: payload.limit ?? 10,
    threshold: payload.threshold ?? 0.3,
    includeGraph: true,
    includeScratchpad: false,
  })

  console.log(
    JSON.stringify({
      results: [
        ...result.observations.map((item) => ({
          kind: "observation",
          id: item.id,
          content: item.content,
          score: item.score,
          similarity: item.similarity,
          salience: item.salience,
          confidence: item.confidence,
        })),
        ...result.triplets.map((item) => ({
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
