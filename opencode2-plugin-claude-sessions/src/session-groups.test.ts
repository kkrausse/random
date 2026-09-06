import { strict as assert } from "node:assert"
import { test } from "node:test"
import { descendantIDs, groupLabel, propagateAttention, sessionState, sortRows, visibleSessions, type SessionState } from "./session-groups"

test("attention and running override an inactive marker", () => {
  assert.equal(sessionState("permission", true, true), "permission")
  assert.equal(sessionState("question", false, true), "question")
  assert.equal(sessionState(undefined, true, true), "running")
  assert.equal(sessionState(undefined, false, true), "inactive")
  assert.equal(sessionState(undefined, false, false), "idle")
})

test("input comes first and each tranche is ordered by recency", () => {
  const row = (id: string, state: SessionState, updated: number) => ({ state, session: { id, time: { updated } } })
  const rows = sortRows([
    row("inactive-old", "inactive", 30), row("ready-old", "idle", 20),
    row("permission", "permission", 1), row("working-old", "running", 10),
    row("inactive-new", "inactive", 300), row("question", "question", 2),
    row("ready-new", "idle", 200), row("working-new", "running", 100),
  ])
  assert.deepEqual(rows.map((row) => row.session.id), [
    "question", "permission", "working-new", "working-old", "ready-new", "ready-old", "inactive-new", "inactive-old",
  ])
  for (const state of ["permission", "question", "running", "idle"] as const) {
    assert.equal(groupLabel(state), "Active")
  }
  assert.equal(groupLabel("inactive"), "Inactive")
  assert.equal(groupLabel("new"), undefined)
})

test("subagent sessions hide under their parent but keep attention", () => {
  const sessions = [
    { id: "parent", parentID: undefined },
    { id: "child", parentID: "parent" },
    { id: "grandchild", parentID: "child" },
    { id: "orphan", parentID: "missing" },
    { id: "other", parentID: undefined },
  ]
  assert.deepEqual(
    visibleSessions(sessions).map((s) => s.id).sort(),
    ["orphan", "other", "parent"],
  )
  // Current child session stays visible so it can't disappear underneath you.
  assert.ok(visibleSessions(sessions, "child").some((s) => s.id === "child"))

  const attention = propagateAttention(sessions, new Map([
    ["grandchild", "permission"],
    ["orphan", "question"],
    ["other", "question"],
  ]))
  assert.equal(attention.get("parent"), "permission")
  assert.equal(attention.get("orphan"), "question")
  assert.equal(attention.get("other"), "question")
  assert.equal(attention.has("grandchild"), false)

  // Permission outranks question when several children need input.
  const mixed = propagateAttention(sessions, new Map([
    ["child", "question"],
    ["grandchild", "permission"],
  ]))
  assert.equal(mixed.get("parent"), "permission")

  assert.deepEqual(descendantIDs(sessions, "parent").sort(), ["child", "grandchild"])
  assert.deepEqual(descendantIDs(sessions, "other"), [])
})
