import {api} from './api.js';
const el=(tag,text,cls='')=>{const e=document.createElement(tag);e.className=cls;if(text!=null)e.textContent=text;return e;};
let dialog,form,info,summary,status,error,boxes,each,submit,recheck,next,another,availabilityRow,availability,all,context,jobId,busy=false,version=0;
function init(){
 if(dialog)return;dialog=el('dialog',null,'shipment-dialog');dialog.id='shipment-dialog';dialog.setAttribute('aria-labelledby','shipment-title');form=el('form');const title=el('h2');title.id='shipment-title';info=el('p');summary=el('p',null,'shipment-summary');status=el('p');status.setAttribute('role','status');error=el('p',null,'error');error.setAttribute('role','alert');error.hidden=true;
 form.append(title,info);availabilityRow=el('div',null,'stock-availability-row');availability=el('p',null,'stock-availability');availability.id='shipment-available';availability.setAttribute('aria-live','polite');all=el('button','전량 이동','stock-fill-all');all.id='shipment-all';all.type='button';availabilityRow.append(availability,all);form.append(availabilityRow);const field=(text,id)=>{const label=el('label',text),input=el('input');input.type='number';input.id=id;input.inputMode='numeric';input.min='0';input.step='1';input.required=true;label.htmlFor=id;label.append(input);form.append(label);return input;};boxes=field('출고 박스수','shipment-boxes');each=field('출고 낱개수','shipment-each');form.append(summary,status,error);
 recheck=el('button','결과 재확인','text-button');next=el('button','남은 단계 이어서 처리','text-button');for(const b of [recheck,next]){b.type='button';b.hidden=true;form.append(b);}
 another=el('button','새 조정 출고 입력','text-button');another.type='button';another.hidden=true;form.append(another);another.onclick=async()=>{if(busy)return;context.requestId=crypto.randomUUID();jobId=null;submit.hidden=false;another.hidden=true;recheck.hidden=next.hidden=true;error.hidden=true;boxes.readOnly=each.readOnly=false;boxes.value=each.value='0';status.textContent='새 조정 출고 · 수량을 입력해 주세요.';quantitySummary();lock(true);try{await loadAvailability(version);}finally{lock(false);}};
 const actions=el('div',null,'picking-actions'),close=el('button','닫기','text-button');close.type='button';submit=el('button','전산 출고 실행','primary');submit.type='submit';actions.append(close,submit);form.append(actions);dialog.append(form);document.body.append(dialog);
 boxes.oninput=each.oninput=quantitySummary;all.onclick=()=>{if(all.disabled)return;boxes.value=String(Math.floor(context.available/context.product.packSize));each.value=String(context.available%context.product.packSize);quantitySummary();};close.onclick=()=>dialog.close();form.onsubmit=start;recheck.onclick=()=>resume('recheck');next.onclick=()=>resume('continue');
}
function updateAll(){all.disabled=busy||context?.mode!=='adjust'||submit.hidden||boxes.readOnly||!Number.isSafeInteger(context.available)||context.available<=0;}
async function loadAvailability(rev){
 context.available=null;availability.textContent='이동가능수량 · 전산 조회 중…';availability.dataset.state='loading';updateAll();
 try{const data=await api('/api/stock-availability?'+new URLSearchParams({mode:'shipment',owner:context.owner,code:context.product.code,...(context.scope||{})}));if(rev!==version)return;
  if(!Number.isFinite(data.available)||data.available<0||!Number.isFinite(data.quantity)||data.quantity<0||data.available>data.quantity||(data.quantity>0&&data.packSize!==context.product.packSize))throw Error('출고 가능 재고 확인 필요');
  context.available=data.available;context.product={...context.product,quantity:data.quantity};info.textContent=`${context.product.name} · 본입수 ${context.product.packSize} · 현재 재고 ${data.quantity.toLocaleString('ko-KR')}개`;
  availability.textContent=`이동가능수량 · ${data.available.toLocaleString('ko-KR')}개 (${Math.floor(data.available/context.product.packSize).toLocaleString('ko-KR')}박스 + 낱개 ${(Math.round(data.available%context.product.packSize*1e6)/1e6).toLocaleString('ko-KR')})\n${context.scope?'셀 '+context.scope.cell+' · '+(context.scope.oldExpiry||'유지기한 없음')+'의 출고 가능 수량':'이미 할당된 재고를 제외한 출고 가능 수량'}`;if(data.reason)availability.textContent+='\n'+data.reason;availability.dataset.state='ready';
 }catch(e){if(rev===version){availability.textContent='이동가능수량 · 확인 필요 · '+e.message;availability.dataset.state='error';}}finally{if(rev===version)updateAll();}
}
function quantitySummary(){if(!context||context.mode!=='adjust')return;const b=Number(boxes.value),e=Number(each.value),amount=b*context.product.packSize+e;summary.textContent=`이번 출고 ${b}박스 + 낱개 ${e} · 총 ${amount}개\n타계정출고 · 오늘 날짜 · 재고처리 · 비고 전산조정 · 단가 0원\n할당 → 피킹확정 → 출고확정까지 전산 처리합니다.`;}
function lock(value){busy=value;for(const e of [boxes,each,submit,recheck,next,another])e.disabled=value;updateAll();}
function paint(j){jobId=j.id;status.textContent=`${j.state==='complete'?'완료':j.state==='uncertain'?'결과 확인 필요':j.state==='failed'?'처리 실패':'처리 중'} · ${j.phase||''}${j.order?.orderNo?' · '+j.order.orderNo:''}`;
 if(context.mode==='adjust'&&Number.isSafeInteger(j.input?.boxes)&&Number.isSafeInteger(j.input?.each)){boxes.value=String(j.input.boxes);each.value=String(j.input.each);quantitySummary();}
 boxes.readOnly=each.readOnly=j.state!=='failed'||j.registrationRejected===true;
 if(j.state==='complete'){status.textContent+=` · ${j.data.status} · ${j.data.quantity}개`;for(const b of j.data.balances||[])status.textContent+=` · 재고 ${b.before} → ${b.after}`;}
 error.textContent=j.error||'';error.hidden=!j.error;recheck.hidden=j.state!=='uncertain';next.hidden=j.state!=='uncertain';submit.hidden=['uncertain','complete'].includes(j.state)||j.registrationRejected===true;
 another.hidden=!(j.state==='complete'||j.registrationRejected===true)||context.mode!=='adjust';
 if(j.state==='failed'&&!j.intents?.length)context.requestId=crypto.randomUUID();
}
async function follow(j,rev){while(['running','checking'].includes(j.state)){if(rev!==version)return;paint(j);await new Promise(r=>setTimeout(r,700));j=await api('/api/shipment/jobs/'+j.id);}if(rev!==version)return;paint(j);if(j.state==='complete')await context.done?.(j.data);}
async function start(event){event.preventDefault();if(busy)return;let input,question;
 if(context.mode==='adjust'){
  const b=Number(boxes.value),e=Number(each.value),quantity=b*context.product.packSize+e;
  if(!boxes.value||!each.value||!Number.isSafeInteger(b)||b<0||!Number.isSafeInteger(e)||e<0||!Number.isSafeInteger(quantity)||quantity<=0||quantity>context.product.quantity){error.textContent='현재 재고 범위 안의 박스수·낱개수를 입력해 주세요.';error.hidden=false;return;}
  input={owner:context.owner,code:context.product.code,packSize:context.product.packSize,boxes:b,each:e,...(context.scope||{})};question=`${context.product.name}${context.scope?'\n차감 셀 '+context.scope.cell+' · '+(context.scope.oldExpiry||'유지기한 없음'):''}\n${b}박스 + 낱개 ${e} (총 ${quantity}개)\n타계정출고 · 재고처리 · 전산조정 · 단가 0원\n실제 재고를 차감하고 검수완료까지 처리할까요?`;
 }else{input={key:context.order.key};question=`${context.order.customer} · ${context.order.orderNo}\n현재 ${context.order.status} · 전체 ${context.order.quantity}개\n남은 접수·할당·피킹확정·출고확정을 처리할까요?`;}
 if(!confirm(question))return;lock(true);error.hidden=true;const rev=version;
 try{await follow(await api('/api/shipment/'+(context.mode==='adjust'?'adjust':'complete'),{method:'POST',body:JSON.stringify({...input,requestId:context.requestId,confirm:true})}),rev);}catch(e){error.textContent=e.message+' · 요청을 제출했다면 닫았다가 다시 열어 기록을 확인해 주세요.';error.hidden=false;submit.hidden=true;}finally{lock(false);}
}
async function resume(action){if(busy||!jobId)return;if(action==='continue'&&!confirm('이미 요청한 단계는 다시 보내지 않고 결과를 확인한 뒤 남은 단계만 처리할까요?'))return;lock(true);try{await follow(await api(`/api/shipment/jobs/${jobId}/${action}`,{method:'POST',body:JSON.stringify({confirm:true})}),version);}catch(e){error.textContent=e.message;error.hidden=false;}finally{lock(false);}}
async function open(value){
 init();if(busy){if(!dialog.open)dialog.showModal();return;}context={...value,requestId:crypto.randomUUID()};const rev=++version;jobId=null;
 document.getElementById('shipment-title').textContent=value.mode==='adjust'?'전산처리하기 · 타계정출고':'검수완료처리';info.textContent=value.mode==='adjust'?`${value.product.name} · 본입수 ${value.product.packSize} · 현재 재고 ${value.product.quantity}개`:`${value.order.customer} · ${value.order.orderNo}\n${value.order.date} · ${value.order.status} · ${value.order.quantity}개`;
 availabilityRow.hidden=value.mode!=='adjust';availability.textContent='이동가능수량 · 전산 조회 중…';availability.dataset.state='loading';for(const input of [boxes,each]){input.parentElement.hidden=value.mode!=='adjust';input.required=value.mode==='adjust';input.readOnly=false;input.value='0';}summary.textContent=value.mode==='adjust'?'':'주문 내용은 유지하고 남은 전산 단계만 완료합니다.';quantitySummary();status.textContent='';error.hidden=true;recheck.hidden=next.hidden=another.hidden=true;submit.hidden=false;submit.textContent=value.mode==='adjust'?'전산 출고 실행':'검수완료 처리 실행';if(!dialog.open)dialog.showModal();lock(true);
 try{
  const q=value.mode==='adjust'?`owner=${encodeURIComponent(value.owner)}&code=${encodeURIComponent(value.product.code)}`:`key=${encodeURIComponent(value.order.key)}`,data=await api('/api/shipment/jobs?'+q);
  if(rev!==version)return;
  const active=data.jobs.find(j=>['running','checking','uncertain'].includes(j.state)),prior=active||data.jobs.find(j=>(j.state==='complete'||j.registrationRejected===true)&&(value.mode==='complete'||(!value.scope||j.input?.cell===value.scope.cell&&j.input?.oldExpiry===value.scope.oldExpiry)&&Date.now()-Date.parse(j.finishedAt||j.createdAt)<600000));
  const priorScope=active?.input?.cell?{cell:active.input.cell,oldExpiry:active.input.oldExpiry||''}:undefined,differentScope=value.mode==='adjust'&&active&&(priorScope?.cell!==value.scope?.cell||priorScope?.oldExpiry!==value.scope?.oldExpiry);
  if(differentScope)context.scope=priorScope;
  if(prior)await follow(prior,rev);
  if(value.mode==='adjust'&&rev===version)await loadAvailability(rev);
  if(differentScope&&rev===version){error.textContent='선택한 범위와 다른 전산처리가 진행 중이어서 기존 건을 표시합니다. 위 재고 범위를 확인한 뒤 이어서 처리해 주세요.';error.hidden=false;}
 }catch(e){error.textContent=e.message;error.hidden=false;submit.hidden=true;}finally{lock(false);}
}
export const openStockAdjustment=(owner,product,done,scope)=>open({mode:'adjust',owner,product,done,scope});
export const openShipmentCompletion=(order,done)=>open({mode:'complete',order,done});
