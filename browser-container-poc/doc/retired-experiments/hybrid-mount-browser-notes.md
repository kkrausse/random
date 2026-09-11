# Retired hybrid mount: historical Browser Control notes

Archived September 11, 2026. These are the experiment's existing troubleshooting
notes; they do not establish acceptance of a shared Linux/Vivari filesystem.
The untracked implementation and generated assets have been removed from the
working repository.

- v0.7.0, owned session `gentle-otter-533`, origin `http://127.0.0.1:5223`.
- Resolved runner API misuse: `await fs.readFile(path)` inside execute threw
  `TypeError: The "cb" argument must be of type function. Received undefined`.
  Expected Promise-based read; actual `fs` is Node's callback-style module.
  Deterministic reproduction is that expression on any local public fixture.
  Changed the runner to `fs.readFileSync(path)`; no relay restart or tab replacement.
- An earlier application-side FS mutation hook attempted `FS.getPath` on an
  anonymous PTY node and threw `Cannot read properties of null (reading 'length')`.
  The in-flight QEMU syscall stopped. Fixed hook to skip nameless nodes and
  reloaded only this owned probe tab. This was an application bug, not a relay bug.
