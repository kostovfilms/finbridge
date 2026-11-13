const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../public/index.html','utf8');
const core=src.split('/*CORE-START*/')[1].split('/*CORE-END*/')[0];
const Core=new Function(core+';return Core')();
let n=0;const t=(name,fn)=>{try{fn();n++;console.log('ok  ',name)}catch(e){console.log('FAIL',name,'\n   ',e.message);process.exitCode=1}};
const eq=assert.deepStrictEqual;

t('amounts',()=>{eq(Core.parseAmount('1 234,56'),1234.56);eq(Core.parseAmount('1,234.56'),1234.56);eq(Core.parseAmount('1.234,56'),1234.56);eq(Core.parseAmount('-12.00'),-12);
 eq(Core.parseAmount('12,00-'),-12);eq(Core.parseAmount('(45.60)'),-45.6);eq(Core.parseAmount('132,60 EUR'),132.6);eq(Core.parseAmount('2 340.00 лв.'),2340);eq(Core.parseAmount('1,234'),1234);
 eq(Core.parseAmount('12,5'),12.5);eq(Core.parseAmount(''),null);eq(Core.parseAmount('abc'),null);eq(Core.parseAmount(74.4),74.4);eq(Core.parseAmount('−58,80'),-58.8);eq(Core.parseAmount('1 234 567,89'),1234567.89)});
t('dates',()=>{eq(Core.parseDate('05.10.2026'),'2026-10-05');eq(Core.parseDate('5/10/26'),'2026-10-05');eq(Core.parseDate('2026-10-05T10:11:00'),'2026-10-05');eq(Core.parseDate('20261005'),'2026-10-05');
 eq(Core.parseDate('05.10.2026 14:22'),'2026-10-05');eq(Core.parseDate('31.13.2026'),null);eq(Core.parseDate('Общо'),null);eq(Core.parseDate(new Date(2026,9,5)),'2026-10-05')});
t('csv: signed amount, ; delimiter, preamble rows',()=>{
 const r=Core.parseStatement('Извлечение по сметка BG00TEST;;;\nПериод;01.10.2026-31.10.2026;;\n\nДата;Контрагент;Основание;Сума;Салдо\n05.10.2026;"Гориво Плюс АД";"POS покупка; карта";-132,60;1000,00\n12.10.2026;Бетон Трейд ООД;Фактура 1000000416;-2 340,00;5,00\n14.10.2026;Община Варна;Плащане по договор;12 000,00;9,00\nОбщо;;;;\n');
 eq(r.format,'CSV');eq(r.txs.length,3);eq(r.txs[0],{date:'2026-10-05',amount:-132.6,cp:'Гориво Плюс АД',desc:'POS покупка; карта',ref:''});eq(r.txs[2].amount,12000);eq(r.skipped,1)});
t('csv: debit/credit columns, comma delimiter, english',()=>{
 const r=Core.parseStatement('Date,Reference,Beneficiary,Payer,Details,Debit,Credit,Balance\n2026-10-02,R1,Energo Dostavka EAD,,Invoice 413,486.00,,100\n2026-10-14,R2,,Obshtina Varna,Contract,,"12,000.00",200\n');
 eq(r.txs.length,2);eq(r.txs[0].amount,-486);eq(r.txs[0].cp,'Energo Dostavka EAD');eq(r.txs[0].ref,'R1');eq(r.txs[1].amount,12000);eq(r.txs[1].cp,'Obshtina Varna')});
t('csv: amount + Дт/Кт indicator, tab delimiter',()=>{
 const r=Core.parseStatement('Дата на транзакция\tДт/Кт\tСума\tНасрещна страна\tОписание\n07.10.2026\tДт\t74,40\tОфис Консуматив ООД\tканцеларски\n08.10.2026\tКт\t500,00\tКлиент ЕООД\tфактура 7\n');
 eq(r.txs.map(x=>x.amount),[-74.4,500]);eq(r.signed,true)});
t('csv: unsigned amounts flagged',()=>{const r=Core.parseStatement('Дата;Име;Сума\n01.10.2026;А ООД;10,00\n');eq(r.signed,false);eq(r.txs[0].amount,10)});
t('csv: unknown layout returns null',()=>{eq(Core.parseStatement('foo;bar\n1;2\n'),null)});
t('mt940',()=>{
 const r=Core.parseStatement(':20:STMT\n:25:BG00TEST\n:28C:10/1\n:60F:C261001EUR1000,00\n:61:2610051005D132,60NMSCNONREF//B123\n:86:?00POS?20POKUPKA KARTA?21GORIVO?32GORIVO PLUS AD\n:61:261014C12000,NTRFREF1\n:86:Plashtane po dogovor\nObshtina Varna\n:62F:C261031EUR12867,40\n-\n');
 eq(r.format,'MT940');eq(r.txs.length,2);eq(r.txs[0].date,'2026-10-05');eq(r.txs[0].amount,-132.6);eq(r.txs[0].cp,'GORIVO PLUS AD');eq(r.txs[0].desc,'POKUPKA KARTA GORIVO');eq(r.txs[1].amount,12000)});
t('camt.053',()=>{
 const r=Core.parseStatement('<?xml version="1.0"?><Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02"><BkToCstmrStmt><Stmt><Ntry><Amt Ccy="EUR">2340.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><BookgDt><Dt>2026-10-12</Dt></BookgDt><AcctSvcrRef>X9</AcctSvcrRef><NtryDtls><TxDtls><RltdPties><Dbtr><Nm>Варна Строй</Nm></Dbtr><Cdtr><Nm>Бетон Трейд ООД</Nm></Cdtr></RltdPties><RmtInf><Ustrd>Ф-ра 416 &amp; аванс</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry><ns:Ntry><ns:Amt>50.5</ns:Amt><ns:CdtDbtInd>CRDT</ns:CdtDbtInd><ns:BookgDt><ns:DtTm>2026-10-13T08:00:00</ns:DtTm></ns:BookgDt></ns:Ntry></Stmt></BkToCstmrStmt></Document>');
 eq(r.txs.length,2);eq(r.txs[0],{date:'2026-10-12',amount:-2340,cp:'Бетон Трейд ООД',desc:'Ф-ра 416 & аванс',ref:'X9'});eq(r.txs[1].amount,50.5)});
t('classify',()=>{const c=(cp,desc,a)=>Core.classify({cp,desc,amount:a});
 eq(c('Гориво Плюс АД','POS покупка',-10),{kind:'карта',needsDoc:true});eq(c('Банка','Такса поддръжка',-12).needsDoc,false);eq(c('НАП','ДДС за септември',-1180).needsDoc,false);
 eq(c('Служители','Заплати 09',-6420).needsDoc,false);eq(c('Клиент','фактура',500),{kind:'приход',needsDoc:false});eq(c('Напоителни системи ЕАД','фактура 5',-90).needsDoc,true);eq(c('Бетон Трейд','ф-ра',-5).kind,'превод')});
t('dedupe keys stable, identical rows distinct',()=>{const a={date:'2026-10-01',amount:-5,cp:'A',desc:'x',ref:''};const k=Core.withKeys([a,a,{...a,cp:'B'}]).map(x=>x.key);
 eq(new Set(k).size,3);eq(Core.withKeys([a,a])[1].key,k[1])});
t('name similarity incl. translit',()=>{assert(Core.nameSim('Гориво Плюс АД','GORIVO PLUS POS 1234 SOFIA')>=0.5);assert(Core.nameSim('Бетон Трейд ООД','Бетон Трейд')>=0.5);eq(Core.nameSim('Телеком БГ ЕАД','Енерго Доставка'),0);eq(Core.nameSim('ООД','ЕООД'),0)});
const tx=(id,date,cp,amount,desc='')=>({id,date,cp,desc,amount,docId:null,needsDoc:true});
const doc=o=>Object.assign({supplier:'Гориво Плюс АД',number:'1000000414',date:'2026-10-05',total:132.6,base:110.5,vat:22.1,confidence:.95,issues:[]},o);
t('match: exact amount + name -> auto',()=>{const r=Core.decideMatch(doc(),[tx('a','2026-10-05','GORIVO PLUS',-132.6),tx('b','2026-10-06','Друг',-99)]);eq(r.tx.id,'a');eq(r.auto,true)});
t('match: amount off by 1 cent tolerance, 2 cents no',()=>{eq(Core.decideMatch(doc(),[tx('a','2026-10-05','X',-132.61)]).tx.id,'a');eq(Core.decideMatch(doc(),[tx('a','2026-10-05','X',-132.63)]).tx,null)});
t('match: two same-amount candidates, name decides',()=>{const r=Core.decideMatch(doc(),[tx('a','2026-10-05','Офис Консуматив',-132.6),tx('b','2026-10-07','Гориво Плюс АД',-132.6)]);eq(r.tx.id,'b');eq(r.auto,true)});
t('match: two same-amount candidates, no name -> review only',()=>{const r=Core.decideMatch(doc(),[tx('a','2026-10-05','POS 111',-132.6),tx('b','2026-10-05','POS 222',-132.6)]);assert(r.tx);eq(r.auto,false)});
t('match: invoice number in payment reason wins',()=>{const r=Core.decideMatch(doc(),[tx('a','2026-10-05','Гориво Плюс АД',-132.6),tx('b','2026-10-20','ГП',-132.6,'ф-ра 1000000414')]);eq(r.tx.id,'b');eq(r.auto,true)});
t('match: low confidence or issues -> review only',()=>{eq(Core.decideMatch(doc({confidence:.7}),[tx('a','2026-10-05','Гориво Плюс',-132.6)]).auto,false);eq(Core.decideMatch(doc({issues:['x']}),[tx('a','2026-10-05','Гориво Плюс',-132.6)]).auto,false)});
t('match: date window, taken tx, incoming ignored',()=>{eq(Core.decideMatch(doc(),[tx('a','2026-05-01','Гориво Плюс',-132.6)]).tx,null);eq(Core.decideMatch(doc(),[{...tx('a','2026-10-05','Гориво Плюс',-132.6),docId:'z'}]).tx,null);eq(Core.decideMatch(doc(),[tx('a','2026-10-05','Гориво Плюс',132.6)]).tx,null)});
t('match: single far-date nameless candidate -> review only',()=>{const r=Core.decideMatch(doc(),[tx('a','2026-12-20','POS 9',-132.6)]);assert(r.tx);eq(r.auto,false)});
t('validateDoc: clean',()=>{const d=Core.validateDoc({docType:'invoice',supplier:' Бетон Трейд  ООД',supplierEik:'BG 507081372',number:'416',date:'09.10.2026',base:'1950.00',vat:390,total:'2 340,00',recipientEik:'203456781',confidence:.93,lines:[{name:'Бетон',qty:'15',unit:'м³',price:130,amount:1950}]},'203456781');
 eq(d.issues,[]);eq(d.total,2340);eq(d.date,'2026-10-09');eq(d.supplierEik,'507081372');eq(d.supplier,'Бетон Трейд ООД');eq(d.confidence,.93);eq(d.lines[0].qty,15)});
t('validateDoc: derives missing part, flags mismatches',()=>{eq(Core.validateDoc({supplier:'A',number:'1',date:'2026-10-01',total:120,vat:20}).base,100);
 const d=Core.validateDoc({supplier:'A',number:'1',date:'2026-10-01',base:100,vat:20,total:125,recipientEik:'111'},'222');eq(d.issues.length,2);eq(d.confidence,.6);
 const e=Core.validateDoc(null);assert(e.issues.length>=3);eq(e.lines,[]);eq(Core.validateDoc({total:'x',lines:'bad'}).total,null)});
t('periods & money',()=>{eq(Core.shiftPeriod('2026-12',1),'2027-01');eq(Core.shiftPeriod('2026-01',-1),'2025-12');eq(Core.deadline('2026-10'),'2026-11-14');eq(Core.periodLabel('2026-10'),'октомври 2026');
 eq(Core.money(-1234567.5),'-1 234 567,50');eq(Core.money(0.1+0.2),'0,30');eq(Core.cur('2025-12'),'лв.');eq(Core.cur('2026-01'),'€')});
t('reminder text',()=>{const s=Core.reminderText({contact:'Петър'},[tx('a','2026-10-05','Гориво Плюс АД',-132.6)],'2026-10');assert(s.includes('Здравейте, Петър!'));assert(s.includes('1 плащане'));assert(s.includes('• 05.10, Гориво Плюс АД, 132,60 €'));assert(s.includes('до 14.11'))});
t('exports',()=>{const P={txs:[{id:'a',date:'2026-10-05',cp:'GORIVO',desc:'POS; "карта"',amount:-132.6,needsDoc:true,docId:'d1'},{id:'b',date:'2026-10-12',cp:'Бетон; Трейд',desc:'',amount:-2340,needsDoc:true,docId:null,reminded:'2026-11-13'}],
 docs:[Object.assign(doc({id:'d1',txId:'a',docType:'invoice',supplierEik:'489280011',supplierVat:'',currency:'EUR',lines:[{name:'Дизел',qty:65,unit:'л',price:1.7,amount:110.5}]}))]};
 const a=Core.exportDocs(P,',').split('\r\n');eq(a.length,2);eq(a[0].split(';').length,14);eq(a[1],'05.10.2026;Фактура;1000000414;Гориво Плюс АД;489280011;;110,50;22,10;132,60;EUR;05.10.2026;132,60;"POS; ""карта""";Платен по банка');
 eq(Core.exportLines(P,'.').split('\r\n')[1],'1000000414;05.10.2026;Гориво Плюс АД;489280011;1;Дизел;65;л;1.70;110.50');
 eq(Core.exportMissing(P,',').split('\r\n')[1],'12.10.2026;"Бетон; Трейд";;2340,00;13.11.2026')});
console.log(n+' passed');
