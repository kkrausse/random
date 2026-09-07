await page.evaluate(()=>{
  window.fsHmr={phase:'running',samples:[]};
  (async()=>{
    const h=window.fsSpike,frame=document.querySelector('#preview'),doc=frame.contentDocument,time=frame.contentWindow.performance.timeOrigin;
    const heading=()=>frame.contentDocument.querySelector('h1')?.textContent;
    const wait=async text=>{const deadline=performance.now()+90000;while(heading()!==text){if(performance.now()>deadline)throw Error('HMR timeout: '+heading());await new Promise(r=>setTimeout(r,50));}if(frame.contentDocument!==doc||frame.contentWindow.performance.timeOrigin!==time)throw Error('Preview document replaced');};
    const original='Ready for an agent edit';await wait(original);
    try {
      for(let i=0;i<3;i++){
        const text='Linux shared filesystem edit '+i,before=h.samples.length,start=performance.now();
        await h.exec(`sed -i 's/${original}/${text}/' /workspace/src/WelcomeCard.tsx`);
        const linuxMs=performance.now()-start;await wait(text);
        window.fsHmr.samples.push({edit:i,ms:performance.now()-start,linuxMs,roundtrips:h.samples.length-before,sameDocument:true});
        const restoreStart=performance.now(),n=h.samples.length;
        await h.exec(`sed -i 's/${text}/${original}/' /workspace/src/WelcomeCard.tsx`);await wait(original);
        window.fsHmr.samples.push({restore:i,ms:performance.now()-restoreStart,roundtrips:h.samples.length-n,sameDocument:true});
      }
      window.fsHmr.phase='pass';window.fsHmr.restored=true;
    } finally {
      if(window.fsHmr.phase!=='pass')await h.exec("sed -i 's/Linux shared filesystem edit [0-9]/Ready for an agent edit/' /workspace/src/WelcomeCard.tsx");
    }
  })().catch(e=>{window.fsHmr.phase='fail';window.fsHmr.error=String(e);});
});
return {started:true};
