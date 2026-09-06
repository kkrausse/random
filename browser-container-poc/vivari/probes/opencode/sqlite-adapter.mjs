// Exercise the actual pinned OpenCode adapters, not a lookalike implementation.
import assert from "node:assert/strict";
import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { sqliteLayer as nodeLayer } from "@opencode-ai/core/database/sqlite.node";
import { sqliteLayer as bunLayer } from "@opencode-ai/core/database/sqlite.bun";

async function main() {
  for (const [name, layer] of [["node", nodeLayer], ["bun", bunLayer]]) {
    const filename = `/opencode-packaged/adapter-${name}.sqlite`;
    for (const mode of process.env.OPENCODE_PROBE_RECOVER === "1" ? ["recover"] : ["write", "recover"]) {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        if (mode === "write") {
          yield* sql.unsafe("DROP TABLE IF EXISTS adapter_checkpoint");
          yield* sql.unsafe("CREATE TABLE adapter_checkpoint (id INTEGER PRIMARY KEY, value TEXT NOT NULL, exact INTEGER, bytes BLOB)");
          yield* sql.withTransaction(Effect.gen(function* () {
            yield* sql.unsafe("INSERT INTO adapter_checkpoint VALUES (?, ?, ?, ?)", [1, "committed", 9007199254740993n, new Uint8Array([0, 127, 255])]);
          }));
          const rollback = yield* Effect.exit(sql.withTransaction(Effect.gen(function* () {
            yield* sql.unsafe("UPDATE adapter_checkpoint SET value = 'rolled back'");
            return yield* Effect.fail("deliberate rollback");
          })));
          assert.equal(rollback._tag, "Failure");
        }
        const rows = yield* sql.unsafe("SELECT value, bytes FROM adapter_checkpoint");
        assert.equal(rows.length, 1);
        assert.equal(rows[0].value, "committed");
        assert.deepEqual(Array.from(rows[0].bytes), [0, 127, 255]);
        const exact = yield* sql.unsafe("SELECT exact FROM adapter_checkpoint").pipe(Effect.provideService(SqlClient.SafeIntegers, true));
        assert.equal(exact[0].exact, 9007199254740993n);
        const values = yield* sql.unsafe("SELECT value FROM adapter_checkpoint").values;
        assert.deepEqual(values, [["committed"]]);
        console.log("checkpoint: adapter", name, mode);
      }).pipe(Effect.provide(layer({ filename })))));
    }
  }
  console.log("checkpoint: adapters passed");
}
main().catch(error => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
