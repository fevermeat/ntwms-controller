import {api} from './api.js';
const element=(tag,text,cls='')=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;e.className=cls;return e;};
let dialog,form,info,availability,all,status,error,submit,close,date,boxes,each,recheck,continueButton,current,jobId,busy=false,revision=0;
function init(){
 if(dialog)return;dialog=element('dialog');dialog.id='expiry-dialog';dialog.setAttribute('aria-labelledby','expiry-title');form=element('form');
 const title=element('h2','유지기한변경');title.id='expiry-title';info=element('p');status=element('p');status.setAttribute('role','status');error=element('p',undefined,'error');error.setAttribute('role','alert');error.hidden=true;
 const field=(text,id,type)=>{const label=element('label',text),input=element('input');input.id=id;input.type=type;input.inputMode='numeric';input.required=true;label.htmlFor=id;form.append(label,input);return input;};
 availability=element('p',undefined,'stock-availability');availability.id='expiry-available';availability.setAttribute('role','status');all=element('button','전량 이동','stock-fill-all');all.id='expiry-all';all.type='button';all.disabled=true;const availabilityRow=element('div',undefined,'stock-availability-row');availabilityRow.append(availability,all);form.append(title,info,availabilityRow);date=field('변경 유지기한','expiry-date','text');date.placeholder='예: 20270420';date.maxLength=10;
 boxes=field('변경 박스수','expiry-boxes','number');each=field('변경 낱개수','expiry-each','number');for(const input of [boxes,each]){input.min='0';input.step='1';}
 all.onclick=()=>{if(all.disabled||busy||!current)return;boxes.value=String(Math.floor(current.available/current.product.packSize));each.value=String(current.available%current.product.packSize);};
 date.addEventListener('blur',()=>{date.value=date.value.trim().replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3');});
 form.append(element('p','선택한 재고만 출고한 뒤 같은 셀로 반품 입고합니다. 출고·반품 단가는 0원입니다.','muted small'),status,error);
 recheck=element('button','결과 재확인','text-button');continueButton=element('button','남은 단계 이어서 처리','text-button');for(const b of [recheck,continueButton]){b.type='button';b.hidden=true;form.append(b);}
 const actions=element('div',undefined,'picking-actions');close=element('button','닫기','text-button');close.type='button';submit=element('button','유지기한변경 실행','primary');submit.type='submit';actions.append(close,submit);form.append(actions);dialog.append(form);document.body.append(dialog);
 close.onclick=()=>dialog.close();recheck.onclick=()=>resume('recheck');continueButton.onclick=()=>resume('continue');form.onsubmit=start;
}
function renderJob(j){jobId=j.id;status.textContent=(j.state==='complete'?'완료 · ':j.state==='uncertain'?'결과 확인 필요 · ':'')+j.phase+(j.orders?` · 출고 ${j.orders.C?.orderNo||'등록 전'} / 반품 ${j.orders.D?.orderNo||'등록 전'}`:'');
 error.textContent=j.error||'';error.hidden=!j.error;const unresolved=j.state==='uncertain';recheck.hidden=!unresolved;continueButton.hidden=!unresolved;submit.hidden=unresolved||j.state==='complete';
 if(j.state==='complete')status.textContent+=` · ${j.data.quantity}개 · 총재고 ${j.data.before} → ${j.data.after}`;
}
function updateAll(){all.disabled=busy||submit.hidden||!Number.isSafeInteger(current?.available)||current.available<=0;}
function lock(value){busy=value;for(const e of [submit,date,boxes,each,recheck,continueButton])e.disabled=value;updateAll();}
async function poll(j,rev){while(['running','checking'].includes(j.state)){if(rev!==revision)return;renderJob(j);await new Promise(r=>setTimeout(r,800));j=await api('/api/expiry-change/jobs/'+j.id);}if(rev!==revision)return;renderJob(j);if(j.state==='failed'&&!j.intents?.length)current.requestId=crypto.randomUUID();if(j.state==='complete')await current.refresh();}
async function start(event){event.preventDefault();if(busy)return;
 const normalized=date.value.trim().replace(/^(\d{4})(\d{2})(\d{2})$/,'$1-$2-$3'),b=Number(boxes.value),e=Number(each.value),amount=b*current.product.packSize+e;
 if(!Number.isSafeInteger(b)||b<0||!Number.isSafeInteger(e)||e<0||amount<=0||amount>current.group.quantity||!/^\d{4}-\d{2}-\d{2}$/.test(normalized)||!Number.isFinite(Date.parse(normalized))||new Date(normalized).toISOString().slice(0,10)!==normalized){error.textContent='변경 유지기한과 재고 범위 안의 수량을 확인해 주세요.';error.hidden=false;return;}
 if(!confirm(`${current.product.name}\n셀 ${current.cell.cell} · ${current.group.expiry||'유지기한없음'} → ${normalized}\n${b}박스 + 낱개 ${e} (총 ${amount}개)\n단가 0원으로 출고·반품 처리할까요?`))return;
 lock(true);error.hidden=true;const rev=revision;try{const input={owner:current.owner,code:current.product.code,cell:current.cell.cell,oldExpiry:current.group.expiry,newExpiry:normalized,boxes:b,each:e,confirm:true,requestId:current.requestId};await poll(await api('/api/expiry-change/start',{method:'POST',body:JSON.stringify(input)}),rev);}catch(err){error.textContent=err.message+' · 제출했다면 다시 실행하기 전에 변경 기록을 확인해 주세요.';error.hidden=false;submit.hidden=true;}finally{lock(false);}
}
async function resume(action){if(busy||!jobId)return;if(action==='continue'&&!confirm('이미 처리된 단계는 재실행하지 않고 결과를 확인한 뒤 남은 단계만 진행할까요?'))return;lock(true);try{await poll(await api(`/api/expiry-change/jobs/${jobId}/${action}`,{method:'POST',body:JSON.stringify({confirm:true})}),revision);}catch(err){error.textContent=err.message;error.hidden=false;}finally{lock(false);}}
export async function openExpiryChange(owner,product,cell,group,refresh){
 init();if(busy){dialog.showModal();return;}const rev=++revision;current={owner,product,cell,group,refresh,requestId:crypto.randomUUID()};jobId=null;
 info.textContent=`${product.name} · 셀 ${cell.cell} · ${group.expiry||'유지기한없음'} · 본입수 ${product.packSize} · 재고 ${group.quantity}개`;date.value='';boxes.value='1';each.value='0';status.textContent='';error.hidden=true;recheck.hidden=true;continueButton.hidden=true;submit.hidden=false;
 availability.textContent='이동가능수량 · 전산 조회 중…';availability.dataset.state='loading';
 void api('/api/stock-availability?'+new URLSearchParams({mode:'expiry',owner,code:product.code,cell:cell.cell,oldExpiry:group.expiry||''})).then(data=>{
  if(rev!==revision||!dialog.open)return;if(!Number.isFinite(data.available)||data.available<0)throw Error('이동가능수량 확인 필요');current.available=data.available;
  availability.textContent=`이동가능수량 · ${data.available.toLocaleString('ko-KR')}개 (${Math.floor(data.available/product.packSize).toLocaleString('ko-KR')}박스 + 낱개 ${(Math.round(data.available%product.packSize*1e6)/1e6).toLocaleString('ko-KR')})\n선택한 보관셀·기존 유지기한 기준`;if(data.reason)availability.textContent+='\n'+data.reason;availability.dataset.state='ready';updateAll();
 }).catch(()=>{if(rev===revision&&dialog.open){availability.textContent='이동가능수량 · 확인 필요 · 실행 전 전산에서 다시 확인합니다.';availability.dataset.state='error';}});
 dialog.showModal();lock(true);try{const data=await api(`/api/expiry-change/jobs?owner=${encodeURIComponent(owner)}&code=${encodeURIComponent(product.code)}`),prior=data.jobs.find(j=>['running','checking','uncertain'].includes(j.state));if(rev!==revision)return;if(prior)await poll(prior,rev);}catch(err){error.textContent=err.message;error.hidden=false;submit.hidden=true;}finally{lock(false);}
}
