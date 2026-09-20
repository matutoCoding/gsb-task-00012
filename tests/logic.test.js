const fs = require('fs');
const vm = require('vm');

/* --- 最小 DOM/localStorage 桩，让 app.js 能加载 --- */
const storage = {};
const elStub = () => new Proxy({
  value: '', textContent: '', innerHTML: '', className: '', disabled: false,
  classList: { add(){}, remove(){}, toggle(){} },
  addEventListener(){}, querySelectorAll(){return []}, querySelector(){return null},
  appendChild(){}, closest(){return null}, setAttribute(){}, dataset:{}
}, { get(t, p){ if (p in t) return t[p]; return typeof p === 'string' ? elStub() : undefined; },
     set(t,p,v){ t[p]=v; return true; } });

const documentStub = {
  addEventListener(){}, querySelector(){ return elStub(); },
  querySelectorAll(){ return []; }, createElement(){ return elStub(); }
};
const sandbox = {
  localStorage: { getItem:k=>storage[k]??null, setItem:(k,v)=>storage[k]=v, removeItem:k=>delete storage[k] },
  document: documentStub,
  Blob: function(){}, URL: { createObjectURL(){return ''}, revokeObjectURL(){} },
  confirm(){return true}, prompt(){return ''}, alert(){},
  console, Math, Date, JSON, Object, Array, Set, Map, String, Number, setTimeout, process
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('app.js','utf8'), sandbox);

/* --- 跑规则 --- */
vm.runInContext(`
const results = [];
const check = (name, cond) => results.push([name, !!cond]);
load();

/* 规则1：温差超过 40℃ 同窑 = 硬冲突 */
state.pieces.push({id:'t1',name:'高温件',owner:'小林',temp:1320,drip:false,size:1,note:'',fixed:false});
let k = state.kilns.find(x=>x.id==='k1');
let ev = evaluateKiln(k, {layer:0,col:0,piece:pieceById('t1')});
check('温差超阈值报硬冲突', ev.kilnErrors.some(m=>m.includes('温差')));

/* 相邻温差：k2 底层 820 / 840 相邻，无预警（差20不大于20） */
let k2 = state.kilns.find(x=>x.id==='k2');
let ev2 = evaluateKiln(k2);
check('相邻差20℃不预警（>才报）', ev2.kilnWarnings.length===0);

/* 相邻温差 30℃ 预警 */
state.pieces.push({id:'t2',name:'另一件',owner:'小林',temp:865,drip:false,size:1,note:'',fixed:false});
let ev3 = evaluateKiln(k2, {layer:2,col:3,piece:pieceById('t2')});
check('相邻差30℃给黄预警', ev3.kilnWarnings.some(m=>m.includes('相邻温差')));

/* 规则3：釉滴件不放底层 = 硬冲突；放底层 OK */
let drip = pieceById('p9'); // 1300 drip
let evDripHi = evaluateKiln(k, {layer:1,col:0,piece:drip});
check('釉滴件放非底层报错', evDripHi.kilnErrors.some(m=>m.includes('釉会滴')));
let evDripLo = evaluateKiln(k, {layer:0,col:0,piece:drip});
check('釉滴件放底层不报釉滴错', !evDripLo.kilnErrors.some(m=>m.includes('釉会滴')));

/* 规则1：摆不下 —— 800℃件进 1280℃窑 */
let cold = pieceById('p11');
let fp = findPlacements(k, cold);
check('低温件在高温窑找不到位', fp.fit===false && fp.errorReason.includes('温差'));

/* 双格件必须连续空位 */
let big = pieceById('p12'); // size2 1250
let fpBig = findPlacements(k, big);
check('双格件只落连续两格', fpBig.cells.every(c=>c.col+2<=k.cols));

/* k1 已锁且满位 -> 双格无空位 */
let k3 = state.kilns.find(x=>x.id==='k3');
state.kilns.push({id:'kx',name:'空窑',layers:2,cols:3,locked:false,cost:0,placements:{}});
const kx = state.kilns.find(x=>x.id==='kx');
let fpEmpty = findPlacements(kx, big);
check('空窑可摆双格件', fpEmpty.fit);
let fpDripEmpty = findPlacements(kx, drip);
check('空窑中滴釉件只推最底层', fpDripEmpty.cells.length>0 && fpDripEmpty.cells.every(c=>c.layer===0));

/* 釉滴件候选层只含最底层 */
let fpDrip = findPlacements(k2, drip);
check('滴釉件在低温窑摆不下（温差）', !fpDrip.fit && fpDrip.errorReason.includes('温差'));

/* 分账：k1 占用按主人聚合 */
let occ = occupancyByOwner(k);
let laochen = occ.find(o=>o.owner==='老陈');
check('老陈占 2 件 2 格', laochen.pieces===2 && laochen.cells===2);

/* fitsAt 被占格不可再放 */
check('k1 占格不能重叠、空格可放', !fitsAt(k,pieceById('p10'),2,0) && fitsAt(k,pieceById('p10'),2,3) && fitsAt(k,pieceById('p10'),0,0));
check('k2 双格件两格都占住', !fitsAt(k2,pieceById('p10'),2,0) && !fitsAt(k2,pieceById('p10'),2,1) && !fitsAt(k2,pieceById('p10'),2,2) && fitsAt(k2,pieceById('p10'),2,3));


/* 摆不下：p14 1320℃ 所有窑都超温差 */
const p14 = pieceById('p14');
check('高温瓶原有三窑都摆不下', ['k1','k2','k3'].every(id => !findPlacements(state.kilns.find(k=>k.id===id), p14).fit));
const fit14 = ['k1','k2','k3'].map(id => ({...findPlacements(state.kilns.find(k=>k.id===id), p14)}));
check('摆不下原因含温差', fit14.every(f => f.errorReason.includes('温差')));

/* p9 滴釉件 1295℃：一号窑可入（底层空位），三号窑可入底层 */
const p9 = pieceById('p9');
const fp9_1 = findPlacements(state.kilns.find(x=>x.id==='k1'), p9);
check('滴釉件一号窑可入且只推底层', fp9_1.fit && fp9_1.cells.every(c=>c.layer===0));

/* k3 当前有滴釉错层件 p13，锁不了 */
const k3b = state.kilns.find(x=>x.id==='k3');
check('三号窑存在硬冲突(滴釉错层)', currentEval(k3b).kilnErrors.some(m=>m.includes('釉会滴')));

const fail = results.filter(r=>!r[1]);
console.log(results.map(r=>(r[1]?'PASS ':'FAIL ')+r[0]).join('\\n'));
console.log('\\n'+(fail.length? fail.length+' FAILED':'ALL '+results.length+' PASSED'));
if (fail.length) process.exit(1);
`, sandbox);
