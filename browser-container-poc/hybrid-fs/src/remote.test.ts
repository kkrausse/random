import {test,expect} from 'bun:test';
import {mounted,installRemote} from './remote.js';
import * as P from '../../vivari/.runtime/baseline/packages/protocol/syscall.js';
test('mount boundaries retain only dependencies locally',()=>{
  for(const p of ['/workspace','/workspace/a','/workspace/node_modules-other'])expect(mounted(p)).toBe(true);
  for(const p of ['/workspaces/a','/tmp/a','/workspace/node_modules','/workspace/node_modules/a'])expect(mounted(p)).toBe(false);
});
test('real syscall SAB stays pending until remote reply, with no VFS dispatch',async()=>{
  const sab=new SharedArrayBuffer(P.SAB_BYTES),{ctrl,data}=P.makeViews(sab);
  const req=P.encodeRequest([P.encodeString('/workspace/x')]);data.set(req);
  Atomics.store(ctrl,P.I_OPCODE,P.OP_READ_FILE);Atomics.store(ctrl,P.I_REQ_LEN,req.length);Atomics.store(ctrl,P.I_STATE,P.STATE_REQUEST);
  let local=0;const server:any={clients:new Map([[7,{ctrl,data}]]),service(){local++;},writeLarge(){},writeBatch(){}};
  installRemote(server);const channel=new BroadcastChannel('hybrid-fs-v1');
  channel.onmessage=({data:m})=>{if(m.kind==='request')channel.postMessage({kind:'reply',seq:m.seq,body:btoa('linux bytes')});};
  const result=server.service(7);expect(Atomics.load(ctrl,P.I_STATE)).toBe(P.STATE_REQUEST);await result;
  expect(local).toBe(0);expect(Atomics.load(ctrl,P.I_STATE)).toBe(P.STATE_RESPONSE_OK);
  expect(P.decodeBytes(data.slice(0,Atomics.load(ctrl,P.I_RES_LEN)))).toBe('linux bytes');channel.close();
});
test('source bulk writes cannot silently create a replica',()=>{
  const s:any={service(){},writeLarge(){return 1;},writeBatch(){return 2;}};
  installRemote(s);
  expect(()=>s.writeLarge('/workspace/a',new Uint8Array())).toThrow('ENOSYS');
  expect(()=>s.writeBatch([{path:'/workspace/a'}],new ArrayBuffer(0))).toThrow('ENOSYS');
  expect(s.writeLarge('/workspace/node_modules/a',new Uint8Array())).toBe(1);
});
