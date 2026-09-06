// Host-side engine qualification only: both engines execute WASM, not native SQL.
import assert from "node:assert/strict";
import initSqlJs from "sql.js";
import initSqlite from "@sqlite.org/sqlite-wasm";

const legacy = await initSqlJs();
const old = new legacy.Database();
const bound = old.exec("SELECT typeof(?)", [9007199254740993n])[0].values[0][0];
assert.equal(bound, "text");
assert.equal(typeof legacy._sqlite3_bind_int64, "undefined");
assert.equal(typeof legacy._sqlite3_get_autocommit, "undefined");
old.run("CREATE TABLE t(x); BEGIN; INSERT INTO t VALUES(1)");
old.export();
assert.equal(old.exec("SELECT count(*) FROM t")[0].values[0][0], 0);
old.close();

const sqlite = await initSqlite();
const db = new sqlite.oo1.DB(":memory:", "c");
assert.equal(sqlite.capi.sqlite3_libversion(), "3.49.1");
const stmt = db.prepare("SELECT typeof(?), ?");
stmt.bind([9007199254740993n, 9007199254740993n]);
assert.equal(stmt.step(), true);
assert.equal(stmt.get(0), "integer");
assert.equal(stmt.get(1), 9007199254740993n);
stmt.finalize();
db.exec("CREATE TABLE t(x); BEGIN; INSERT INTO t VALUES(1)");
assert.equal(sqlite.capi.sqlite3_get_autocommit(db.pointer), 0);
sqlite.capi.sqlite3_js_db_export(db.pointer);
assert.equal(sqlite.capi.sqlite3_get_autocommit(db.pointer), 0);
db.exec("ROLLBACK");
assert.equal(db.selectValue("SELECT count(*) FROM t"), 0);
db.close();
console.log(JSON.stringify({ sqljs: { version: "1.13.0", bigintBindType: bound, exportRollsBack: true }, official: { version: "3.49.1-build1", sqlite: "3.49.1", exactIntegerBind: true, exportPreservesTransaction: true } }, null, 2));
