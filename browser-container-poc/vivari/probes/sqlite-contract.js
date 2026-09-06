// The identical async server contract runs with real SQLite/VFS in Bun and Chrome.
export async function sqliteContract(request, release, filename = "/test/contract.sqlite") {
  const checks = [];
  const equal = (actual, expected, name) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${name}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    checks.push(name);
  };
  const rejects = async (fn, text) => {
    try { await fn(); } catch (error) {
      if (!String(error).includes(text)) throw error;
      checks.push(text); return;
    }
    throw new Error(`Expected rejection: ${text}`);
  };
  let { id } = await request(1, { method: "open", path: filename });
  const exec = (sql, args, statement = false) => request(1, { method: "execute", id, sql, args, statement });
  const values = async sql => (await exec(sql, [], true)).rows;
  await exec("DROP TABLE IF EXISTS audit; DROP TABLE IF EXISTS x; CREATE TABLE x(value); CREATE TABLE audit(value);");
  await exec("CREATE TRIGGER log AFTER INSERT ON x BEGIN INSERT INTO audit VALUES('trigger;value'); INSERT INTO audit VALUES(new.value); END; INSERT INTO x VALUES('committed;prefix'); BEGIN; UPDATE x SET value='pending';");
  await rejects(() => request(2, { method: "open", path: filename }), "SQLITE_BUSY");
  release(1);
  ({ id } = await request(1, { method: "open", path: filename }));
  equal(await values("SELECT value FROM x"), [[["v", "committed;prefix"]]], "committed prefix survives release");
  equal(await values("SELECT value FROM audit"), [[["v", "trigger;value"]], [["v", "committed;prefix"]]], "SQLite parser respects trigger and quoted semicolons");
  await rejects(() => exec("UPDATE x SET value='before-error'; SELECT * FROM missing_table;"), "missing_table");
  release(1);
  ({ id } = await request(1, { method: "open", path: filename }));
  equal(await values("SELECT value FROM x"), [[["v", "before-error"]]], "successful prefix of failed exec persists");
  await exec("BEGIN; UPDATE x SET value='outer'; SAVEPOINT inner; UPDATE x SET value='inner'; ROLLBACK TO inner; RELEASE inner; COMMIT;");
  equal(await values("SELECT value FROM x"), [[["v", "outer"]]], "savepoint rollback");
  await exec("BEGIN; UPDATE x SET value='discard'; ROLLBACK;");
  equal(await values("SELECT value FROM x"), [[["v", "outer"]]], "transaction rollback");
  equal((await exec("SELECT ?, ?, ?, ?", [["i", "-9223372036854775808"], ["i", "9223372036854775807"], ["n", "Infinity"], ["n", "-Infinity"]], true)).rows,
    [[["i", "-9223372036854775808"], ["i", "9223372036854775807"], ["n", "Infinity"], ["n", "-Infinity"]]], "int64 limits and infinities");
  equal((await exec("SELECT ?", [["n", "NaN"]], true)).rows, [[["v", null]]], "SQLite maps NaN to NULL");
  await rejects(() => exec("SELECT ?", [], true), "SQLITE_RANGE");
  await rejects(() => exec("SELECT 1", [["v", 2]], true), "SQLITE_RANGE");
  await rejects(() => exec("ATTACH ':memory:' AS other"), "authorized");
  equal(await values("PRAGMA integrity_check"), [[["v", "ok"]]], "database integrity");
  release(1);
  return checks;
}

export function sqliteRequests(server, vfs) {
  let seq = 0;
  const enc = new TextEncoder(), dec = new TextDecoder();
  return async (client, req) => {
    const path = `/tmp/contract-${++seq}`;
    vfs.write_file(path, enc.encode(JSON.stringify(req)));
    try {
      await server.request(client, path);
      const response = JSON.parse(dec.decode(vfs.read_file(path + ".out")));
      if (response.error) throw new Error(response.error);
      return response.result;
    } finally {
      vfs.unlink(path);
      if (vfs.exists(path + ".out")) vfs.unlink(path + ".out");
    }
  };
}
