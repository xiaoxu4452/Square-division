'use strict';
const http=require('http'),fs=require('fs'),path=require('path');const{spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),PORT=8797,CDP=9339;
const server=http.createServer((req,res)=>{const f=path.join(ROOT,req.url.split('?')[0]);if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});fs.createReadStream(f).pipe(res);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 const edge=spawn('C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+CDP,'--user-data-dir='+path.join(require('os').tmpdir(),'sqr-fig-'+Date.now()),'about:blank'],{stdio:'ignore'});
 let tg;for(let i=0;i<60;i++){try{tg=await(await fetch('http://127.0.0.1:'+CDP+'/json')).json();if(tg.length)break;}catch(e){}await sleep(150);}
 const page=tg.find(t=>t.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const w=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}};
 const send=(method,params)=>new Promise(r=>{const n=++id;w.set(n,r);ws.send(JSON.stringify({id:n,method,params:params||{}}));});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result.result.value;
 await send('Emulation.setDeviceMetricsOverride',{width:1100,height:900,deviceScaleFactor:1,mobile:false});
 await send('Page.navigate',{url:'http://127.0.0.1:'+PORT+'/essay.zh.html'});
 for(let i=0;i<60;i++){if(await ev('document.readyState==="complete"'))break;await sleep(100);}
 await sleep(300);
 // scroll to last figure (Figure 11) via its aria-label
 await ev('(function(){var f=[...document.querySelectorAll("svg")].find(s=>(s.getAttribute("aria-label")||"").indexOf("Duijvestijn")>=0);if(f)f.scrollIntoView({block:"center"});return !!f;})()');
 await sleep(300);
 const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
 fs.writeFileSync(path.join(ROOT,'tests','fig11.png'),Buffer.from(shot.result.data,'base64'));
 console.log('wrote fig11.png');
 ws.close();server.close();edge.kill();process.exit(0);
})().catch(e=>{console.error(e);server.close();process.exit(1);});
