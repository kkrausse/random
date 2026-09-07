import * as P from '../../vivari/.runtime/baseline/packages/protocol/syscall.js';
export const mounted = p => (p === '/workspace' || p.startsWith('/workspace/')) && !(p === '/workspace/node_modules' || p.startsWith('/workspace/node_modules/'));
export function installRemote(server) {
  for (const method of ['writeLarge','writeBatch']) {
    const original = server[method].bind(server);
    server[method] = (...args) => {
      const paths = method === 'writeLarge' ? [args[0]] : args[0].map(e => e.path);
      if (paths.some(mounted)) throw Error('ENOSYS: mounted batch writes require Linux transport');
      return original(...args);
    };
  }
  const channel = new BroadcastChannel('hybrid-fs-v1');
  let seq = 0;
  const pending = new Map(), fds = new Set();
  channel.onmessage = ({data: m}) => { const p = pending.get(m.seq); if (m.kind !== 'reply' || !p) return; pending.delete(m.seq); clearTimeout(p.timer); m.error ? p.reject(Error(m.error)) : p.resolve(Uint8Array.from(atob(m.body), c => c.charCodeAt(0))); };
  const request = (opcode, flags, fields, client) => new Promise((resolve, reject) => {
    const id = ++seq;
    const timer = setTimeout(() => { pending.delete(id); reject(Error('ETIMEDOUT')); }, 300000);
    pending.set(id, {resolve,reject,timer});
    channel.postMessage({kind:'request',seq:id,opcode,flags,client,fields:fields.map(f => { let s=''; for(const b of f) s+=String.fromCharCode(b); return btoa(s); })});
  });
  const original = server.service.bind(server);
  server.service = async client => {
    const c = server.clients.get(client); if (!c) return;
    const {ctrl,data} = c, opcode = Atomics.load(ctrl,P.I_OPCODE);
    const {flags,fields} = P.decodeRequest(data.slice(0,Atomics.load(ctrl,P.I_REQ_LEN)));
    const fdOp = [P.OP_CLOSE,P.OP_FD_READ,P.OP_FD_WRITE,P.OP_FSTAT,P.OP_FTRUNCATE].includes(opcode);
    const path = P.decodeBytes(fields[opcode === P.OP_WATCH ? 1 : opcode === P.OP_SYMLINK ? 1 : 0] || new Uint8Array());
    const remote = fdOp ? fds.has(P.bytesToU32(fields[0])) : mounted(path);
    const second = [P.OP_RENAME,P.OP_LINK].includes(opcode) && mounted(P.decodeBytes(fields[1]));
    if (!remote && !second) return original(client);
    let bytes, state = P.STATE_RESPONSE_OK;
    try {
      if ([P.OP_RENAME,P.OP_LINK].includes(opcode) && remote !== second) throw Error('EXDEV');
      if ([P.OP_WATCH,P.OP_UNWATCH].includes(opcode)) throw Error('ENOSYS');
      bytes = await request(opcode,flags,fields,client);
      if (opcode === P.OP_OPEN) fds.add(P.bytesToU32(bytes));
      if (opcode === P.OP_CLOSE) fds.delete(P.bytesToU32(fields[0]));
      if (bytes.length > data.length) throw Error('EFBIG');
    } catch(e) { bytes=P.encodeString(e.message || 'EIO'); state=P.STATE_RESPONSE_ERR; }
    data.set(bytes); Atomics.store(ctrl,P.I_RES_LEN,bytes.length); Atomics.store(ctrl,P.I_STATE,state); Atomics.notify(ctrl,P.I_STATE);
  };
}
