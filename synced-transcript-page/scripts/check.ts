#!/usr/bin/env bun
// Plays the published page muted in headless Chrome and prints the highlight state three times.
//   bun check.ts <page-url>#autoplay <screenshot.png>
// Pass: paused=false, t advancing, `on` moving to later passages, itSaid/enSaid growing.
const [url, shot] = process.argv.slice(2);
const proc = Bun.spawn(["google-chrome","--headless=new","--no-sandbox","--hide-scrollbars","--window-size=800,900","--autoplay-policy=no-user-gesture-required","--remote-debugging-port=9333",`--user-data-dir=${shot}.chrome-profile`,"about:blank"],{stderr:"ignore",stdout:"ignore"});
await Bun.sleep(2000);
const tabs = await (await fetch("http://127.0.0.1:9333/json")).json();
const ws = new WebSocket(tabs.find((t:any)=>t.type==="page").webSocketDebuggerUrl);
await new Promise(r=>ws.onopen=r);
let id=0; const pending=new Map<number,(v:any)=>void>();
ws.onmessage=e=>{const m=JSON.parse(e.data as string); if(m.id&&pending.has(m.id)){pending.get(m.id)!(m.result);pending.delete(m.id)}};
const send=(method:string,params:any={})=>new Promise<any>(r=>{pending.set(++id,r);ws.send(JSON.stringify({id,method,params}))});
const ev=async(expression:string)=>(await send("Runtime.evaluate",{expression,returnByValue:true})).result?.value;
await send("Page.navigate",{url});
await Bun.sleep(3000);
const probe=`JSON.stringify({t:au.currentTime,paused:au.paused,err:au.error&&au.error.code,dur:au.duration,on:document.querySelector('section.on')?.dataset.t,itSaid:document.querySelectorAll('section.on .it .said').length,itAll:document.querySelectorAll('section.on .it span').length,enSaid:document.querySelectorAll('section.on .en .said').length,enAll:document.querySelectorAll('section.on .en span').length,clock:document.getElementById('clock').textContent,btn:pp.textContent})`;
console.log("t+3s", await ev(probe));
await Bun.sleep(5000);
console.log("t+8s", await ev(probe));
const png=(await send("Page.captureScreenshot",{format:"png"})).data;
await Bun.write(shot, Buffer.from(png,"base64"));
await Bun.sleep(9000);
console.log("t+17s", await ev(probe));
ws.close(); proc.kill();
