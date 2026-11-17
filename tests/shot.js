'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '..'), PORT = 8793, CDP = 9335;
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.png':'image/png'};
const server = http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!f.startsWith(ROOT)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(res);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
  const edge=spawn('C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+CDP,'--user-data-dir='+path.join(require('os').tmpdir(),'sqr-shot-'+Date.now()),'about:blank'],{stdio:'ignore'});
  let tg;for(let i=0;i<60;i++){try{tg=await(await fetch('http://127.0.0.1:'+CDP+'/json')).json();if(tg.length)break;}catch(e){}await sleep(150);}
  const page=tg.find(t=>t.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const waits=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&waits.has(m.id)){waits.get(m.id)(m);waits.delete(m.id);}};
  const send=(method,params)=>new Promise(r=>{const n=++id;waits.set(n,r);ws.send(JSON.stringify({id:n,method,params:params||{}}));});
  const evalx=async expr=>(await send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true})).result.result.value;
  await send('Page.enable');
  const views=[[1440,900,'desktop'],[390,844,'phone']];
  for(const [w,h,name] of views){
    await send('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:name==='phone'});
    await send('Page.navigate',{url:'http://127.0.0.1:'+PORT+'/?demo=1&mode=perfect&console=1'});
    for(let i=0;i<80;i++){if(await evalx('document.readyState==="complete"'))break;await sleep(100);}
    await sleep(700);
    await evalx('window.dispatchEvent(new Event("resize"));true');
    await sleep(200);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync(path.join(ROOT,'tests','shot-'+name+'.png'),Buffer.from(shot.result.data,'base64'));
    console.log('wrote shot-'+name+'.png');
  }
  ws.close();server.close();edge.kill();process.exit(0);
})().catch(e=>{console.error(e);server.close();process.exit(1);});
