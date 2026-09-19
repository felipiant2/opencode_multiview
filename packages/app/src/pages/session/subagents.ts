import type { Session, SessionStatus } from "@opencode-ai/sdk/v2/client"
import { createEffect, createMemo, createSignal, on } from "solid-js"
import { useSDK } from "@/context/sdk"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { normalizeSessionInfo } from "@/utils/session"

const PAGE_SIZE = 200
const MAX_PAGES = 50
const REFRESH_TTL = 30_000

const inflight = new Map<string, Promise<void>>()
const refreshedAt = new Map<string, number>()

export type SessionSubagent = {
  session: Session
  depth: number
  status: SessionStatus["type"]
  tokens: number
}

export function sessionTokenTotal(tokens: Session["tokens"]) {
  if (!tokens) return 0
  return tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
}

export function sessionModelLabel(session: Session) {
  if (!session.model) return "—"
  return session.model.variant ? `${session.model.id} · ${session.model.variant}` : session.model.id
}

export function buildSessionSubagents(
  root: string,
  sessions: readonly Session[],
  statuses: Readonly<Record<string, SessionStatus | undefined>>,
  directory: string,
): SessionSubagent[] {
  const children = new Map<string, Session[]>()

  for (const session of sessions) {
    if (!session.parentID || session.directory !== directory) continue
    const bucket = children.get(session.parentID)
    if (bucket) bucket.push(session)
    else children.set(session.parentID, [session])
  }

  const output: SessionSubagent[] = []
  const seen = new Set<string>([root])
  const visit = (parentID: string, depth: number) => {
    const direct = (children.get(parentID) ?? []).slice().sort((a, b) => a.time.created - b.time.created)
    for (const session of direct) {
      if (seen.has(session.id)) continue
      seen.add(session.id)
      output.push({
        session,
        depth,
        status: statuses[session.id]?.type ?? "idle",
        tokens: sessionTokenTotal(session.tokens),
      })
      visit(session.id, depth + 1)
    }
  }

  visit(root, 0)
  return output
}

export function createSessionSubagents(rootID: () => string | undefined) {
  const sdk = useSDK()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<unknown>()

  const loadDirectory = (force = false) => {
    const directory = sdk().directory
    const server = serverSDK()
    const sync = serverSync()
    const key = `${String(server.scope)}:${directory}`
    const recent = Date.now() - (refreshedAt.get(key) ?? 0) < REFRESH_TTL

    if (!force && recent) return Promise.resolve()

    const pending = inflight.get(key)
    if (pending) return pending

    const task = (async () => {
      let cursor: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const response = await server.api.session.list({
          directory,
          limit: PAGE_SIZE,
          order: "desc",
          cursor,
        })
        response.data.forEach((item) => sync.session.remember(normalizeSessionInfo(item)))
        cursor = response.cursor.next ?? undefined
        if (!cursor) break
      }
      refreshedAt.set(key, Date.now())
    })().finally(() => {
      if (inflight.get(key) === task) inflight.delete(key)
    })

    inflight.set(key, task)
    return task
  }

  const refresh = async (force = false) => {
    if (!rootID()) return
    setLoading(true)
    setError(undefined)
    try {
      await loadDirectory(force)
    } catch (cause) {
      setError(cause)
    } finally {
      setLoading(false)
    }
  }

  createEffect(
    on(
      [rootID, () => sdk().directory, () => serverSDK().scope] as const,
      () => void refresh(),
    ),
  )

  const items = createMemo<SessionSubagent[]>(() => {
    const root = rootID()
    if (!root) return []
    const sessions = Object.values(serverSync().session.data.info).filter((session): session is Session => !!session)
    return buildSessionSubagents(root, sessions, serverSync().session.data.session_status, sdk().directory)
  })

  const totalCost = createMemo(() => items().reduce((sum, item) => sum + (item.session.cost ?? 0), 0))
  const totalTokens = createMemo(() => items().reduce((sum, item) => sum + item.tokens, 0))

  return {
    items,
    loading,
    error,
    totalCost,
    totalTokens,
    refresh: () => refresh(true),
  }
}
