import {api,apiFetch} from './api.js';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);n.className=cls;if(text!=null)n.textContent=text;return n;};
const format=n=>n.toLocaleString('ko-KR');
async function encodePhoto(file){
 if(!file.type.startsWith('image/')||file.size>30*1024*1024)throw Error('30MB 이하의 사진을 선택해 주세요.');
 const url=URL.createObjectURL(file),img=new Image();
 try{
  img.src=url;await img.decode();const scale=Math.min(2000/img.naturalWidth,2000/img.naturalHeight,1),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  let blob;for(const quality of [.86,.72,.56]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=2*1024*1024)break;}
  if(!blob||blob.size>2*1024*1024)throw Error('사진 용량이 큽니다. 가까이 촬영하거나 사진을 나눠서 저장해 주세요.');
  const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('사진을 읽지 못했습니다.'));reader.readAsDataURL(blob);});
  return {mime:blob.type,data,preview:URL.createObjectURL(blob)};
 }catch(error){throw Error(error.message==='The source image cannot be decoded.'?'사진을 읽지 못했습니다. 카메라로 다시 촬영하거나 JPG 사진을 선택해 주세요.':error.message);}
 finally{URL.revokeObjectURL(url);}
}

export function createStocktakePhotos({view,context,setBusy,isBusy=()=>false,notify=()=>{}}){
 let currentRound='',rounds=[],records=[],currentRecords=[],generation=0,requestVersion=0,account='',dialog=null,saving=false;
 const normal=[...view.querySelectorAll('.stocktake-controls,.stocktake-progress,.stocktake-layout')],tabs=el('div',null,'stocktake-photo-tabs'),normalTab=el('button','기존 실사','picking-button'),photoTab=el('button','사진 재고','picking-button');
 normalTab.type=photoTab.type='button';tabs.append(normalTab,photoTab);view.querySelector('.page-heading').after(tabs);
 const panel=el('section',null,'card stocktake-photo-panel');panel.hidden=true;
 const controls=el('div',null,'stocktake-photo-controls'),roundSelect=el('select'),search=el('input'),reload=el('button','새로 확인','picking-button'),exportButton=el('button','사진 재고 엑셀 출력','primary');
 roundSelect.setAttribute('aria-label','사진 실사 회차');search.type='search';search.placeholder='로케이션 또는 상품명';search.setAttribute('aria-label','사진 재고 검색');reload.type=exportButton.type='button';
 controls.append(roundSelect,search,reload,exportButton);const status=el('p',null,'stocktake-photo-status'),count=el('p',null,'stocktake-photo-count'),scroll=el('div',null,'stocktake-photo-table-scroll'),table=el('table'),head=el('thead'),h=el('tr'),body=el('tbody');
 for(const label of ['로케이션','상품명','본입수','박스수','낱개수','총수량','사진','관리'])h.append(el('th',label));head.append(h);table.append(head,body);scroll.append(table);
 panel.append(controls,status,count,el('p','표를 좌우로 밀어 수량과 사진 버튼을 확인하세요.','stocktake-photo-scroll-hint muted small'),scroll,el('p','사진이 있는 기록만 표시합니다. 사진 등록은 앱에만 저장되며 전산 재고는 변경하지 않습니다.','muted small'));view.append(panel);
 const note=(text,error=false,announce=false)=>{status.textContent=text;status.className=error?'error':'stocktake-photo-status';if(panel.hidden&&(error||announce))notify(text,error);};
 const activeRound=()=>roundSelect.value||currentRound;
 const photoPath=path=>path+(path.includes('?')?'&':'?')+'owner='+encodeURIComponent(context().owner||'A00242');
 function switchMode(value){for(const n of normal)n.hidden=value;panel.hidden=!value;normalTab.setAttribute('aria-pressed',String(!value));photoTab.setAttribute('aria-pressed',String(value));if(value)void refresh();}
 normalTab.onclick=()=>switchMode(false);photoTab.onclick=()=>switchMode(true);switchMode(false);
 function render(){
  const q=search.value.normalize('NFKC').toLowerCase().replace(/\s/g,''),shown=records.filter(r=>!q||(r.cell+r.name).normalize('NFKC').toLowerCase().replace(/\s/g,'').includes(q));
  count.textContent=`사진 재고 ${shown.length}건 · ${shown.reduce((n,r)=>n+r.photos.length,0)}장`;body.replaceChildren();
  for(const record of shown){
   const tr=el('tr');tr.dataset.photoRecord=record.id;for(const key of ['cell','name','packSize','boxes','loose','quantity']){const td=el('td',typeof record[key]==='number'?format(record[key]):record[key]);
    if(key==='name')td.append(el('small',record.productCode?'전산 상품 연동':'직접 입력'));tr.append(td);}
   const images=el('td'),open=el('button',`사진 보기 ${record.photos.length}장`,'picking-button');open.type='button';open.onclick=()=>showPhotos(record);images.append(open);
   const actions=el('td'),edit=el('button','수정','picking-button'),remove=el('button','삭제','stocktake-photo-remove');edit.type=remove.type='button';edit.onclick=()=>openForm({record});remove.onclick=()=>void removeRecord(record);actions.append(edit,remove);tr.append(images,actions);body.append(tr);
  }
  if(!shown.length){const tr=el('tr'),td=el('td','등록된 사진 재고가 없습니다. 로케이션이나 상품 옆의 카메라 버튼으로 촬영해 주세요.','stocktake-empty');td.colSpan=8;tr.append(td);body.append(tr);}
  exportButton.disabled=saving||isBusy()||!shown.length;reload.disabled=saving||isBusy();
 }
 async function refresh(){
  const rev=generation,request=++requestVersion;reload.disabled=true;
  try{
   const selected=roundSelect.value,result=await api(photoPath('/api/stocktake/photos'+(selected?'?round='+encodeURIComponent(selected):'')));if(rev!==generation||request!==requestVersion)return;
   if(currentRound!==result.currentRound)currentRecords=[];currentRound=result.currentRound;rounds=result.rounds;records=result.records.filter(r=>r.photos.length);
   if(!selected||selected==='all'||selected===currentRound)currentRecords=records.filter(r=>r.round===currentRound);
   roundSelect.replaceChildren();const latest=el('option','이번 실사');latest.value='';const all=el('option','모든 실사');all.value='all';roundSelect.append(latest,all);
   for(const round of rounds.filter(r=>r!==currentRound)){const o=el('option',new Date(round).toLocaleString('ko-KR'));o.value=round;roundSelect.append(o);}roundSelect.value=selected;
   render();note('사진은 서버에 저장되어 재로그인 후에도 확인할 수 있습니다.');
  }catch(error){if(rev===generation&&request===requestVersion)note(error.message,true);}finally{if(rev===generation&&request===requestVersion)reload.disabled=saving;}
 }
 reload.onclick=()=>void refresh();roundSelect.onchange=()=>void refresh();search.oninput=render;
 async function post(input){const result=await api(photoPath('/api/stocktake/photos'),{method:'POST',body:JSON.stringify(input)});currentRecords=currentRecords.filter(r=>r.id!==input.id);if(result.record?.round===currentRound)currentRecords.push(result.record);return result;}
 async function removeRecord(record){if(saving||isBusy()||!confirm(`${record.cell} · ${record.name} 사진 기록을 삭제할까요? 전산 재고와 기존 실사수량은 유지됩니다.`))return;saving=true;setBusy(true);try{await post({action:'delete',id:record.id,version:record.version,requestId:crypto.randomUUID()});await refresh();note('사진 기록을 삭제했습니다.');}catch(e){note(e.message,true);}finally{saving=false;setBusy(false);render();}}
 function closeDialog(){if(dialog){const previous=dialog;dialog=null;previous.close();previous.remove();}}
 function showPhotos(record){
  closeDialog();const d=dialog=el('dialog',null,'stocktake-photo-dialog'),heading=el('div',null,'workflow-dialog-heading'),title=el('h2',`${record.cell} · ${record.name}`),close=el('button','닫기','workflow-dialog-cancel');close.type='button';heading.append(title,close);d.append(heading);
  const tools=el('div',null,'stocktake-photo-view-tools'),prev=el('button','이전 사진','picking-button'),next=el('button','다음 사진','picking-button'),zoom=el('button','확대','picking-button'),remove=el('button','현재 사진 삭제','stocktake-photo-remove'),position=el('span');
  for(const b of [prev,next,zoom,remove])b.type='button';tools.append(prev,position,next,zoom,remove);const frame=el('div',null,'stocktake-photo-frame'),image=el('img');frame.append(image);d.append(tools,frame);let index=0,large=false;
  const draw=()=>{const p=record.photos[index];image.src=p.url;image.alt=`${record.cell} ${record.name} 사진 ${index+1}`;position.textContent=`${index+1} / ${record.photos.length}`;prev.disabled=index===0;next.disabled=index===record.photos.length-1;image.classList.toggle('large',large);zoom.textContent=large?'맞춰 보기':'확대';};
  prev.onclick=()=>{index--;draw();};next.onclick=()=>{index++;draw();};zoom.onclick=()=>{large=!large;draw();};close.onclick=()=>d.close();
  remove.onclick=async()=>{if(saving||!confirm('현재 사진을 삭제할까요? 마지막 사진을 삭제하면 사진 재고 목록에서 제외됩니다.'))return;saving=true;setBusy(true);for(const b of [prev,next,zoom,remove,close])b.disabled=true;try{await post({action:'delete-photo',id:record.id,version:record.version,photoId:record.photos[index].id,requestId:crypto.randomUUID()});d.close();await refresh();}catch(e){note(e.message,true);d.close();}finally{saving=false;setBusy(false);render();}};
  d.addEventListener('cancel',e=>{if(saving)e.preventDefault();});d.addEventListener('close',()=>{d.remove();if(dialog===d)dialog=null;},{once:true});document.body.append(d);d.showModal();draw();
 }
 function openForm({cell,product,record,capture=false}={}){
  if(saving||isBusy())return;const ctx=context(),location=record?.cell||cell||ctx.cell,source=ctx.snapshot?.cells.find(c=>c.cell===location),existing=record||currentRecords.find(r=>r.cell===location&&product&&r.productCode===product.code);
  if(!existing&&!source){note('먼저 전산 재고를 조회하고 촬영할 로케이션을 선택해 주세요.',true);return;}
  closeDialog();const rev=generation,d=dialog=el('dialog',null,'stocktake-photo-dialog stocktake-photo-form-dialog'),form=el('form'),heading=el('div',null,'workflow-dialog-heading'),title=el('h2',`${location} · ${existing?'사진 재고 수정':product?'상품 사진 등록':'로케이션 사진 등록'}`),close=el('button','취소','workflow-dialog-cancel');close.type='button';heading.append(title,close);form.append(heading);
  const intro=el('p',product?'현재 보관셀의 전산 상품을 연결했습니다. 사진 속 실물 수량을 확인해 주세요.':'상품명·본입수·박스·낱개 수량을 직접 입력하거나, 현재 보관셀의 전산 상품을 선택하세요.','muted small');form.append(intro);
  const fields=el('div',null,'stocktake-photo-fields'),select=el('select');select.setAttribute('aria-label','현재 보관셀 전산 상품');const manual=el('option','직접 입력');manual.value='';select.append(manual);
  for(const p of source?.items||[]){const o=el('option',p.name);o.value=p.code;select.append(o);}
  if(existing?.productCode&&![...select.options].some(o=>o.value===existing.productCode)){const o=el('option',existing.name);o.value=existing.productCode;select.append(o);}
  const linkLabel=el('label','현재 보관셀 상품 연결');linkLabel.append(select);fields.append(linkLabel);
  function field(label,key,type){const wrap=el('label',label),input=el('input');input.name=key;input.type=type;input.required=!['boxes','loose'].includes(key);if(type==='number'){input.min=key==='packSize'?'1':'0';input.step='1';input.inputMode='numeric';}wrap.append(input);fields.append(wrap);return input;}
  const name=field('상품명','name','text'),pack=field('본입수','packSize','number'),boxes=field('박스수','boxes','number'),loose=field('수량 (낱개)','loose','number');name.maxLength=200;
  name.value=existing?.name||'미확인';pack.value=existing?.packSize??'';boxes.value=existing?.boxes??'';loose.value=existing?.loose??'';
  const total=el('p',null,'stocktake-count-preview'),previews=el('div',null,'stocktake-photo-previews'),add=el('button','📷 사진 촬영·추가','picking-button stocktake-camera'),files=el('input'),status=el('p',null,'stocktake-photo-form-status'),submit=el('button',existing?'수정 저장':'사진 재고 등록','primary');
  add.type='button';files.type='file';files.accept='image/*';files.setAttribute('capture','environment');files.multiple=true;files.hidden=true;files.setAttribute('aria-label','촬영한 사진');submit.type='submit';status.setAttribute('role','status');
  const pending=[];let uploading=false,loading=false,dirty=false,id=existing?.id||crypto.randomUUID(),requestId='',lastPayload='';
  const update=()=>{const n=Number(pack.value)*Number(boxes.value||0)+Number(loose.value||0);total.textContent=pack.value&&(boxes.value!==''||loose.value!=='')&&Number.isFinite(n)?`총 ${format(n)}개 · ${boxes.value||0}박스 + 낱개 ${loose.value||0}`:'본입수와 박스·낱개 수량을 입력해 주세요.';};
  function applyProduct(code,copyQuantity=true){select.value=code;name.readOnly=pack.readOnly=!!code;if(code){const p=existing?.productCode===code?existing:source?.items.find(p=>p.code===code);name.value=p.name;pack.value=p.packSize;if(copyQuantity&&p.stock){boxes.value=Math.floor(p.stock.quantity/p.packSize);loose.value=p.stock.quantity%p.packSize;}}update();}
  select.onchange=()=>{dirty=true;applyProduct(select.value);};for(const input of [name,pack,boxes,loose])input.oninput=()=>{dirty=true;update();};
  applyProduct(existing?.productCode||product?.code||'',!existing);if(existing){boxes.value=existing.boxes;loose.value=existing.loose;update();}
  function renderPhotos(){previews.replaceChildren();for(const p of existing?.photos||[]){const img=el('img');img.src=p.url;img.alt='저장된 사진';previews.append(img);}for(const p of pending){const wrap=el('div'),img=el('img'),remove=el('button','빼기','stocktake-photo-remove');img.src=p.preview;img.alt='등록할 사진 미리보기';remove.type='button';remove.onclick=()=>{pending.splice(pending.indexOf(p),1);URL.revokeObjectURL(p.preview);renderPhotos();};wrap.append(img,remove);previews.append(wrap);}submit.disabled=uploading||loading;}
  files.onchange=async()=>{if(uploading||loading)return;loading=true;renderPhotos();status.textContent='사진을 준비하고 있습니다…';try{for(const file of files.files){if((existing?.photos.length||0)+pending.length>=6)throw Error('사진은 기록당 최대 6장입니다.');const p=await encodePhoto(file);if(rev!==generation||!d.isConnected){URL.revokeObjectURL(p.preview);return;}pending.push(p);dirty=true;}status.textContent='사진 준비 완료 · 등록 버튼을 눌러 서버에 저장해 주세요.';}catch(e){status.textContent=e.message;}finally{files.value='';loading=false;renderPhotos();}};
  add.onclick=()=>files.click();close.onclick=()=>{if(uploading||loading)return;if(dirty&&!confirm('아직 저장하지 않은 사진·입력이 있습니다. 닫을까요?'))return;d.close();};
  form.onsubmit=async event=>{event.preventDefault();if(uploading||loading||!form.reportValidity())return;if(boxes.value===''&&loose.value===''){status.textContent='박스 또는 낱개 수량을 입력해 주세요.';return;}
   const payload={action:'save',id,version:existing?.version,round:existing?.round||currentRound||ctx.round,cell:location,queryId:ctx.queryId,productCode:select.value,name:name.value,packSize:Number(pack.value),boxes:Number(boxes.value||0),loose:Number(loose.value||0),photos:pending.map(p=>({mime:p.mime,data:p.data}))};
   const signature=JSON.stringify(payload);if(signature!==lastPayload){requestId=crypto.randomUUID();lastPayload=signature;}uploading=saving=true;setBusy(true);for(const control of form.elements)control.disabled=true;status.textContent='사진과 입력 내용을 서버에 저장하고 있습니다…';
   try{await post({...payload,requestId});if(rev!==generation)return;dirty=false;d.close();await refresh();note('사진 재고 저장 완료 · 서버에 저장됐습니다.',false,true);}
   catch(e){if(rev===generation)status.textContent=e.message+' · 입력과 사진은 유지됩니다. 확인 후 다시 저장해 주세요.';}
   finally{uploading=saving=false;setBusy(false);if(d.isConnected){for(const control of form.elements)control.disabled=false;applyProduct(select.value,false);renderPhotos();}render();}
  };
  d.addEventListener('cancel',event=>{if(uploading||loading||dirty&&!confirm('저장하지 않은 내용을 닫을까요?'))event.preventDefault();});d.addEventListener('close',()=>{for(const p of pending)URL.revokeObjectURL(p.preview);d.remove();if(dialog===d)dialog=null;},{once:true});
  form.append(fields,total,previews,files,add,status,submit);d.append(form);document.body.append(d);d.showModal();renderPhotos();if(capture)files.click();
 }
 exportButton.onclick=async()=>{if(saving||isBusy()||!records.length)return;const rev=generation;saving=true;setBusy(true);note('사진을 포함한 엑셀 파일을 만들고 있습니다…');try{
  const response=await apiFetch(photoPath('/api/stocktake/photos/export'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({round:activeRound(),q:search.value})});if(!response.ok){const d=await response.json();throw Error(d.error||'사진 엑셀 생성 실패');}
  const blob=await response.blob();if(rev!==generation)return;const url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download=(context().ownerName||'로케이션')+'_사진재고.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);note('엑셀 다운로드 완료 · 사진 보기 셀을 누르면 파일 안의 사진이 열립니다.');
 }catch(e){if(rev===generation)note(e.message,true);}finally{saving=false;setBusy(false);render();}};
 return {
  cameraButton(cell,product){const b=el('button',product?'📷 상품 촬영':'📷 로케이션 촬영','picking-button stocktake-camera');b.type='button';b.setAttribute('aria-label',`${cell.cell} ${product?.name||'로케이션'} 사진 촬영`);b.onclick=()=>openForm({cell:cell.cell,product,capture:true});return b;},
  refresh,sync:render,
  connect(data){const key=JSON.stringify([data.username,data.warehouse,data.stocktakeOwner||context().owner]);if(account!==key){this.reset();account=key;}if(data.owners.some(o=>o.code===(data.stocktakeOwner||context().owner)))void refresh();},
  reset(){generation++;requestVersion++;records=[];currentRecords=[];currentRound='';rounds=[];account='';saving=false;search.value='';roundSelect.replaceChildren();closeDialog();switchMode(false);render();}
 };
}
