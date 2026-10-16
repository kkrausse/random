// The Pi's database still holds the retired v2 beta's session_message rows next to the 1.18
// history. Every one of them was copied into the 1.18 message table when the server went back to
// 1.18, but v2 refuses to start on a database that has session_message rows and 1.18-only chats.
// When every beta row is already present in message, move the table aside (kept, not deleted) and
// leave an empty one so v2 imports the 1.18 history normally.
import { Database } from "bun:sqlite"

const db = new Database(process.argv[2])
const count = (sql: string) => (db.query(sql).get() as { c: number }).c
const hasTable = (name: string) =>
  count(`SELECT count(*) c FROM sqlite_master WHERE type = 'table' AND name = '${name}'`) > 0

if (!hasTable("session_message") || !hasTable("message") || count("SELECT count(*) c FROM session_message") === 0) {
  process.exit(0)
}
const missing = count(`SELECT count(*) c FROM session_message sm
  WHERE sm.type NOT IN ('user', 'assistant')
     OR NOT EXISTS (SELECT 1 FROM message m WHERE m.id = sm.id)`)
if (missing > 0) {
  console.error(`${missing} beta session_message rows are not in message; leaving the database alone.`)
  process.exit(1)
}
if (hasTable("beta_session_message_kept")) {
  console.error("beta_session_message_kept already exists; leaving the database alone.")
  process.exit(1)
}
db.transaction(() => {
  db.run("ALTER TABLE session_message RENAME TO beta_session_message_kept")
  db.run("CREATE TABLE session_message AS SELECT * FROM beta_session_message_kept WHERE 0")
})()
console.log(`Set aside ${count("SELECT count(*) c FROM beta_session_message_kept")} duplicate beta rows.`)
db.close()
