'use strict';
const http=require('http'),fs=require('fs'),path=require('path');const{spawn}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),PORT=8795,CDP=9337;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8'};
const server=http.createServer((req,res)=>{let p=decodeURIComponent(req.url.split('?')[0]);if(p==='/')p='/index.html';const f=path.join(ROOT,p);if(!fs.existsSync(f)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'text/plain'});fs.createReadStream(f).pipe(res);});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await new Promise(r=>server.listen(PORT,'127.0.0.1',r));
 const edge=spawn('C://Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port='+CDP,'--user-data-dir='+path.join(require('os').tmpdir(),'sqr-essay-'+Date.now()),'about:blank'],{stdio:'ignore'});
 let tg;for(let i=0;i<60;i++){try{tg=await(await fetch('http://127.0.0.1:'+CDP+'/json')).json();if(tg.length)break;}catch(e){}await sleep(150);}
 const page=tg.find(t=>t.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
 let id=0;const w=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&w.has(m.id)){w.get(m.id)(m);w.delete(m.id);}};
 const send=(method,params)=>new Promise(r=>{const n=++id;w.set(n,r);ws.send(JSON.stringify({id:n,method,params:params||{}}));});
 const ev=async x=>(await send('Runtime.evaluate',{expression:x,returnByValue:true})).result.result.value;
 let fail=0;
 for(const lang of ['zh','en']){
  await send('Page.navigate',{url:'http://127.0.0.1:'+PORT+'/essay.'+lang+'.html'});
  for(let i=0;i<60;i++){if(await ev('document.readyState==="complete"'))break;await sleep(100);}
  await sleep(300);
  const info=await ev('({figs:document.querySelectorAll("figure").length,svgs:document.querySelectorAll("svg").length,rects:document.querySelectorAll("figure svg rect").length,sections:document.querySelectorAll("section").length,eqs:document.querySelectorAll(".eq").length,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+2})');
  console.log(lang,JSON.stringify(info));
  if(info.figs<14||info.svgs<14||info.overflow)fail++;
 }
 ws.close();server.close();edge.kill();console.log(fail?fail+' FAILED':'ALL PASS');process.exit(fail?1:0);
})().catch(e=>{console.error(e);server.close();process.exit(1);});
