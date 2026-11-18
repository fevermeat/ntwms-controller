import {api} from './api.js';
let current;
const types={A:'매출출고',B:'매출반품',C:'타계정출고',D:'타계정반품'};
const fmt=value=>value===null||value===undefined?'확인 필요':value.toLocaleString('ko-KR',{maximumFractionDigits:6});
const el=(tag,className,text)=>{const e=document.createElement(tag);if(className)e.className=className;if(text!==undefined)e.textContent=text;return e;};
export function closeInventoryHistory(){current?.close();}
export function openInventoryHistory(owner,product,{ownerName='',valid=()=>true}={}){
 closeInventoryHistory();
 const dialog=el('dialog','inventory-history-dialog'),heading=el('div','inventory-history-heading'),title=el('h2','','재고 히스토리'),close=el('button','workflow-dialog-cancel','닫기');
 title.id='inventory-history-title';dialog.setAttribute('aria-labelledby',title.id);close.type='button';heading.append(title,close);
 const name=el('p','inventory-history-product',`${ownerName} · ${product.name}`),form=el('form','inventory-history-form'),dates=el('div','inventory-history-dates');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=(id,text,value)=>{const label=el('label','',text),input=el('input');input.id=id;input.type='date';input.required=true;input.value=value;label.append(input);dates.append(label);return input;};
 const from=date('inventory-history-from','납품 시작일',today.slice(0,8)+'01'),to=date('inventory-history-to','납품 종료일',today),choices=el('fieldset','inventory-history-types'),legend=el('legend','','조회 유형');choices.append(legend);
 const checks=Object.entries(types).map(([code,name])=>{const label=el('label'),check=el('input');check.type='checkbox';check.value=code;check.name='history-type';check.checked=true;label.append(check,el('span','',name));choices.append(label);return check;});
 const submit=el('button','primary','히스토리 조회');submit.type='submit';
 form.append(dates,choices,submit);
 const status=el('p','inventory-history-status','날짜와 유형을 선택한 뒤 히스토리 조회를 눌러 주세요.'),result=el('div','inventory-history-results');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 dialog.append(heading,name,form,el('p','muted small','전산 상품별매출조회 · 납품일자 기준'),status,result);document.body.append(dialog);
 let version=0,controller,busy=false;
 const alive=()=>current?.dialog===dialog&&dialog.open&&valid();
 const reset=()=>{version++;controller?.abort();busy=false;result.replaceChildren();status.className='inventory-history-status';submit.disabled=!checks.some(c=>c.checked);submit.textContent='히스토리 조회';status.textContent=submit.disabled?'조회 유형을 선택해 주세요.':'날짜와 유형을 선택한 뒤 히스토리 조회를 눌러 주세요.';};
 const dispose=()=>{version++;controller?.abort();dialog.remove();if(current?.dialog===dialog)current=undefined;};
 close.onclick=()=>dialog.close();dialog.addEventListener('close',dispose,{once:true});dialog.addEventListener('cancel',()=>{version++;controller?.abort();});
 for(const input of [...checks,from,to])input.addEventListener('change',reset);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!alive())return;
  const selected=checks.filter(c=>c.checked).map(c=>c.value);result.replaceChildren();status.className='inventory-history-status';
  if(!selected.length){reset();return;}
  if(!from.value||!to.value||from.value>to.value){status.classList.add('error');status.textContent='시작일과 종료일을 확인해 주세요.';return;}
  const request=++version;controller=new AbortController();busy=true;submit.disabled=true;submit.textContent='조회 중…';status.textContent='전산에서 상품 히스토리를 조회하고 있습니다…';
  const query=new URLSearchParams({owner,code:product.code,from:from.value,to:to.value,types:selected.join(',')});
  try{
   const data=await api('/api/inventory/history?'+query,{signal:controller.signal});
   if(request!==version||!alive())return;
   if(!Array.isArray(data.rows))throw Error('히스토리 조회 결과를 확인하지 못했습니다.');
   status.textContent=data.rows.length?`${data.rows.length.toLocaleString('ko-KR')}건 · ${selected.map(t=>types[t]).join(' · ')}`:'선택한 기간과 유형의 전산 내역이 없습니다.';
   if(!data.rows.length)return;
   const scroll=el('div','inventory-history-scroll'),table=el('table'),head=el('thead'),headRow=el('tr'),body=el('tbody');table.setAttribute('aria-label',product.name+' 재고 히스토리');
   for(const text of ['매출일자','납품처명','본입수','박스수','수량','출고유형','진행상태','배차정보','비고']){const th=el('th','',text);th.scope='col';headRow.append(th);}head.append(headRow);table.append(head,body);scroll.append(table);result.append(scroll);
   for(const row of data.rows){
    const tr=el('tr');for(const [i,text]of [row.date,row.customer,fmt(row.packSize),fmt(row.boxes),fmt(row.quantity),row.type,row.status,row.dispatch?`${row.dispatchKind} · ${row.dispatch}`:'미등록',row.remark||''].entries()){const td=el('td',i>=2&&i<=4?'history-number':'',text);tr.append(td);}body.append(tr);
   }
  }catch(e){if(request===version&&alive()){status.classList.add('error');status.textContent=e.message;}}
  finally{if(request===version&&alive()){busy=false;submit.disabled=!checks.some(c=>c.checked);submit.textContent='히스토리 조회';}}
 });
 current={dialog,close:()=>{dialog.close();dispose();}};dialog.showModal();checks[0].focus();return dialog;
}
