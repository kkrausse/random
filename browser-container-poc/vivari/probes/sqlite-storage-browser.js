export async function qualifySqliteStorage() {
  const results = [];
  const roots = [];
  const workers = new Set();
  const root = () => { const value = `vv-sqlite-test-${crypto.randomUUID()}`; roots.push(value); return value; };
  const check = (value, name) => { if (!value) throw new Error(name); results.push(name); };
  async function rejects(fn, text) {
    try { await fn(); } catch (error) { check(String(error).includes(text), `rejection: ${text} (${error})`); return; }
    throw new Error(`Expected ${text}`);
  }
  function worker() {
    const w = new Worker(new URL("./sqlite-storage-worker.js", import.meta.url), { type: "module" });
    workers.add(w);
    let seq = 0;
    const pending = new Map();
    let eventResolve;
    const event = new Promise(resolve => { eventResolve = resolve; });
    w.onmessage = ({ data }) => {
      if (data.event) { eventResolve(data); return; }
      const item = pending.get(data.id);
      if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      data.error ? item.reject(new Error(data.error)) : item.resolve(data.result);
    };
    const stop = () => {
      w.terminate(); workers.delete(w);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("Worker terminated")); }
      pending.clear();
    };
    const call = (method, args) => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 30000);
      pending.set(id, { resolve, reject, timer }); w.postMessage({ id, method, args });
    });
    return { call, stop, event };
  }
  async function boot(name) {
    const w = worker();
    try { await w.call("init", { root: name }); return w; } catch (error) { w.stop(); throw error; }
  }
  const open = async w => (await w.call("request", { req: { method: "open", path: "/test/db.sqlite" } })).id;
  const sql = (w, id, text) => w.call("request", { req: { method: "execute", id, sql: text } });
  const read = async w => {
    const id = await open(w);
    const r = await sql(w, id, "SELECT value FROM x");
    check((await sql(w, id, "PRAGMA integrity_check")).rows[0][0][1] === "ok", "reopened database integrity");
    return r.rows[0][0][1];
  };
  try {
    const name = root();
    let w = await boot(name);
    results.push(...await w.call("contract"));
    await rejects(() => boot(name), "already owned");
    w.stop();
    w = await boot(name);
    check(true, "Web Lock released by worker termination; OPFS restored in fresh worker");
    w.stop();

    for (const file of ["files/test/db.sqlite", "manifest.json"]) {
      const name = root();
      let w = await boot(name);
      const id = await open(w);
      await sql(w, id, "CREATE TABLE x(value); INSERT INTO x VALUES('committed');");
      await w.call("lock-file", { path: file });
      await rejects(() => sql(w, id, "UPDATE x SET value='failed'"), "OPFS persistence failed");
      await rejects(() => sql(w, id, "SELECT value FROM x"), "requires close");
      await w.call("release");
      await w.call("unlock-file");
      await rejects(() => open(w), "kernel restart");
      w.stop();
      w = await boot(name);
      const value = await read(w);
      // A failed manifest write can follow a successful DB-file replacement:
      // outcome is indeterminate, but no committed acknowledgement was issued.
      check(file === "manifest.json" ? ["committed", "failed"].includes(value) : value === "committed", `real OPFS exclusive-handle failure recovery: ${file} -> ${value}`);
      w.stop();
    }

    for (const file of ["db.sqlite", "manifest.json"]) {
      const name = root();
      let w = await boot(name);
      const id = await open(w);
      await sql(w, id, "CREATE TABLE x(value); INSERT INTO x VALUES('committed');");
      await w.call("interrupt", { file });
      const unfinished = sql(w, id, "UPDATE x SET value='interrupted'").catch(error => String(error));
      const event = await Promise.race([w.event, unfinished.then(value => { throw new Error(`Write settled before interruption: ${value}`); })]);
      check(event.file === file, `terminate during actual writable stream: ${file}`);
      w.stop(); await unfinished;
      w = await boot(name);
      const value = await read(w);
      check(file === "db.sqlite" ? value === "committed" : ["committed", "interrupted"].includes(value), `interrupted replacement recovery: ${file} -> ${value}`);
      w.stop();
    }
    return { phase: "complete", results, limitations: ["Exclusive-handle failures are real OPFS errors, not quota exhaustion.", "Worker termination does not simulate OS crash or power loss.", "Unacknowledged commit outcome can be old or new after restart."] };
  } catch (error) { return { phase: "failed", results, error: String(error) }; }
  finally {
    for (const w of workers) w.terminate();
    const origin = await navigator.storage.getDirectory();
    for (const name of roots) await origin.removeEntry(name, { recursive: true });
  }
}
