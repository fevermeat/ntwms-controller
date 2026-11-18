import {api} from './api.js';
const $=id=>document.getElementById(id),el=(tag,text,cls='')=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;e.className=cls;return e;};
const apiPrefix=()=>bucket==='purchase'?'/api/purchase-inbound/':'/api/inbound/';
const post=(path,data)=>api(apiPrefix()+path,{method:'POST',body:JSON.stringify(data)});
let mounted=false,owners=[],orders=[],details=new Map(),locations=new Map(),drafts=new Map(),busy=false,rev=0,bucket='new',statusFilter='scheduled',purchaseStatus='all',lastFilters=null;
let proofDialog=null;
function closeProof(){if(proofDialog){const dialog=proofDialog;proofDialog=null;if(dialog.open)dialog.close();dialog.remove();}}
function proofButton(order){const button=el('button','인수증 보기','out-reset in-proof-button');button.type='button';button.onclick=()=>void openProof(order);return button;}
export function openOrderProof(order,options){return openProof(order,options);}
async function openProof(order,{prefix='/api/inbound/',valid}={}){
 if(!['/api/inbound/','/api/outbound/'].includes(prefix))throw Error('인수증 조회 경로를 확인해 주세요.');
 closeProof();const version=rev,dialog=el('dialog',null,'in-proof-dialog'),heading=el('div',null,'in-proof-heading'),title=el('h2','인수증'),close=el('button','닫기','text-button'),status=el('p',null,'out-meta'),toolbar=el('div',null,'in-proof-toolbar'),stage=el('div',null,'in-proof-stage'),image=el('img'),retry=el('button','다시 조회','out-reset');
 proofDialog=dialog;title.id='in-proof-title';dialog.setAttribute('aria-labelledby',title.id);close.type=retry.type='button';close.onclick=closeProof;heading.append(title,close);status.setAttribute('role','status');dialog.append(heading,el('p',`${order.customer} · ${order.reference}`,'out-meta'),status,toolbar,stage,retry);const canvas=el('div',null,'in-proof-canvas');stage.append(canvas);canvas.append(image);image.hidden=true;image.alt=`${order.customer} ${order.reference} 인수증`;
 let files=[],index=0,zoom=1,angle=0,generation=0;const controls={};
 for(const [key,label]of[['prev','이전'],['next','다음'],['minus','축소'],['plus','확대'],['rotate','회전'],['fit','화면 맞춤']]){const button=el('button',label,'out-reset');button.type='button';controls[key]=button;toolbar.append(button);}
 const counter=el('span');toolbar.append(counter);
 const alive=()=>proofDialog===dialog&&(valid?valid():version===rev)&&dialog.isConnected;
 const controlsState=(loading=false)=>{for(const b of Object.values(controls))b.disabled=loading||!files.length;controls.prev.disabled=loading||index===0;controls.next.disabled=loading||index>=files.length-1;};
 const size=()=>{const width=(stage.clientWidth||680)*zoom,height=width*(image.naturalHeight||1)/(image.naturalWidth||1),rotated=angle%180!==0,cw=rotated?height:width,ch=rotated?width:height;canvas.style.width=cw+'px';canvas.style.height=ch+'px';image.style.width=width+'px';image.style.left=(cw-width)/2+'px';image.style.top=(ch-height)/2+'px';image.style.transform=`rotate(${angle}deg)`;};
 const show=()=>{zoom=1;angle=0;size();image.hidden=true;status.textContent='인수증 사진을 불러오고 있습니다…';status.className='out-meta';counter.textContent=`${index+1} / ${files.length}장`;controlsState(true);image.src=files[index].url;};
 controls.prev.onclick=()=>{if(index>0){index--;show();}};controls.next.onclick=()=>{if(index<files.length-1){index++;show();}};controls.minus.onclick=()=>{zoom=Math.max(.5,zoom-.25);size();};controls.plus.onclick=()=>{zoom=Math.min(4,zoom+.25);size();};controls.rotate.onclick=()=>{angle=(angle+90)%360;size();};controls.fit.onclick=()=>{zoom=1;angle=0;size();};
 image.onload=()=>{if(!alive())return;image.hidden=false;size();status.textContent='';controlsState();};image.onerror=()=>{if(!alive())return;image.hidden=true;canvas.style.height='0px';status.textContent='인수증 사진을 불러오지 못했습니다. 다시 조회를 눌러 주세요.';status.className='error';controlsState();};
 const load=async()=>{const current=++generation;files=[];image.removeAttribute('src');image.hidden=true;canvas.style.height='0px';counter.textContent='';controlsState(true);retry.disabled=true;status.textContent='인수증 파일을 조회하고 있습니다…';status.className='out-meta';
  try{const data=await api(prefix+'proof?key='+encodeURIComponent(order.key));if(!alive()||current!==generation)return;const validFile=file=>{try{const base=new URL(document.querySelector('meta[name="stock-api-base"]')?.content||location.origin),url=new URL(file.url,base);return typeof file.url==='string'&&url.origin===base.origin&&url.pathname===prefix+'proof-image'&&Boolean(url.search);}catch{return false;}};if(data.reference!==order.reference||!Array.isArray(data.files)||!data.files.length||!data.files.every(validFile))throw Error('인수증 파일 목록을 확인하지 못했습니다.');files=data.files;index=0;show();}
  catch(e){if(alive()&&current===generation){status.textContent=e.message;status.className='error';}}
  finally{if(alive()&&current===generation)retry.disabled=false;}
 };
 const resize=()=>{if(alive()&&!image.hidden)size();};window.addEventListener('resize',resize);retry.onclick=()=>void load();dialog.onclose=()=>{window.removeEventListener('resize',resize);if(proofDialog===dialog)proofDialog=null;dialog.remove();};document.body.append(dialog);dialog.showModal();await load();
}
const DETAIL_BATCH_SIZE=10,matchesBucket=(o,b)=>b==='purchase'?o.purchase===true:!o.purchase&&(b==='all'||o.bucket===b);
const stateOf=o=>o.salesState||(o.bucket==='scheduled'?'scheduled':o.bucket==='complete'||/입고완료/.test(o.status||'')?'complete':'received');
const statusName=o=>({scheduled:'예정',received:'접수',complete:'완료',unknown:o.status||'확인 필요'})[stateOf(o)];
const currentStatus=()=>bucket==='purchase'?purchaseStatus:statusFilter;
const visibleOrders=()=>orders.filter(o=>matchesBucket(o,bucket)&&(!['all','purchase'].includes(bucket)||currentStatus()==='all'||stateOf(o)===currentStatus()));
const fmt=n=>Number(n).toLocaleString('ko-KR'),quantity=(n,p)=>`${fmt(Math.floor(n/p))}박스 + 낱개 ${fmt(n%p)} (총 ${fmt(n)}개)`;
const needsAdjustment=(line,amount)=>amount>0&&amount!==line.remaining;
function dateEntry(input){
 input.type='text';input.inputMode='numeric';input.maxLength=10;input.placeholder='예: 20270615';
 const normalize=()=>{const value=input.value.trim().replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),valid=!value||/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;input.value=value;input.setCustomValidity(valid?'':'올바른 날짜를 숫자 8자리로 입력해 주세요. 예: 20270615');};
 input.addEventListener('input',normalize);input.addEventListener('blur',normalize);normalize();
}
function note(text,error=false){$('in-message').textContent=text;$('in-message').className=error?'error':'out-status';}
function resetButton(order){const button=el('button',order.resetJob?'예정 복귀 결과 재확인':'예정건으로 돌리기','out-reset in-order-reset');button.type='button';button.onclick=()=>resetToScheduled(order);return button;}
function lock(value){busy=value;for(const e of $('inbound-view').querySelectorAll('input,select,button'))e.disabled=value;for(const id of ['logout','tab-inventory','tab-outbound'])$(id).disabled=value;}
function ownerOptions(){const selected=$('in-owner').value,q=$('in-owner-search').value.trim().toLowerCase();$('in-owner').replaceChildren(new Option('전체 · 내 화주 전체','*'));for(const o of owners.filter(o=>(o.name+o.code).toLowerCase().includes(q)))$('in-owner').add(new Option(`${o.name} (${o.code})`,o.code));if([...$('in-owner').options].some(o=>o.value===selected))$('in-owner').value=selected;}
async function wait(id,version){for(;;){if(version!==rev)throw new Error('연결이 변경됐습니다.');const job=await api(apiPrefix()+'jobs/'+id);if(job.state==='failed'||job.state==='uncertain')throw Object.assign(new Error(job.error||'입고 결과 확인 필요'),{job});if(job.state==='complete')return job;if(['order','adjust','receipt'].includes(job.kind))note(`${job.order.customer} · ${job.stage}…`);await new Promise(r=>setTimeout(r,150));}}
function product(order,line){
 const section=el('div',null,'in-product'),heading=el('div',null,'in-product-heading'),head=el('strong',line.name);heading.append(head);section.append(heading,el('p',`본입수 ${fmt(line.packSize)}`,'out-meta'));
 const stats=el('div',null,'in-counts');for(const [name,n]of[['지시수량',line.expected],['입고완료',line.completed],['남은 수량',line.remaining]]){if(name==='입고완료'&&n===0)continue;stats.append(el('p',`${name} · ${quantity(n,line.packSize)}`,name==='남은 수량'?'in-remaining':''));}section.append(stats);
 const locKey=order.owner+':'+line.code,loc=locations.get(locKey),reference=el('div',null,'in-locations');reference.append(el('p',`현재 피킹셀 · ${loc?loc.picking??'조회 실패':'조회 중…'}`));
 if(loc){if(loc.pickingError)reference.append(el('p',loc.pickingError,'out-meta'));reference.append(el('p','현재 보관셀 · '+(loc.cells.map(c=>`${c.cell||'미지정'} (${fmt(c.quantity)}개)`).join(', ')||'재고 없음')));if(loc.stockError)reference.append(el('p',loc.stockError,'error'));}else reference.append(el('p','현재 보관셀 · 조회 중…'));
 section.append(reference);
 if(order.resetJob||order.adjustJob||order.receiptJob){section.append(el('p','예정 복귀·상품 변경·접수 결과를 먼저 확인해 주세요.','error'));return section;}
 if(stateOf(order)==='scheduled'||stateOf(order)==='unknown'||order.sourceError){section.append(el('p',line.expiry?`유통기한 · ${line.expiry}`:'유통기한 없음','out-meta'),el('p',order.sourceError||'접수 처리 후 입고할 수 있습니다.','out-meta'));return section;}
 const previous=line.lastJob;
 if(previous?.state==='uncertain'){
  section.append(el('p','이전 입고 결과 확인 필요 · '+previous.error,'error'));const check=el('button','입고 결과 재확인','text-button');check.type='button';check.onclick=()=>recheck(order,previous.id);section.append(check);return section;
 }
 if(!order.closed&&!order.serial&&!line.serial&&order.workType==='0'&&previous?.state!=='uncertain'){const del=el('button','삭제하기','text-button in-product-delete');del.type='button';del.onclick=()=>deleteProduct(order,line);heading.append(del);}
 if(line.remaining===0||stateOf(order)==='complete'){section.append(el('p','입고 완료','in-complete'));return section;}
 if(order.closed||order.serial||line.serial||order.workType!=='0'){section.append(el('p','이 건은 전산에서 별도 입고 처리가 필요합니다.','error'));return section;}
 const form=el('form',null,'in-entry'),inputs={},draftKey=order.key+':'+line.line,draft=drafts.get(draftKey);form.dataset.line=line.line;
 for(const [key,title,type]of[['expiry','이번 입고 유통기한','date'],['cell','To 보관셀','text'],['boxes','이번 입고 박스수','number'],['each','이번 입고 낱개수','number']]){
  const label=el('label',title),input=el('input');input.type=type;input.name=key;inputs[key]=input;
  if(type==='number'){input.min='0';input.step='1';input.value='0';input.required=true;}
  if(key==='expiry'){input.value=line.expiry||'';input.required=line.expiryRequired;}
  if(key==='cell'){input.value=line.cell;input.inputMode='numeric';input.pattern='[0-9]{7,12}';input.required=true;}
  if(draft)input.value=draft[key];
  if(key==='expiry')dateEntry(input);
  label.append(input);form.append(label);
 }
 const sum=el('p',null,'out-meta in-entry-total');const update=()=>{const amount=Number(inputs.boxes.value)*line.packSize+Number(inputs.each.value);sum.textContent=amount>0?`이번 입고 · ${fmt(amount)}개`:'';sum.hidden=!(amount>0);};for(const input of Object.values(inputs))input.oninput=()=>{drafts.set(draftKey,Object.fromEntries(Object.entries(inputs).map(([key,e])=>[key,e.value])));update();};update();form.append(sum);
 const button=el('button','입고 처리','primary');button.type='submit';form.append(button);
 form.onsubmit=e=>{e.preventDefault();if(!busy&&form.reportValidity())void execute(order,line,{expiry:inputs.expiry.value,cell:inputs.cell.value.trim(),boxes:Number(inputs.boxes.value),each:Number(inputs.each.value)});};section.append(form);
 if(previous?.result?.history)for(const h of previous.result.history)section.append(el('p',`최근 입고 · ${h.expiry||'유통기한 없음'} · ${h.cell} · ${quantity(h.quantity,line.packSize)}`,'out-meta'));
 return section;
}
function render(){
 const list=$('in-list');list.replaceChildren();const progress=orders.filter(o=>matchesBucket(o,'progress')),fresh=orders.filter(o=>matchesBucket(o,'new'));
 $('in-count').textContent=`${bucket==='purchase'?'매입입고':`신규 ${fresh.length}건 · 진행중/확인 필요 ${progress.length}건 · 전체 반품`} ${orders.length}건 (예정 ${orders.filter(o=>stateOf(o)==='scheduled').length}건 · 접수 ${orders.filter(o=>stateOf(o)==='received').length}건 · 완료 ${orders.filter(o=>stateOf(o)==='complete').length}건)`;
 for(const b of $('in-buckets').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.bucket===bucket));
 $('in-status-filters').hidden=!['all','purchase'].includes(bucket);for(const b of $('in-status-filters').querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.dataset.state===currentStatus()));
 $('in-purchase-actions').hidden=bucket!=='purchase';$('in-purchase-receive').disabled=busy||!visibleOrders().some(o=>stateOf(o)==='scheduled'&&!o.sourceError);
 for(const order of visibleOrders()){
  const article=el('article',null,'out-order in-order');article.dataset.key=order.key;article.append(el('strong',order.customer||order.purchaseTypeName||'거래처 미등록'),el('p',`${order.ownerName} · ${order.reference}`,'out-meta'),el('p',`${order.purchase?(order.purchaseTypeName||(order.purchaseType==='A'?'통관입고':'매입입고'))+' · ':''}입고예정일 ${order.date} · 실제 입고일 ${order.received||'-'} · 전산 상태 ${order.salesState?order.status:statusName(order)}`,'out-meta'));
  const actual=(order.actualDispatch||'').trim(),expected=(order.expectedDispatch||'').trim(),phone=(order.driverPhone||'').trim(),dispatch=`${actual?'실배차':expected?'예상배차':'배차'} · ${actual||expected||'미등록'}`;
  Object.assign(article.dataset,{pcTitle:order.customer||order.purchaseTypeName||'거래처 미등록',pcReference:order.reference||'',pcOwner:order.ownerName||'',pcDate:order.date||'',pcDispatch:actual||expected||'미등록',pcStatus:order.salesState?order.status:statusName(order),pcAttention:Boolean(order.sourceError||order.resetJob||order.adjustJob||order.receiptJob)});
  article.append(el('p',`${dispatch} · 기사 전화번호 · ${phone||'미등록'}`,'out-meta in-dispatch'));
  if(order.tms)article.append(el('p',order.tms.state==='complete'?'TMS 완료':'TMS 재확인 요망',order.tms.state==='complete'?'out-meta':'error'));
  if(order.purchase&&stateOf(order)==='scheduled'&&!order.sourceError&&!order.receiptJob){const label=el('label','접수 선택 '),check=el('input');check.type='checkbox';check.className='in-purchase-select';check.dataset.key=order.key;label.prepend(check);article.prepend(label);}
  if(order.remark)article.append(el('p',`비고 · ${order.remark}`,'in-remark'));
  if(order.outsideRange)article.append(el('p','방금 상태를 변경한 주문 · 조회기간 밖의 주문을 계속 표시합니다.','out-meta'));
  if(order.sourceError)article.append(el('p',order.sourceError,'error'));
  if(order.resetJob){const actions=el('div',null,'in-order-actions');actions.append(resetButton(order),el('p',order.resetJob.error||'예정 복귀 결과 확인 필요','error'));article.append(actions);}
  if(order.adjustJob){const check=el('button','반품 변경 결과 확인·이어서 처리','out-reset');check.type='button';check.onclick=()=>adjustRecheck(order);article.append(check,el('p',order.adjustJob.error||'수량 조정 결과 확인 필요','error'));}
  if(order.receiptJob){const check=el('button','접수 결과 재확인','out-reset');check.type='button';check.onclick=()=>receive(order);article.append(check,el('p',order.receiptJob.error||'접수 결과 확인 필요','error'));}
  if(stateOf(order)==='scheduled'&&!order.resetJob&&!order.adjustJob&&!order.receiptJob&&!order.sourceError){const button=el('button','접수 처리','primary in-order-submit');button.type='button';button.onclick=()=>receive(order);article.append(button);}
  const entry=details.get(order.key);
  if(order.proofAvailable&&(!entry||entry.error)){const actions=el('div',null,'in-order-actions');actions.append(proofButton(order));article.append(actions);}
  if(!entry)article.append(el('p','상품상세 조회 중…'));
  else if(entry.error)article.append(el('p',entry.error,'error'));
  else{
   const total=entry.lines.reduce((s,l)=>s+l.remaining,0),actions=el('div',null,'in-order-actions');
   const completed=entry.lines.reduce((s,l)=>s+l.completed,0),expected=entry.lines.reduce((s,l)=>s+l.expected,0),partial=completed>0&&total>0;
   Object.assign(article.dataset,{pcQuantity:expected,pcRemaining:total,pcAttention:Boolean(partial||order.sourceError||order.resetJob||order.adjustJob||order.receiptJob)});
   article.append(el('p',`${partial?'진행중 · ':''}지시수량 ${fmt(expected)}개 · 입고수량 ${fmt(completed)}개 · 남은 수량 ${fmt(total)}개`,partial?'in-remaining':'out-meta'));
   if(partial)article.append(el('p','부분입고 건의 예정 복귀는 입고취소·복구 절차가 필요합니다. 상품 수량 수정·추가·삭제 시 기존 입고를 복구합니다.','out-meta'));
   const ready=!order.resetJob&&!order.adjustJob&&!order.receiptJob&&!order.sourceError,editable=stateOf(order)!=='scheduled'&&stateOf(order)!=='unknown'&&!order.closed&&!order.serial&&order.workType==='0'&&!entry.lines.some(l=>l.serial||l.lastJob?.state==='uncertain');
   const receivable=stateOf(order)==='received'&&total>0&&editable;
   if(receivable&&ready){const button=el('button','주문 전체 입고 처리','primary in-order-receive');button.type='button';button.onclick=()=>executeOrder(order);actions.append(button);}
   if(ready&&receivable&&(order.salesStateCode===undefined||order.salesStateCode==='20')&&order.reference&&entry.lines.every(l=>l.completed===0&&(l.cancelled??0)===0))actions.append(resetButton(order));
   if(ready&&editable){const add=el('button','상품 추가','out-reset'),picking=el('button','피킹셀 변경','out-reset in-picking-change');add.type=picking.type='button';add.onclick=()=>addProduct(order);picking.onclick=()=>changePicking(order);actions.append(add,picking);}
   if(order.proofAvailable)actions.append(proofButton(order));
   if(actions.childNodes.length)article.append(actions);
   for(const line of entry.lines)article.append(product(order,line));
  }
  list.append(article);
 }
 lock(busy);
}
async function hydrate(version){
 const selected=visibleOrders().filter(o=>!details.has(o.key)||details.get(o.key).error||details.get(o.key).lines.some(l=>!locations.has(o.owner+':'+l.code)));if(!selected.length)return;
 // Show every order while bounding native reads to the existing batch limit.
 for(let offset=0;offset<selected.length;offset+=DETAIL_BATCH_SIZE){
  if(version!==rev)return;
  const start=await post('page',{keys:selected.slice(offset,offset+DETAIL_BATCH_SIZE).map(o=>o.key)}),job=await wait(start.id,version);if(version!==rev)return;
  for(const entry of job.data.entries){details.set(entry.key,entry);if(entry.order?.key===entry.key)Object.assign(orders.find(o=>o.key===entry.key)||{},entry.order);}
  for(const location of job.data.locations)locations.set(location.owner+':'+location.code,location);
  render();note(`상품과 셀 조회 중 · ${Math.min(offset+DETAIL_BATCH_SIZE,selected.length)}/${selected.length}건`);
 }
}
async function query(){
 if(busy)return;const version=++rev;lastFilters={owner:$('in-owner').value,from:$('in-from').value,to:$('in-to').value,customer:$('in-customer').value};details.clear();locations.clear();drafts.clear();orders=[];lock(true);render();note(bucket==='purchase'?'매입·통관입고 목록을 조회하고 있습니다.':'반품 목록을 조회하고 있습니다.');
 try{const start=await post('query',lastFilters),job=await wait(start.id,version);orders=job.data.orders;render();note(`목록 ${orders.length}건 확인 · 상품과 셀을 조회하고 있습니다.`);await hydrate(version);if(version===rev)note(bucket==='purchase'?'매입·통관입고 조회 완료 · 예정은 접수 처리 후 입고하고, 접수 건은 바로 입고할 수 있습니다.':'조회 완료 · 전체 반품에서 예정·접수·완료를 모두 확인할 수 있습니다.');}catch(e){if(version===rev)note(e.message,true);}finally{if(version===rev){lock(false);render();}}
}
async function showBucket(){if(busy)return;const version=rev;lock(true);render();note('상품과 셀을 조회하고 있습니다.');try{await hydrate(version);if(version===rev)note('조회 완료 · 선택한 목록을 모두 표시합니다.');}catch(e){if(version===rev)note(e.message,true);}finally{if(version===rev){lock(false);render();}}}
async function resetToScheduled(order){
 if(busy)return;
 if(order.purchase)return receive(order,'reset');
 if(!order.resetJob&&!window.confirm(`${order.customer} · ${order.reference}\n저장상태변경으로 매출반품 주문을 예정 상태로 되돌릴까요?`))return;
 const version=rev;let resetConfirmed=false;lock(true);note(`${order.customer} · 예정 상태로 되돌리는 중…`);
 try{
  const endpoint=order.resetJob?`/api/order-reset/jobs/${encodeURIComponent(order.resetJob.id)}/recheck`:'/api/order-reset/start-inbound';
  let job=await api(endpoint,{method:'POST',body:JSON.stringify({key:order.key,confirm:true,requestId:crypto.randomUUID()})});
  while(['running','checking'].includes(job.state)){
   if(version!==rev)return;note(`${order.customer} · ${job.phase||'예정 복귀 결과 확인'} 중…`);
   await new Promise(r=>setTimeout(r,250));job=await api('/api/order-reset/jobs/'+encodeURIComponent(job.id));
  }
  if(version!==rev)return;
  if(job.state!=='complete'){
   if(job.state==='uncertain')order.resetJob={id:job.id,state:job.state,error:job.error};
   render();throw new Error(job.error||'예정 복귀 결과를 확인하지 못했습니다.');
  }
  resetConfirmed=true;
  const start=await post('query',{...lastFilters,focus:{owner:order.owner,reference:order.reference}}),fresh=await wait(start.id,version);if(fresh.data.focusError)throw new Error(fresh.data.focusError);
  orders=fresh.data.orders;details.clear();locations.clear();drafts.clear();render();await hydrate(version);
  note(`${order.customer} · 예정 복귀 완료. 전체 반품의 예정 목록에서 다시 접수할 수 있습니다.`);
 }catch(e){if(version===rev)note(`${resetConfirmed?'예정 복귀 완료 · 목록 조회 실패':order.resetJob?'예정 복귀 결과 확인 필요':'예정 복귀하지 못했습니다'} · ${e.message}`,true);}finally{if(version===rev){lock(false);render();}}
}
async function refreshOrder(order,version){const start=await post('detail',{key:order.key}),job=await wait(start.id,version);details.set(order.key,job.data);Object.assign(order,job.data.order);if(!order.salesState)order.bucket=job.data.lines.some(l=>l.remaining>0||l.lastJob?.state==='uncertain')?'progress':'complete';for(const key of locations.keys())if(key.startsWith(order.owner+':'))locations.delete(key);render();const r=await post('page',{keys:[order.key]}),page=await wait(r.id,version);for(const location of page.data.locations)locations.set(location.owner+':'+location.code,location);render();}
async function receive(order,operation='receive'){
 if(busy)return;if(!order.receiptJob&&!window.confirm(`${order.customer} · ${order.reference}\n${operation==='reset'?'미입고 접수 건을 예정으로 돌릴까요?':'예정 주문을 접수 처리할까요? 실제 입고는 별도 입고 버튼으로 처리합니다.'}`))return;
 const version=rev;lock(true);note(`${order.customer} · 접수 처리 중…`);
 try{const start=order.receiptJob?await post('receive-recheck',{id:order.receiptJob.id}):await post('receive',{key:order.key,...(order.purchase?{operation}:{}),confirm:true,requestId:crypto.randomUUID()}),job=await wait(start.id,version);if(!order.purchase){bucket='all';statusFilter='received';}await refreshAdjustment(job,version);note(`${order.customer} · 전산 ${job.result.order.status||'접수'} 상태와 입고번호를 확인했습니다.${job.tms?job.tms.state==='complete'?' · TMS 완료':' · TMS 재확인 요망':''}`);}
 catch(e){if(version===rev){if(e.job?.state==='uncertain'){order.receiptJob=e.job;render();}note(e.message,true);}}
 finally{if(version===rev){lock(false);render();}}
}
async function executeOrder(order){
 if(busy)return;const entry=details.get(order.key),article=[...$('in-list').querySelectorAll('article')].find(e=>e.dataset.key===order.key),items=[];
 for(const line of entry?.lines.filter(l=>l.remaining>0)||[]){const form=[...article.querySelectorAll('form')].find(f=>f.dataset.line===line.line),expiry=form?.elements.expiry;if(!expiry||!expiry.reportValidity()||!form.elements.boxes.reportValidity()||!form.elements.each.reportValidity()){note(`${line.name} · 유통기한과 박스수·낱개수를 확인해 주세요.`,true);return;}const cell=form.elements.cell.value.trim();form.elements.cell.value=cell;if(!form.elements.cell.reportValidity()){note(`${line.name} · To 보관셀을 숫자 7~12자리로 입력해 주세요.`,true);return;}
  const boxes=Number(form.elements.boxes.value),each=Number(form.elements.each.value),amount=boxes*line.packSize+each;
  if(!Number.isSafeInteger(amount)||amount<0){note('입고수량은 0 이상의 정수로 입력해 주세요.',true);return;}
  items.push({line:line.line,code:line.code,remaining:line.remaining,defaultCell:line.cell,cell,expiry:expiry.value,...(amount>0?{boxes,each}:{})});
 }
 if(items.some(i=>{const l=entry.lines.find(l=>l.line===i.line);return i.boxes!==undefined&&needsAdjustment(l,i.boxes*l.packSize+i.each);}))return adjust(order,items.map(i=>{const l=entry.lines.find(l=>l.line===i.line);return {line:i.line,code:i.code,cell:i.cell,expiry:i.expiry,boxes:i.boxes??Math.floor(l.remaining/l.packSize),each:i.each??l.remaining%l.packSize};}));
 if(!items.length)return;const version=rev;lock(true);note(`${order.customer} · 주문 전체 입고 처리 중…`);
 const clearCompleted=job=>{for(const step of job.result?.steps||[])if(step.state==='complete')drafts.delete(order.key+':'+step.line);};
 try{const start=await post('execute-order',{key:order.key,items,requestId:crypto.randomUUID()}),job=await wait(start.id,version);clearCompleted(job);await refreshOrder(order,version);render();note(`주문 전체 입고 완료 · ${job.result.completedLines}개 상품 · 남은 수량 ${fmt(job.result.remaining)}개`);}
 catch(e){if(version===rev){if(e.job){clearCompleted(e.job);await refreshOrder(order,version).catch(()=>{});render();}note(e.message,true);}}
 finally{if(version===rev){lock(false);render();}}
}
async function execute(order,line,input){
 const base=input.boxes*line.packSize+input.each;if(!Number.isSafeInteger(base)||base<=0){note('이번 수량은 0보다 큰 정수로 입력해 주세요.',true);return;}
 if(needsAdjustment(line,base))return adjust(order,[{line:line.line,code:line.code,...input}]);
 const version=rev;lock(true);note(`${order.customer} · ${line.name} 입고 처리 중…`);
 try{const start=await post('execute',{key:order.key,line:line.line,code:line.code,...input,requestId:crypto.randomUUID()}),job=await wait(start.id,version);drafts.delete(order.key+':'+line.line);await refreshOrder(order,version);render();note(`입고 완료 · ${quantity(base,line.packSize)} · ${input.cell}셀 · 남은 수량 ${fmt(job.result.remaining)}개`);}
 catch(e){if(version===rev){if(e.job){await refreshOrder(order,version).catch(()=>{});render();}note(e.message,true);}}
 finally{if(version===rev)lock(false);}
}
async function refreshAdjustment(job,version){
 const target=job.result?.deleted?null:job.result?.order||job.order,focus=target?.reference?{owner:target.owner,reference:target.reference}:null;
 const start=await post('query',{...lastFilters,...(focus?{focus}:{})}),fresh=await wait(start.id,version);if(fresh.data.focusError)throw new Error(fresh.data.focusError);orders=fresh.data.orders;details.clear();locations.clear();drafts.clear();
 if(job.state==='complete'&&!job.result?.deleted&&job.result?.order&&!orders.some(o=>o.key===job.result.order.key)){const o={...job.result.order,bucket:job.result.order.bucket||(job.result.remaining>0?'progress':'complete')};orders.push(o);details.set(o.key,{order:o,lines:job.result.lines});}
 if(job.result?.addedInput){const i=job.result.addedInput;drafts.set(job.result.order.key+':'+i.line,{cell:i.cell,expiry:i.expiry,boxes:String(i.boxes),each:String(i.each)});}
 render();await hydrate(version);
}
async function adjust(order,items){
 if(busy)return;const entry=details.get(order.key);
 if(!entry||entry.lines.some(l=>(l.cancelled??0)>0)){note('취소수량이 있는 반품은 전산에서 확인해 주세요.',true);return;}
 const changed=items.map(i=>{const l=entry.lines.find(l=>l.line===i.line),amount=i.boxes*l.packSize+i.each;return {line:l,amount};}).filter(i=>needsAdjustment(i.line,i.amount));
 const message=changed.every(i=>i.amount>i.line.remaining)?'전산보다 입고되는 수량이 많습니다. 전산 조정할까요?':'전산 수량을 실제 입고수량으로 조정할까요?';
 if(!window.confirm(message+'\n'+changed.map(i=>`${i.line.name} · ${fmt(i.line.expected)} → ${fmt(i.line.completed+i.amount)}개`).join('\n')+'\n기존 입고가 있으면 취소 후 원래 셀·유통기한·수량으로 복구합니다.\n예정 변경 → 수량 수정 → 재접수 → 입고 순서로 처리합니다.'))return;
 const version=rev;lock(true);note('전산 수량 조정·입고 처리 중…');
 try{const start=await post('adjust-execute',{key:order.key,items,confirm:true,requestId:crypto.randomUUID()}),job=await wait(start.id,version);await refreshAdjustment(job,version);note(`전산 수량 조정·입고 완료 · ${job.result.completedLines}개 상품 · 남은 수량 ${fmt(job.result.remaining)}개`);}
 catch(e){if(version===rev){if(e.job?.state==='uncertain'){order.adjustJob=e.job;await refreshAdjustment(e.job,version).catch(()=>{});render();}note('수량 조정·입고 확인 필요 · '+e.message,true);}}
 finally{if(version===rev){lock(false);render();}}
}
async function editProduct(order,operation,items){
 const version=rev;lock(true);note('반품 상품 변경·재접수 중…');
 try{const start=await post('adjust-execute',{key:order.key,operation,items,confirm:true,requestId:crypto.randomUUID()}),job=await wait(start.id,version);await refreshAdjustment(job,version);note(job.result.deleted?'반품 전표 삭제 완료':operation==='add'?'상품 추가·재접수 완료 · 추가 상품은 입고 버튼으로 처리해 주세요.':'상품 삭제·재접수 완료 · 기존 다른 상품 입고를 복구했습니다.');}
 catch(e){if(version===rev){if(e.job?.state==='uncertain'){order.adjustJob=e.job;await refreshAdjustment(e.job,version).catch(()=>{});render();}note(e.message,true);}}
 finally{if(version===rev){lock(false);render();}}
}
async function deleteProduct(order,line){
 if(busy)return;const last=details.get(order.key)?.lines.length===1;
 if(!window.confirm(`${order.customer} · ${line.name}\n${last?'마지막 상품이므로 예정으로 되돌린 후 반품 전표 전체를 삭제합니다.':'예정으로 되돌려 이 상품만 삭제하고 다시 접수합니다.'}\n기존 입고가 있으면 취소하며, 남은 상품의 기존 입고는 원래 셀·유통기한·수량으로 복구합니다.`))return;
 return editProduct(order,'delete',[{line:line.line,code:line.code}]);
}
async function addProduct(order){
 if(busy)return;const version=rev;lock(true);note('화주 상품 목록을 조회하고 있습니다.');let catalog;
 try{const start=await post('catalog',{key:order.key});catalog=(await wait(start.id,version)).data;}catch(e){note(e.message,true);return;}finally{lock(false);render();}
 const dialog=el('dialog',null,'shipment-dialog'),title=el('h2',order.purchase?'매입 상품 추가':'반품 상품 추가'),form=el('form'),search=el('input'),select=el('select'),pack=el('p',null,'out-meta'),fields={};search.type='search';search.placeholder='물품명 또는 상품코드 검색';dialog.append(title,el('p',order.customer),search,select,pack);
 const existing=new Set(details.get(order.key).lines.map(l=>l.code)),products=catalog.products.filter(p=>p.packSize&&!existing.has(p.code));
 const filter=()=>{const old=select.value,q=search.value.trim().toLowerCase();select.replaceChildren(new Option('상품 선택',''));for(const p of products.filter(p=>(p.name+p.code).toLowerCase().includes(q)))select.add(new Option(p.name,p.code));if([...select.options].some(o=>o.value===old))select.value=old;update();};
 for(const [key,name]of[['boxes','박스수'],['each','낱개수'],['cell','To 보관셀'],['expiry','유통기한']]){const label=el('label',name),input=el('input');fields[key]=input;input.name=key;if(['boxes','each'].includes(key)){input.type='number';input.min='0';input.step='1';input.value='0';input.required=true;}if(key==='cell'){input.inputMode='numeric';input.pattern='[0-9]{7,12}';input.required=true;}if(key==='expiry')dateEntry(input);label.append(input);form.append(label);}
 const update=()=>{const p=products.find(p=>p.code===select.value);pack.textContent=p?`본입수 ${fmt(p.packSize)} · 총 ${fmt(Number(fields.boxes.value)*p.packSize+Number(fields.each.value))}개`:'';fields.expiry.required=!!p?.expiryRequired;};
 search.oninput=filter;select.onchange=update;fields.boxes.oninput=fields.each.oninput=update;filter();
 const save=el('button','상품 추가·재접수','primary'),close=el('button','닫기','text-button');save.type='submit';close.type='button';close.onclick=()=>dialog.close();form.append(save,close);dialog.append(form,el('p','기존 입고는 원래 셀·유통기한·수량으로 복구합니다. 추가 상품은 재접수까지만 처리하며, 입고 버튼으로 따로 입고해 주세요.','out-meta'));document.body.append(dialog);dialog.onclose=()=>dialog.remove();dialog.showModal();
 form.onsubmit=e=>{e.preventDefault();const p=products.find(p=>p.code===select.value),input={code:select.value,boxes:Number(fields.boxes.value),each:Number(fields.each.value),cell:fields.cell.value.trim(),expiry:fields.expiry.value};if(!p||!form.reportValidity()||input.boxes*p.packSize+input.each<=0)return;if(!window.confirm(`${p.name} · ${quantity(input.boxes*p.packSize+input.each,p.packSize)}\n예정 변경 → 상품 추가 → 재접수까지 처리할까요?`))return;dialog.close();void editProduct(order,'add',[input]);};
}
async function adjustRecheck(order){
 if(busy||!window.confirm('이미 보낸 저장 요청은 반복하지 않고 결과를 확인합니다. 아직 보내지 않은 상품 변경·재접수·기존 입고 복구 단계는 이어서 처리할까요?'))return;
 const version=rev;lock(true);
 try{await post('adjust-recheck',{id:order.adjustJob.id});const job=await wait(order.adjustJob.id,version);await refreshAdjustment(job,version);note('전산 수량 조정·입고 결과를 확인했습니다.');}
 catch(e){if(version===rev)note(e.message,true);}finally{if(version===rev){lock(false);render();}}
}
async function recheck(order,id){if(busy)return;const version=rev;lock(true);try{await post('recheck',{id});await wait(id,version);await refreshOrder(order,version);note('실제 입고 결과를 확인했습니다.');}catch(e){note(e.message,true);}finally{if(version===rev)lock(false);}}
async function receivePurchases(){
 if(busy)return;const selected=[...$('in-list').querySelectorAll('.in-purchase-select:checked')].map(c=>orders.find(o=>o.key===c.dataset.key)).filter(Boolean);
 if(!selected.length){note('접수할 예정 매입주문을 선택해 주세요.',true);return;}if(!window.confirm(`예정 매입주문 ${selected.length}건을 접수할까요? 실제 입고는 별도 버튼으로 처리합니다.`))return;
 const version=rev;let completed=0,lastJob;lock(true);
 try{for(const order of selected){note(`매입 접수 중 · ${completed}/${selected.length}건`);const start=await post('receive',{key:order.key,confirm:true,requestId:crypto.randomUUID()});lastJob=await wait(start.id,version);completed++;}await refreshAdjustment(lastJob,version);note(`매입 접수 완료 · ${completed}건 · 상품별 또는 전체 입고 버튼으로 입고해 주세요.`);}
 catch(e){if(e.job?.state==='uncertain'){const order=orders.find(o=>o.key===e.job.order.key);if(order)order.receiptJob=e.job;}if(lastJob)await refreshAdjustment(lastJob,version).catch(()=>{});note(`매입 접수 ${completed}/${selected.length}건 완료 · ${e.message}`,true);}
 finally{if(version===rev){lock(false);render();}}
}
async function changePicking(order){
 if(busy)return;const entry=details.get(order.key);if(!entry?.lines.length)return;
 const version=rev,dialog=el('dialog',null,'shipment-dialog in-picking-dialog'),form=el('form'),select=el('select'),cell=el('input'),current=el('p',null,'out-meta'),status=el('p',null,'out-meta'),save=el('button','피킹셀 저장','primary'),recheckButton=el('button','이전 저장 결과 재확인','out-reset'),close=el('button','닫기','text-button');
 const products=[...new Map(entry.lines.map(l=>[l.code,l])).values()];for(const line of products)select.add(new Option(`${line.name} (${line.code})`,line.code));cell.inputMode='numeric';cell.pattern='[0-9]{7,12}';cell.required=true;cell.placeholder='새 피킹셀 번호';
 const productLabel=el('label','상품'),cellLabel=el('label','변경할 피킹셀');productLabel.append(select);cellLabel.append(cell);save.type='submit';close.type=recheckButton.type='button';recheckButton.hidden=true;
 let running=false,submitted=false;const update=()=>{const line=products.find(l=>l.code===select.value),loc=locations.get(order.owner+':'+line.code);current.textContent='현재 피킹셀 · '+(loc?.picking||'없음');};select.onchange=update;update();
 form.append(productLabel,current,cellLabel,save,recheckButton,close);dialog.append(el('h2','피킹셀 변경'),el('p',`${order.ownerName} · ${order.customer}`),form,status);close.onclick=()=>{if(!running)dialog.close();};dialog.oncancel=e=>{if(running)e.preventDefault();};dialog.onclose=()=>{dialog.remove();if(version===rev){lock(false);render();}};document.body.append(dialog);dialog.showModal();
 const poll=async id=>{for(;;){if(version!==rev)throw Error('연결이 변경됐습니다.');const job=await api('/api/picking/jobs/'+encodeURIComponent(id));if(job.state==='failed')throw Error(job.error);if(['ready','complete'].includes(job.state))return job;status.textContent=job.status||'피킹셀 처리 중…';await new Promise(r=>setTimeout(r,150));}};
 const execute=async recheck=>{if(running||(!recheck&&!form.reportValidity()))return;const line=products.find(l=>l.code===select.value);if(!recheck&&!window.confirm(`${line.name}\n피킹셀을 ${cell.value.trim()}로 변경할까요?`))return;running=true;lock(true);for(const e of [select,cell,save,close,recheckButton])e.disabled=true;status.textContent='전산 피킹셀을 확인하고 있습니다…';status.className='out-meta';
  try{let result;if(recheck){const start=await api('/api/picking/recheck',{method:'POST',body:JSON.stringify({owner:order.owner,code:line.code})});result=await poll(start.id);}else{const start=await api('/api/picking/preview',{method:'POST',body:JSON.stringify({owner:order.owner,code:line.code,cell:cell.value.trim()})});await poll(start.id);submitted=true;await api('/api/picking/save',{method:'POST',body:JSON.stringify({id:start.id})});result=await poll(start.id);}const loc=locations.get(order.owner+':'+line.code);locations.set(order.owner+':'+line.code,{...loc,picking:result.data.cell,pickingError:null});current.textContent='현재 피킹셀 · '+result.data.cell;status.textContent='피킹셀 변경 확인 완료 · '+result.data.cell;save.hidden=recheckButton.hidden=true;}
  catch(e){status.textContent=e.message;status.className='error';recheckButton.hidden=!(submitted||/이전 저장 결과|중복 저장/.test(e.message));if(submitted)save.hidden=true;}
  finally{running=false;if(version===rev)lock(false);close.disabled=false;recheckButton.disabled=false;if(!submitted){select.disabled=cell.disabled=save.disabled=false;}}
 };form.onsubmit=e=>{e.preventDefault();void execute(false);};recheckButton.onclick=()=>void execute(true);
}
export function connectInbound(data){
 closeProof();if(!mounted)mount();rev++;owners=data.owners;orders=[];details.clear();locations.clear();drafts.clear();busy=false;bucket='new';statusFilter='scheduled';purchaseStatus='all';lastFilters=null;ownerOptions();const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());$('in-from').value=$('in-to').value=today;render();note('조건을 선택하고 조회를 눌러 주세요.');
}
export function resetInbound(){closeProof();rev++;orders=[];details.clear();locations.clear();drafts.clear();busy=false;if(mounted){$('inbound-view').hidden=true;$('tab-inbound').className='text-button';}}
function mount(){
 mounted=true;const button=el('button','입고처리','text-button');button.id='tab-inbound';document.querySelector('.controller-tabs').append(button);
 const section=el('section');section.id='inbound-view';section.hidden=true;
 section.innerHTML=`<div class="page-heading"><h1>입고처리</h1></div><form id="in-filter" class="card out-filters"><label>화주 검색<input id="in-owner-search" type="search" placeholder="화주명 또는 코드"></label><label>화주<select id="in-owner"></select></label><label>입고예정 시작일<input id="in-from" type="date" required></label><label>입고예정 종료일<input id="in-to" type="date" required></label><label>거래처<input id="in-customer" type="search" maxlength="100"></label><button class="primary">조회</button></form><p id="in-message" role="status" aria-live="polite"></p><div id="in-buckets" class="out-result-filters"><button type="button" data-bucket="new">신규</button><button type="button" data-bucket="progress">진행중 · 잔여/확인 필요</button><button type="button" data-bucket="all">전체 반품</button><button type="button" data-bucket="purchase">매입입고</button></div><div id="in-purchase-actions" hidden><label><input id="in-purchase-all" type="checkbox">표시된 예정 매입주문 전체 선택</label><button type="button" id="in-purchase-receive" class="primary">선택 접수 처리</button></div><div id="in-status-filters" class="out-result-filters" hidden><button type="button" data-state="all">전체</button><button type="button" data-state="scheduled">예정</button><button type="button" data-state="received">접수</button><button type="button" data-state="complete">완료</button></div><p id="in-count"></p><div id="in-list"></div>`;
 $('workspace').append(section);for(const id of ['in-from','in-to'])$(id).addEventListener('click',()=>{if(!$(id).disabled)try{$(id).showPicker?.();}catch{}});$('in-filter').onsubmit=e=>{e.preventDefault();if($('in-filter').reportValidity())void query();};$('in-owner-search').oninput=ownerOptions;
 button.onclick=()=>{for(const id of ['inventory-view','outbound-view'])$(id).hidden=true;section.hidden=false;button.className='primary';$('tab-inventory').className=$('tab-outbound').className='text-button';};
 for(const id of ['tab-inventory','tab-outbound'])$(id).addEventListener('click',()=>{section.hidden=true;button.className='text-button';});
 for(const b of $('in-buckets').querySelectorAll('button'))b.onclick=()=>{if(!busy){const changed=(bucket==='purchase')!==(b.dataset.bucket==='purchase');bucket=b.dataset.bucket;if(changed&&lastFilters)void query();else void showBucket();}};
 for(const b of $('in-status-filters').querySelectorAll('button'))b.onclick=()=>{if(!busy){if(bucket==='purchase')purchaseStatus=b.dataset.state;else statusFilter=b.dataset.state;void showBucket();}};
 $('in-purchase-all').onclick=e=>{for(const c of $('in-list').querySelectorAll('.in-purchase-select'))c.checked=e.target.checked;};$('in-purchase-receive').onclick=()=>receivePurchases();
}
