await page.goto('http://127.0.0.1:5220/');
await page.getByRole('button',{name:'Start Linux',exact:true}).click();
await page.evaluate(()=>{
  window.fsStartup={phase:'linux-boot'};
  (async()=>{
    const f=document.querySelector('#frame');
    const wait=async predicate=>{const deadline=performance.now()+300000;while(!predicate()){if(performance.now()>deadline)throw Error('Boot timeout');await new Promise(r=>setTimeout(r,100));}};
    await wait(()=>f.contentDocument?.body?.innerText.includes('demo login:'));
    f.contentWindow.Module.pty.ldisc.writeFromLower('root\r');window.fsStartup.phase='linux-login';
    await wait(()=>f.contentDocument?.body?.innerText.includes('demo:/workspace#'));
    window.fsStartup.phase='connecting';await window.fsSpike.connect();
    window.fsStartup.phase='vivari-boot';await window.fsSpike.boot();window.fsStartup.phase='ready';
  })().catch(e=>window.fsStartup={phase:'failed',error:String(e)});
});
return {started:true};
