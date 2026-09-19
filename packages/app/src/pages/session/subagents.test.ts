import { describe, expect, test } from "bun:test"
import type { Session } from "@opencode-ai/sdk/v2/client"
import { buildSessionSubagents, sessionTokenTotal } from "./subagents"

function session(input: {
  id: string
  parentID?: string
  created: number
  directory?: string
  cost?: number
  tokens?: Partial<NonNullable<Session["tokens"]>>
}): Session {
  return {
    id: input.id,
    slug: input.id,
    projectID: "project",
    directory: input.directory ?? "/repo",
    parentID: input.parentID,
    title: input.id,
    version: "",
    cost: input.cost ?? 0,
    tokens: {
      input: input.tokens?.input ?? 0,
      output: input.tokens?.output ?? 0,
      reasoning: input.tokens?.reasoning ?? 0,
      cache: input.tokens?.cache ?? { read: 0, write: 0 },
    },
    time: {
      created: input.created,
      updated: input.created,
    },
  }
}

describe("buildSessionSubagents", () => {
  test("flattens nested descendants in creation order", () => {
    const sessions = [
      session({ id: "root", created: 1 }),
      session({ id: "b", parentID: "root", created: 3 }),
      session({ id: "a", parentID: "root", created: 2 }),
      session({ id: "a-child", parentID: "a", created: 4 }),
      session({ id: "other", parentID: "missing", created: 5 }),
    ]

    const items = buildSessionSubagents(
      "root",
      sessions,
      {
        a: { type: "busy" },
        "a-child": { type: "retry", attempt: 1, message: "retry", next: 10 },
      },
      "/repo",
    )

    expect(items.map((item) => [item.session.id, item.depth, item.status])).toEqual([
      ["a", 0, "busy"],
      ["a-child", 1, "retry"],
      ["b", 0, "idle"],
    ])
  })

  test("ignores child sessions from another directory", () => {
    const items = buildSessionSubagents(
      "root",
      [
        session({ id: "same", parentID: "root", created: 2 }),
        session({ id: "other-dir", parentID: "root", created: 3, directory: "/other" }),
      ],
      {},
      "/repo",
    )

    expect(items.map((item) => item.session.id)).toEqual(["same"])
  })

  test("sums all session token buckets", () => {
    expect(
      sessionTokenTotal(
        session({
          id: "tokens",
          created: 1,
          tokens: { input: 10, output: 5, reasoning: 2, cache: { read: 20, write: 3 } },
        }).tokens,
      ),
    ).toBe(40)
  })
})
