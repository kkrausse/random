# Browser Control observations

CLI: `browser-control v0.7.0` (Bun-backed).

- 2026-09-07, hybrid origin `http://127.0.0.1:5210/`, session
  `cosmic-wombat-157`: `page.locator('#status').innerText()` failed strict mode
  because Browser Control's injected overlay also has `id="status"`.
  Expected the harness status paragraph; actual two matches (paragraph and
  extension status div). Reproduced with the single locator read. Recovered
  with `page.evaluate(() => document.getElementById('status').textContent)`;
  use `p#status` for future Playwright reads. No navigation/reset/restart.
  CLI version is recorded in the results document with final evidence.

- Same session: `await fs.mkdir(path, {recursive:true})` used the callback-based
  injected Node `fs` module and failed `The "cb" argument must be of type
  function. Received undefined`. Corrected to `fs.mkdirSync` / `writeFileSync`
  with an explicit project path. Evidence export succeeded; browser untouched.

- Dependency capture exceeded the calling shell's 60-second timeout while
  exporting 26.3 MB in 256 KiB reads. The relay continued and all output files
  completed; the archive length and SHA-256 were checked independently. The
  page, VM and preview survived. Use a 180-second outer CLI timeout for capture;
  do not immediately launch a duplicate capture after an outer timeout.
