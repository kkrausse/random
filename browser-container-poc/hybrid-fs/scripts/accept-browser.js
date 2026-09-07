// Browser Control CLI only. Starts async so CLI transport timeout cannot abort a VM test.
await page.evaluate(() => {
  window.fsAcceptance={phase:'running'};
  (async()=>{
    const h=window.fsSpike;
    await h.exec('rm -rf /workspace/fs-spike');
    const basic=await h.test();
    const before=h.samples.length,start=performance.now();
    await h.run(`const fs=require('fs'),a=require('assert/strict'),p='/workspace/fs-spike/';
      fs.mkdirSync(p+'dir');a.ok(fs.statSync(p+'dir').isDirectory());a.throws(()=>fs.readdirSync(p+'c'),{code:'ENOTDIR'});
      a.throws(()=>fs.openSync(p+'c','wx'),{code:'EEXIST'});a.throws(()=>fs.unlinkSync(p+'dir'),{code:'EISDIR'});
      fs.writeFileSync(p+'append','abc');fs.appendFileSync(p+'append','def');a.equal(fs.readFileSync(p+'append','utf8'),'abcdef');
      const fd=fs.openSync(p+'append','r+');fs.renameSync(p+'append',p+'moved');fs.unlinkSync(p+'moved');
      a.equal(fs.fstatSync(fd).size,6);const b=Buffer.alloc(6);a.equal(fs.readSync(fd,b,0,6,0),6);a.equal(b.toString(),'abcdef');
      fs.ftruncateSync(fd,2);a.equal(fs.fstatSync(fd).size,2);fs.closeSync(fd);a.throws(()=>fs.readSync(fd,b,0,1,0),{code:'EBADF'});
      fs.symlinkSync('c',p+'sym');a.ok(fs.lstatSync(p+'sym').isSymbolicLink());a.equal(fs.readlinkSync(p+'sym'),'c');
      fs.writeFileSync(p+'replace','replacement');fs.renameSync(p+'replace',p+'c');a.equal(fs.readFileSync(p+'sym','utf8'),'replacement');
      a.throws(()=>fs.watch(p),{code:'ENOSYS'});fs.rmdirSync(p+'dir');
      const data=Buffer.alloc(70000);for(let i=0;i<data.length;i++)data[i]=i%251;
      fs.writeFileSync(p+'large',data);a.deepEqual(fs.readFileSync(p+'large'),data);console.log('EXTENDED_FS_PASS');`);
    // The actual entry and its required sibling exist only in Linux.
    await h.exec(`printf '%s' 'module.exports="linux module";' > /workspace/fs-spike/module.cjs; printf '%s' 'console.log("LINUX_ENTRY",require("./module.cjs"));' > /workspace/fs-spike/entry.cjs`);
    const p=await h.vm.spawn('node',['/workspace/fs-spike/entry.cjs'],{cwd:'/workspace/fs-spike'});let output='';
    const drain=(async()=>{for await(const s of p.output)output+=s;})();const exit=await p.exit;await drain;
    if(exit || !output.includes('LINUX_ENTRY linux module'))throw Error('Linux-only entry failed: '+output);
    const linux=await h.exec('wc -c < /workspace/fs-spike/large; cat /workspace/fs-spike/c');
    const extended={ms:performance.now()-start,roundtrips:h.samples.length-before,samples:h.samples.slice(before),output,linux};
    const warm=[];
    for(let i=0;i<5;i++){
      const n=h.samples.length,t=performance.now();
      await h.run(`const fs=require('fs');fs.writeFileSync('/workspace/fs-spike/warm','sample-${i}');console.log(fs.readFileSync('/workspace/fs-spike/warm','utf8'));`);
      const observed=await h.exec('cat /workspace/fs-spike/warm');if(observed!=='sample-'+i)throw Error('Coherence failure');
      warm.push({ms:performance.now()-t,roundtrips:h.samples.length-n,samples:h.samples.slice(n)});
    }
    window.fsAcceptance={phase:'pass',basic,extended,warm,isolated:crossOriginIsolated,origin:location.origin};
  })().catch(e=>window.fsAcceptance={phase:'fail',error:String(e),logs:window.fsSpike.logs});
});
return {started:true,url:page.url()};
