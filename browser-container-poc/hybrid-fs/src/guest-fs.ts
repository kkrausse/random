import * as fs from 'node:fs';
import * as P from '../../vivari/.runtime/baseline/packages/protocol/syscall.js';
const handles = new Map<number,{fd:number,client:number}>(); let seq=0x40000000;
const meta = (s:any) => P.encodeString(JSON.stringify({kind:s.isDirectory()?'dir':s.isSymbolicLink()?'symlink':'file',size:s.size,mode:s.mode,ino:s.ino,nlink:s.nlink,uid:s.uid,gid:s.gid,atimeMs:s.atimeMs,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs,birthtimeMs:s.birthtimeMs}));
export function guestFs(m:any) {
  const f=m.fields.map((s:string)=>Buffer.from(s,'base64')), s=(i:number)=>f[i].toString(), u=(i:number)=>P.bytesToU32(f[i]), pos=(i:number)=>{const n=P.bytesToF64(f[i]);return n<0?null:n;};
  const fd=()=>{const h=handles.get(u(0));if(!h || h.client!==m.client)throw Object.assign(Error('EBADF'),{code:'EBADF'});return h.fd;};
  let out:any = new Uint8Array();
  try { switch(m.opcode) {
    case P.OP_READ_FILE: if(fs.statSync(s(0)).size>524288)throw Object.assign(Error('EFBIG'),{code:'EFBIG'});out=fs.readFileSync(s(0));break;
    case P.OP_WRITE_FILE: fs.writeFileSync(s(0),f[1]);break;
    case P.OP_EXISTS: out=new Uint8Array([fs.existsSync(s(0))?1:0]);break;
    case P.OP_STAT: out=meta(fs.statSync(s(0)));break;
    case P.OP_LSTAT: out=meta(fs.lstatSync(s(0)));break;
    case P.OP_READDIR: out=P.encodeString(fs.readdirSync(s(0)).join('\n'));break;
    case P.OP_MKDIR: fs.mkdirSync(s(0),{recursive:!!(m.flags&P.FLAG_RECURSIVE)});break;
    case P.OP_RENAME: fs.renameSync(s(0),s(1));break;
    case P.OP_UNLINK: fs.unlinkSync(s(0));break;
    case P.OP_RMDIR: fs.rmdirSync(s(0));break;
    case P.OP_SYMLINK: fs.symlinkSync(s(0),s(1));break;
    case P.OP_READLINK: out=P.encodeString(fs.readlinkSync(s(0)));break;
    case P.OP_LINK: fs.linkSync(s(0),s(1));break;
    case P.OP_OPEN: {const id=++seq;handles.set(id,{fd:fs.openSync(s(0),u(1),u(2)),client:m.client});out=P.u32ToBytes(id);break;}
    case P.OP_CLOSE: fs.closeSync(fd());handles.delete(u(0));break;
    case P.OP_FSTAT: out=meta(fs.fstatSync(fd()));break;
    case P.OP_FD_READ: {const b=Buffer.alloc(Math.min(u(1),32768));out=b.subarray(0,fs.readSync(fd(),b,0,b.length,pos(2)));break;}
    case P.OP_FD_WRITE: out=P.u32ToBytes(fs.writeSync(fd(),f[2],0,f[2].length,pos(1)));break;
    case P.OP_FTRUNCATE: fs.ftruncateSync(fd(),u(1));break;
    default: throw Object.assign(Error('ENOSYS'),{code:'ENOSYS'});
  } return {body:Buffer.from(out).toString('base64')}; }
  catch(e:any) {return {error:e.code || 'EIO'};}
}
