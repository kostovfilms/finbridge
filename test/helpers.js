const http=require('node:http'),net=require('node:net'),{spawn}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
exports.mockAI=(port,reply)=>new Promise(ok=>{const calls=[];const s=http.createServer((req,res)=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{const j=JSON.parse(b);calls.push({headers:req.headers,body:j});
  const r=reply(j);if(r.status){res.writeHead(r.status,{'content-type':'application/json'});return res.end('{"error":{}}')}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({content:[{type:'text',text:r.text}],stop_reason:'end_turn'}))})});s.listen(port,()=>ok({calls,close:()=>s.close()}))});
exports.fakeSMTP=port=>new Promise(ok=>{const mails=[];const s=net.createServer(c=>{let data=false,buf='',cur={cmds:[],body:''};c.write('220 fake ESMTP\r\n');
  c.on('data',d=>{buf+=d.toString();let i;while((i=buf.indexOf('\r\n'))>=0){const l=buf.slice(0,i);buf=buf.slice(i+2);
    if(data){if(l==='.'){data=false;mails.push(cur);cur={cmds:[],body:''};c.write('250 queued\r\n')}else cur.body+=l+'\n';continue}
    cur.cmds.push(l);if(/^EHLO/.test(l))c.write('250-fake\r\n250 AUTH LOGIN\r\n');else if(/^AUTH LOGIN/.test(l)){c.write('334 VXNlcm5hbWU6\r\n');cur.auth=1}
    else if(cur.auth===1){cur.auth=2;c.write('334 UGFzc3dvcmQ6\r\n')}else if(cur.auth===2){cur.auth=3;c.write('235 ok\r\n')}
    else if(/^DATA/.test(l)){data=true;c.write('354 go\r\n')}else if(/^QUIT/.test(l)){c.write('221 bye\r\n');c.end()}else c.write('250 ok\r\n')}})});s.listen(port,()=>ok({mails,close:()=>s.close()}))});
exports.startServer=(port,env)=>new Promise((ok,no)=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fb-'));
  const p=spawn(process.execPath,['--no-warnings',path.join(__dirname,'..','server.js')],{env:{...process.env,PORT:port,DATA_DIR:dir,...env},stdio:['ignore','pipe','inherit']});
  p.stdout.on('data',d=>{if(String(d).includes('слуша'))ok({dir,stop:()=>p.kill()})});p.on('exit',c=>no(new Error('server exited '+c)))});
exports.invoiceReply=j=>{const t=j.messages[0].content.find(c=>c.type==='text').text;
  const inv=(s,e,n,d,b,v,tot,l)=>JSON.stringify({docType:'invoice',supplier:s,supplierEik:e,supplierVat:'BG'+e,recipientEik:'203456781',number:n,date:d,currency:'EUR',base:b,vat:v,total:tot,lines:[l],confidence:.96,notes:''});
  if(t.includes('Гориво Плюс'))return{text:'```json\n'+inv('Гориво Плюс АД','489280014','1000000414','2026-10-05',110.5,22.1,132.6,{name:'Дизелово гориво',qty:65,unit:'л',price:1.7,amount:110.5})+'\n```'};
  if(t.includes('Бетон Трейд'))return{text:'Ето данните: '+inv('Бетон Трейд ООД','507081376','1000000416','2026-10-09',1950,390,2340,{name:'Бетон B25',qty:15,unit:'м³',price:130,amount:1950})};
  if(t.includes('LIMIT'))return{status:429};if(t.includes('GARBAGE'))return{text:'не мога'};
  return{text:inv('Наем Техника ООД','925882778','1000000418','2026-10-19',750,150,900,{name:'Наем на багер',qty:5,unit:'дни',price:150,amount:750})}};
