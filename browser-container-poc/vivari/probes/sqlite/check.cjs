// Real sql.js backend qualification, not a replacement OpenCode database service.
// Loading follows Vivari's upstream scripts/spike-sqlite.mjs pattern.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const initSqlJs = require("sql.js");
const filename = "/sqlite-probe/session.sqlite";
const phase = process.argv[2];
(async () => {
  const SQL = await initSqlJs({ locateFile: file => require.resolve("sql.js/dist/" + file) });
  const db = phase === "recover" ? new SQL.Database(fs.readFileSync(filename)) : new SQL.Database();
  const scalar = sql => db.exec(sql)[0].values[0][0];
  try {
    if (phase === "write") {
      db.run("PRAGMA foreign_keys = ON");
      db.run("CREATE TABLE session (id TEXT PRIMARY KEY, body TEXT, payload BLOB)");
      db.run("CREATE TABLE message (session_id TEXT REFERENCES session(id))");
      db.run("INSERT INTO session VALUES (?, ?, ?)", ["session-1", JSON.stringify({ text: "browser SQLite" }), new Uint8Array([0, 128, 255])]);
      assert.throws(() => db.run("INSERT INTO message VALUES ('missing')"));
      db.run("BEGIN");
      db.run("UPDATE session SET body = 'rolled back'");
      db.run("ROLLBACK");
      assert.equal(scalar("SELECT json_extract(body, '$.text') FROM session"), "browser SQLite");
      assert.equal(db.exec("UPDATE session SET id = id RETURNING id")[0].values[0][0], "session-1");
      const statement = db.prepare("SELECT CAST('9007199254740993' AS INTEGER)");
      try {
        assert.equal(statement.step(), true);
        assert.equal(statement.get(null, { useBigInt: true })[0], 9007199254740993n);
      } finally { statement.free(); }
      fs.writeFileSync(filename, db.export());
    } else if (phase !== "recover") throw new Error("Expected write or recover");
    assert.equal(scalar("SELECT json_extract(body, '$.text') FROM session"), "browser SQLite");
    assert.deepEqual(Array.from(scalar("SELECT payload FROM session")), [0, 128, 255]);
    console.log("SQLITE_RESULT " + JSON.stringify({ ok: true, phase, sqlite: scalar("SELECT sqlite_version()"),
      bytes: fs.statSync(filename).size, rows: scalar("SELECT count(*) FROM session") }));
  } finally { db.close(); }
})().catch(error => {
  console.log("SQLITE_RESULT " + JSON.stringify({ ok: false, phase, error: String(error), stack: error.stack }));
  process.exitCode = 1;
});
