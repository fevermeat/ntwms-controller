export const STOCKTAKE_OWNER='A00242';
const round=n=>Math.round(n*1e6)/1e6;
export function bestCells(){return ['41','42'].flatMap(rack=>Array.from({length:32},(_,i)=>Array.from({length:[7,8].includes(i+1)?6:5},(_,j)=>{const column=String(i+1).padStart(2,'0'),tier=String(j+1).padStart(2,'0'),cell='1'+rack+column+tier;return {cell,floor:1,rack,column,tier,label:`1층 ${rack}랙 ${column}열 ${tier}단`,other:false};})).flat());}
export const CELL_SET=new Set(bestCells().map(c=>c.cell));
export function otherCell(cell){const match=/^(\d)(\d{2})(\d{2})(\d{2})$/.exec(cell),m=match&&match.slice(1).every(n=>Number(n)>0)?match:null;return {cell,floor:m?Number(m[1]):'',rack:m?.[2]||'',column:m?.[3]||'',tier:m?.[4]||'',label:m?`${m[1]}층 ${m[2]}랙 ${m[3]}열 ${m[4]}단`:'기타 로케이션',other:true};}
export function quantityParts(quantity,packSize){return Number.isSafeInteger(packSize)&&packSize>0?{boxes:Math.floor(quantity/packSize),loose:round(quantity%packSize)}:{boxes:null,loose:null};}
export function stocktakeSnapshot(data,context={}){
 const owner=context.owner||STOCKTAKE_OWNER;
 if(!data?.owner||data.owner.code!==owner||!Array.isArray(data.products)||!Number.isFinite(Date.parse(data.checkedAt)))throw Error('선택 화주의 전산 재고 조회 결과를 확인해 주세요.');
 const seen=new Set(),products=data.products.map(p=>{
  if(!p.code||!p.name||seen.has(p.code)||!Number.isFinite(p.quantity)||p.quantity<0||!Array.isArray(p.cells))throw Error('상품 재고가 불완전하거나 중복입니다.');seen.add(p.code);
  const cells=new Set();let total=0;
  const mapped=p.cells.map(c=>{
   if(!c.cell||cells.has(c.cell)||!Number.isFinite(c.quantity)||c.quantity<0||!Array.isArray(c.expiries))throw Error('셀·유지기한 재고를 확인하지 못했습니다.');cells.add(c.cell);total+=c.quantity;
   const dates=new Set();let sum=0;
   const expiries=c.expiries.map(e=>{if(typeof e.expiry!=='string'||dates.has(e.expiry)||!Number.isFinite(e.quantity)||e.quantity<0||e.expiry&&(!/^\d{4}-\d{2}-\d{2}$/.test(e.expiry)||!Number.isFinite(Date.parse(e.expiry))||new Date(e.expiry).toISOString().slice(0,10)!==e.expiry))throw Error('유지기한별 재고를 확인해 주세요.');dates.add(e.expiry);sum+=e.quantity;return {...e,...quantityParts(e.quantity,p.packSize)};}).filter(e=>e.quantity>0).sort((a,b)=>(a.expiry||'9999').localeCompare(b.expiry||'9999'));
   if(Math.abs(sum-c.quantity)>1e-6)throw Error('유지기한별 수량과 셀 합계가 다릅니다.');return {...c,expiries,...quantityParts(c.quantity,p.packSize)};
  }).filter(c=>c.quantity>0);
  if(Math.abs(total-p.quantity)>1e-6)throw Error('보관셀 수량과 상품 전체 합계가 다릅니다.');return {...p,cells:mapped,...quantityParts(p.quantity,p.packSize)};
 });
 const registered=[...new Set(context.registeredCells??(owner===STOCKTAKE_OWNER?bestCells().map(c=>c.cell):[]))];if(registered.some(c=>typeof c!=='string'||!c.length||c.length>80))throw Error('등록된 로케이션 목록을 확인해 주세요.');const registeredSet=new Set(registered);
 const extra=[...new Set([...products.flatMap(p=>p.cells.map(c=>c.cell)),...(context.extraCells||[])])].filter(c=>typeof c==='string'&&c.length>0&&c.length<=80&&!registeredSet.has(c)).sort((a,b)=>Number(b.startsWith('1000'))-Number(a.startsWith('1000'))||a.localeCompare(b,'ko',{numeric:true}));
 const cells=[...extra.map(otherCell),...registered.map(c=>({...otherCell(c),other:c.startsWith('1000')||owner===STOCKTAKE_OWNER&&!CELL_SET.has(c)}))].map(c=>{const items=products.flatMap(p=>{const stock=p.cells.find(s=>s.cell===c.cell);return stock?[{code:p.code,name:p.name,packSize:p.packSize,quantity:p.quantity,boxes:p.boxes,loose:p.loose,stock}]:[];}).sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true})||a.code.localeCompare(b.code));return {...c,items,count:items.length,quantity:round(items.reduce((n,p)=>n+p.stock.quantity,0))};});
 return {owner:data.owner,checkedAt:data.checkedAt,warehouse:context.warehouse||'',username:context.username||'',registeredCount:registered.length,locationMode:registered.length?'registered':'stock',products,cells};
}
export function cellSignature(cell){return JSON.stringify(cell.items.map(p=>[p.code,p.packSize,p.stock.expiries.map(e=>[e.expiry,e.quantity])]).sort((a,b)=>a[0].localeCompare(b[0])));}
export function countedProducts(cell,progress){if(!cell)return [];const records=progress?.cells?.[cell.cell]?.counts||{},codes=new Set([...cell.items.map(p=>p.code),...Object.keys(records).filter(code=>records[code].entries?.length)]);return [...codes].map(code=>{const p=cell.items.find(p=>p.code===code),record=records[code];return p||{code,name:record.name,packSize:record.packSize,stock:{cell:cell.cell,quantity:0,expiries:[]}};}).sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}));}
export function countSummary(cell,product,progress){const entries=progress?.cells?.[cell.cell]?.counts?.[product.code]?.entries||[],entered=entries.length>0,quantity=round(entries.reduce((n,e)=>n+e.quantity,0));return {entries,entered,quantity:entered?quantity:null,difference:entered?round(quantity-product.stock.quantity):null};}
export const cellReviewed=(cell,progress)=>{if(!cell)return false;const products=countedProducts(cell,progress);return products.length?products.every(p=>countSummary(cell,p,progress).entered):progress?.cells?.[cell.cell]?.emptyCount?.quantity===0;};
export function cellCountStatus(cell,progress){if(cellReviewed(cell,progress))return '실사 입력 완료';return countedProducts(cell,progress).some(p=>countSummary(cell,p,progress).entered)?'일부 입력':'미확인';}
export function normalizeCountExpiry(value){if(typeof value!=='string')throw Error('유지기한을 확인해 주세요.');let date=value.trim();if(/^\d{8}$/.test(date))date=date.slice(0,4)+'-'+date.slice(4,6)+'-'+date.slice(6);if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw Error('유지기한은 YYYYMMDD 또는 YYYY-MM-DD로 입력해 주세요.');return date;}
export function countLines(product,summary){const dates=[...new Set([...product.stock.expiries.map(e=>e.expiry),...summary.entries.map(e=>e.expiry)])].sort((a,b)=>(a||'9999').localeCompare(b||'9999'));return dates.map(expiry=>{const stock=product.stock.expiries.find(e=>e.expiry===expiry),actual=summary.entries.find(e=>e.expiry===expiry),quantity=stock?.quantity||0,actualQuantity=summary.entered?(actual?.quantity||0):null;return {expiry,quantity,...quantityParts(quantity,product.packSize),actual:actualQuantity,actualParts:actualQuantity==null?null:quantityParts(actualQuantity,product.packSize),registered:!!actual,difference:actualQuantity==null?null:round(actualQuantity-quantity)};});}
export function sortCells(cells,sort=[{key:'rack',direction:1},{key:'column',direction:1},{key:'tier',direction:1}]){
 const keys=new Set(['cell','count','label','rack','column','tier','quantity']);
 if(!Array.isArray(sort)||sort.length>7||sort.some(s=>!keys.has(s.key)||![1,-1].includes(s.direction))||new Set(sort.map(s=>s.key)).size!==sort.length)throw Error('정렬 조건을 확인해 주세요.');
 return [...cells].sort((a,b)=>{const group=Number(!a.other)-Number(!b.other);if(group)return group;if(a.other&&b.other){const special=Number(!a.cell.startsWith('1000'))-Number(!b.cell.startsWith('1000'));if(special)return special;}for(const s of sort){const v=s.key==='label'?a.label.localeCompare(b.label,'ko',{numeric:true}):s.key==='cell'?a.cell.localeCompare(b.cell,'ko',{numeric:true}):Number(a[s.key])-Number(b[s.key]);if(v)return v*s.direction;}return a.cell.localeCompare(b.cell);});
}
