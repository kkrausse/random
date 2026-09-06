// Browser-only storage qualification. Imports the same source as the shipped FS
// worker; the full runtime API probe separately covers bundling and the SAB path.
import initVfs, { VirtualFileSystem } from "../.runtime/patched/packages/vfs/pkg/vivari_vfs.js";
import vfsUrl from "../.runtime/patched/packages/vfs/pkg/vivari_vfs_bg.wasm?url";
import sqliteUrl from "@sqlite.org/sqlite-wasm/sqlite3.wasm?url";
import { createSqliteServer } from "../.runtime/patched/packages/kernel-host/sqlite-server.js";
import { createOpfsPersistence } from "../.runtime/patched/packages/kernel-host/opfs-persistence.js";
import { sqliteContract, sqliteRequests } from "./sqlite-contract.js";

let server, request, persistence, base, locked;
let interruption;
const original = FileSystemFileHandle.prototype.createWritable;
FileSystemFileHandle.prototype.createWritable = async function (...args) {
  const stream = await original.apply(this, args);
  if (this.name === interruption) {
    const write = stream.write.bind(stream);
    stream.write = async bytes => {
      await write(bytes);
      postMessage({ event: "replacement-pending", file: this.name });
      await new Promise(() => {}); // controller terminates this actual worker
    };
  }
  return stream;
};

self.onmessage = async ({ data: { id, method, args = {} } }) => {
  try {
    let result;
    if (method === "init") {
      await initVfs(vfsUrl);
      const vfs = new VirtualFileSystem();
      vfs.mkdir("/test", true); vfs.mkdir("/tmp", true);
      const access = {
        read(path) {
          if (!vfs.exists(path)) return null;
          const s = JSON.parse(vfs.lstat(path));
          return { kind: s.kind, mode: s.mode, bytes: s.kind === "file" ? vfs.read_file(path) : undefined };
        },
        mkdirp: path => vfs.mkdir(path, true),
        writeFile: (path, bytes) => vfs.write_file(path, bytes),
        symlink: (target, path) => vfs.symlink(target, path),
      };
      persistence = await createOpfsPersistence({ access, rootName: args.root });
      await persistence.restore();
      base = await (await navigator.storage.getDirectory()).getDirectoryHandle(args.root);
      server = await createSqliteServer(vfs, persistence, { wasmBinary: new Uint8Array(await (await fetch(sqliteUrl)).arrayBuffer()) });
      request = sqliteRequests(server, vfs);
      result = "ready";
    } else if (method === "contract") result = await sqliteContract(request, server.release);
    else if (method === "request") result = await request(args.client || 1, args.req);
    else if (method === "release") { server.release(args.client || 1); result = true; }
    else if (method === "lock-file") {
      let dir = base;
      const parts = args.path.split("/");
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
      locked = await (await dir.getFileHandle(parts.at(-1))).createSyncAccessHandle();
      result = "locked";
    } else if (method === "unlock-file") { locked.close(); result = true; }
    else if (method === "interrupt") { interruption = args.file; result = true; }
    else throw new Error(`Unknown method ${method}`);
    postMessage({ id, result });
  } catch (error) { postMessage({ id, error: String(error) }); }
};
