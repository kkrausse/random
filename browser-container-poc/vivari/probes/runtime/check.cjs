// Each case runs in a separate Vivari process. A named API alone is not a pass.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const name = process.argv[2];
const cases = {
  conditions() {
    return { selected: require("#runtime"), arch: process.arch, platform: process.platform,
      bun: typeof Bun === "undefined" ? null : Bun.version, versions: process.versions };
  },
  "bun-sqlite"() {
    const { Database } = require("bun:sqlite");
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE probe (value TEXT)");
      db.query("INSERT INTO probe VALUES (?)").run("actual query");
      assert.equal(db.query("SELECT value FROM probe").get().value, "actual query");
      return "insert/select";
    } finally { db.close(); }
  },
  "node-sqlite"() {
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    try {
      db.exec("CREATE TABLE probe (value TEXT)");
      db.prepare("INSERT INTO probe VALUES (?)").run("actual query");
      const query = db.prepare("SELECT value FROM probe");
      query.setReadBigInts(true);
      query.setReturnArrays(true);
      assert.equal(query.all()[0][0], "actual query");
      return "insert/select with OpenCode statement options";
    } finally { db.close(); }
  },
  "bun-ffi"() {
    const { dlopen } = require("bun:ffi");
    const library = dlopen("libc.so.6", {
      flock: { args: ["i32", "i32"], returns: "i32" },
      __errno_location: { args: [], returns: "ptr" },
    });
    library.close();
    return "library opened only; locking semantics still untested";
  },
  "node-ffi"() {
    const { dlopen } = require("node:ffi");
    const library = dlopen("libc.so.6", {
      flock: { arguments: ["int32", "int32"], return: "int32" },
      __errno_location: { arguments: [], return: "pointer" },
    });
    library.lib.close();
    return "library opened only; locking semantics still untested";
  },
  filesystem() {
    const dir = fs.mkdtempSync("/tmp/opencode-fs-");
    try {
      fs.writeFileSync(`${dir}/before`, "original");
      fs.renameSync(`${dir}/before`, `${dir}/after`);
      fs.appendFileSync(`${dir}/after`, " edited");
      assert.equal(fs.readFileSync(`${dir}/after`, "utf8"), "original edited");
      assert.equal(fs.statSync(`${dir}/after`).isFile(), true);
      assert.throws(() => fs.openSync(`${dir}/after`, "wx"), { code: "EEXIST" });
      return "read/write/rename/stat/exclusive-create";
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  },
  async subprocess() {
    const { spawn } = require("node:child_process");
    const child = spawn("node", ["-e", "process.stdout.write('out');process.stderr.write('err');process.exit(7)"],
      { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr += data; });
    const code = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", resolve);
    });
    assert.equal(code, 7);
    assert.equal(stdout, "out");
    assert.equal(stderr, "err");
    return { stdout, stderr, code };
  },
};
(async () => {
  try {
    if (!cases[name]) throw new Error(`Unknown case: ${name}`);
    console.log("RUNTIME_RESULT " + JSON.stringify({ name, ok: true, result: await cases[name]() }));
  } catch (error) {
    console.log("RUNTIME_RESULT " + JSON.stringify({ name, ok: false, error: String(error), stack: error.stack }));
    process.exitCode = 1;
  }
})();
