if(page.url()!=='http://127.0.0.1:5206/')throw Error('Use isolated :5206');
const root=state.ffiRoot || path.resolve('browser-container-poc/vivari');
const results={};
for(const name of ['stream-consumers','vm-import','process-warning']) {
  const source=fs.readFileSync(path.join(root,`probes/runtime/${name}.cjs`),'utf8');
  results[name]=await page.evaluate(async source=>{
    const p=await window.probe.vm.spawn('node',['-e',source]);
    let output='';const drain=(async()=>{for await(const t of p.output)output+=t})();const code=await p.exit;await drain;
    if(code!==0||!output.includes('_PASS'))throw Error(output);
    return {code,output};
  },source);
}
fs.writeFileSync(path.join(root,'../doc/logs/vivari/v2-runtime-browser.json'),JSON.stringify(results,null,2));
return results;
