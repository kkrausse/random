import {Vivari} from '../.artifacts/runtime/index.js';
const $=(id:string)=>document.getElementById(id) as any, frame=$('frame');
let vm:any,bridge:any,booting=false;const samples:any[]=[],logs:string[]=[];
const log=(s:any)=>{$('log').textContent+=String(s)+'\n';logs.push(String(s));};
const channel=new BroadcastChannel('hybrid-fs-v1');
channel.onmessage=async ({data:m})=>{if(m.kind!=='request')return;const start=performance.now();const r=bridge?await bridge.request({...m,type:'fs'}):{error:'ENOTCONN'};samples.push({opcode:m.opcode,ms:performance.now()-start,requestBytes:JSON.stringify(m).length,responseBytes:JSON.stringify(r).length,error:r.error});channel.postMessage({...r,kind:'reply',seq:m.seq});};
async function connect(){bridge=(window as any).installSerialBridge(frame.contentWindow.Module.pty,frame.contentWindow);await bridge.connect(await(await fetch('/guest.js')).text());const size=frame.contentWindow.Module.pty.ioctl('TIOCGWINSZ');bridge.resizeTerminal(size[0],size[1]);log('Linux bridge ready');}
async function boot(){if(vm||booting)throw Error('Vivari already booted or booting');booting=true;try{vm=await Vivari.boot();log('Vivari ready');}finally{booting=false;}}
async function exec(command:string){const r=await bridge.request({type:'exec',command});if(r.error||r.code)throw Error(JSON.stringify(r));return r.stdout;}
async function run(code:string){await vm.fs.writeFile('/tmp/probe.cjs',code);const p=await vm.spawn('node',['/tmp/probe.cjs'],{cwd:'/workspace'});let output='';const drain=(async()=>{for await(const s of p.output)output+=s;})();const exit=await p.exit;await drain;log(output);if(exit)throw Error('process exit '+exit);return output;}
async function test(){
  await exec('rm -rf /workspace/fs-spike; mkdir -p /workspace/fs-spike; printf linux-first > /workspace/fs-spike/a');
  const start=performance.now(),before=samples.length;
  const result=await run(`const fs=require('node:fs'),a=require('node:assert/strict'),p='/workspace/fs-spike/';
    a.equal(fs.readFileSync(p+'a','utf8'),'linux-first');
    fs.writeFileSync(p+'b',Buffer.from([0,255,10,128]));a.equal(fs.statSync(p+'b').size,4);
    a.ok(fs.readdirSync(p).includes('b'));fs.renameSync(p+'b',p+'c');a.equal(fs.existsSync(p+'b'),false);
    a.deepEqual([...fs.readFileSync(p+'c')],[0,255,10,128]);
    const fd=fs.openSync(p+'a','r+');fs.writeSync(fd,Buffer.from('XY'),0,2,1);const b=Buffer.alloc(3);a.equal(fs.readSync(fd,b,0,3,0),3);a.equal(b.toString(),'lXY');fs.closeSync(fd);
    a.throws(()=>fs.readFileSync(p+'missing'),{code:'ENOENT'});a.throws(()=>fs.renameSync(p+'c','/tmp/c'),{code:'EXDEV'});
    fs.linkSync(p+'a',p+'hard');fs.renameSync(p+'a',p+'renamed');a.equal(fs.readFileSync(p+'hard','utf8'),'lXYux-first');
    console.log('PROCESS_FS_PASS');`);
  const linux=await exec("od -An -tx1 /workspace/fs-spike/c; cat /workspace/fs-spike/renamed; printf '\n'; printf linux-second > /workspace/fs-spike/renamed");
  await run(`const fs=require('fs'),a=require('assert/strict');a.equal(fs.readFileSync('/workspace/fs-spike/hard','utf8'),'linux-second');console.log('LINUX_EDIT_VISIBLE');`);
  const receipt={result,linux,ms:performance.now()-start,roundtrips:samples.length-before,samples:samples.slice(before)};log(JSON.stringify(receipt,null,2));return receipt;
}
for(const [id,fn] of Object.entries({linux:async()=>{if(frame.getAttribute('src'))throw Error('Linux already started');frame.src='/runtime.html';},connect,boot,test}))$(id).onclick=()=>fn().catch(log);
Object.assign(window,{fsSpike:{get vm(){return vm;},get bridge(){return bridge;},connect,boot,exec,run,test,samples,logs}});
