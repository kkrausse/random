// Inspect only protocol/status shapes; credentials stay entirely in the guest.
(async()=>{
  const fs=require('node:fs');
  const file=(process.env.XDG_STATE_HOME || '/home/user/.local/state')+'/opencode/password';
  const password=fs.readFileSync(file,'utf8');
  const headers={Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64')};
  const result=[];
  for(const path of ['/api/health','/config/providers','/provider','/agent','/config','/path','/openapi.json']) {
    const response=await fetch('http://127.0.0.1:4096'+path,{headers});
    const text=await response.text();
    let body;try{body=JSON.parse(text)}catch{}
    result.push({path,status:response.status,bytes:text.length,keys:body && Object.keys(body),
      ...(path==='/openapi.json'&&body?.paths?{providerPaths:Object.keys(body.paths).filter(p=>/provider|model|agent|config/.test(p))}:{})});
  }
  console.log('OPENCODE_HTTP_RECEIPT '+JSON.stringify(result));
})().catch(e=>{console.error(e.stack);process.exitCode=1});
