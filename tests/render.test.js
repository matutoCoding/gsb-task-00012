const fs = require('fs'), vm = require('vm');
const storage = {};
function makeEl() {
  return {
    value:'', textContent:'', innerHTML:'', className:'', disabled:false,
    children:[], dataset:{},
    classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,f){f?this.add(c):this.remove(c)},contains(c){return this._s.has(c)}},
    addEventListener(){}, removeEventListener(){},
    querySelector(){return makeEl()},
    querySelectorAll(){return []},
    appendChild(){}, closest(){return null}, setAttribute(){}, click(){},
  };
}
const registered = {};
function rootEl(id) {
  const e = makeEl();
  return new Proxy(e, { get(t,p){ if (p in t) return t[p]; return undefined; }, set(t,p,v){t[p]=v;return true;} });
}
const ids = {};
const documentStub = {
  addEventListener(ev, fn){ registered[ev]=fn; },
  querySelector(sel){ if (sel.startsWith('#')) { const id=sel.slice(1); return ids[id] ??= makeEl(); } return makeEl(); },
  querySelectorAll(){ return []; },
  createElement(){ return makeEl(); },
};
const sb = {
  localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v,removeItem:k=>delete storage[k]},
  document:documentStub, Blob:function(){},URL:{createObjectURL(){return''},revokeObjectURL(){}},
  confirm:()=>true,prompt:()=>'',alert(){},
  console,Math,Date,JSON,Object,Array,Set,Map,String,Number,setTimeout
};
vm.createContext(sb);
vm.runInContext(fs.readFileSync('app.js','utf8'), sb);
vm.runInContext(`
load();
renderLoad();
renderHistory();
/* 模拟一次出窑：k2 有 2 件 */
let html2 = '';
/* 渲染每个窑的字符串 */
for (const k of state.kilns) {
  const h = renderKiln(k);
  if (typeof h !== 'string') throw new Error('renderKiln not string');
}
/* 记录页卡片 */
for (const r of state.records) {
  const h = recordHtml(r);
  if (!h.includes('烧坏')) throw new Error('record missing');
}
/* CSV */
const csv = csvOfRecord(state.records[0]);
if (!csv.includes('窑号') || !csv.includes('酱釉缸')) throw new Error('csv bad');
/* 分账金额守恒 */
const k1 = state.kilns.find(x=>x.id==='k1');
k1.cost = 100;
const rows = occupancyByOwner(k1);
let total = 0;
let remain = 100;
rows.forEach((r,i)=>{ const v = i===rows.length-1?remain:Math.round(100*r.cells/6*100)/100; remain-=v; total+=v; });
if (Math.abs(total-100)>0.001) throw new Error('分摊不守恒 '+total);
console.log('RENDER_OK csv_rows=', csv.split('\\n').length, 'owners=', rows.length);
`, sb);
