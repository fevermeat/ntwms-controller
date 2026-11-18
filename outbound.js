import { api } from './api.js';
const $ = id => document.getElementById(id);
const el = (tag, text, cls = '') => { const e = document.createElement(tag); e.className = cls; if (text != null) e.textContent = text; return e; };
const post = (path, data) => api('/api/outbound/' + path, { method: 'POST', body: JSON.stringify(data) });
const labels = { waiting: '대기', running: '처리 중', ready: '접수 확인', complete: '할당 완료', failed: '처리 실패', partial: '부분할당', unallocated: '미할당', uncertain: '결과 확인 필요', skipped: '할당 제외' };
let owners = [], orders = [], selected = new Set(), busy = false, generation = 0;
let mounted = false;
let orderFilter = 'all', documentStatus = new Map(), statusReadState = 'loading', statusRequest = 0;
let autoState = null, autoTimer = null, autoRequest = false, autoSnapshot = '', autoJob = '', autoVersion = 0;
let orderDetails = new Map(), detailLoading = false;
let ownerSelections=[];
const detailNodes = new Map();
let palletMappings=new Map();
function refreshPalletMapping(order){
 const cache=palletMappings,rev=generation;cache.set(order.key,{loading:true});
 void api('/api/pallet/mappings?'+new URLSearchParams({key:order.key})).then(data=>{if(cache!==palletMappings||rev!==generation)return;cache.set(order.key,data);paintPalletSelections();}).catch(()=>{if(cache===palletMappings&&rev===generation)cache.set(order.key,{});});
}
function paintPalletSelections(){
 for(const article of $('out-list').children){const o=orders.find(o=>o.key===article.dataset.key),area=article.querySelector('.out-pallet-controls'),mappingArea=article.querySelector('.out-pallet-mappings');if(!o||!area||!mappingArea)continue;
  area.hidden=mappingArea.hidden=false;const visible=document.documentElement.classList.contains('desktop-ui')?article.dataset.desktopCurrent==='true':true;if(!visible)continue;
  if(!palletMappings.has(o.key))refreshPalletMapping(o);
  const saved=palletMappings.get(o.key);mappingArea.replaceChildren();for(const button of area.querySelectorAll('.out-pallet-register')){const done=saved?.registrations?.[button.dataset.kind],name=button.dataset.kind==='aj'?'AJ':'KPP';button.classList.toggle('pallet-registered',Boolean(done));button.textContent=name+'파렛트 '+(done?'등록완료 · '+done.boxes+'박스':'등록');button.title=done?'등록 주문 '+done.orderNo:'';}
  for(const kind of ['aj','kpp'])if(saved?.[kind]){const button=el('button',(kind==='aj'?'AJ':'KPP')+'파렛트 매칭거래처 수정','out-pallet-mapping');button.type='button';button.disabled=busy||autoActive();button.onclick=()=>void openPallet(o,kind,true);mappingArea.append(button);}
 }
}
async function openPallet(order,kind,edit=false){
 if(busy||autoActive())return;const rev=generation;
 try{const {openPalletOrder}=await import('./pallet.js');if(rev!==generation)return;await openPalletOrder(order,kind,{edit,valid:()=>rev===generation,onMappingChanged:()=>refreshPalletMapping(order),onSaved:data=>{refreshPalletMapping(order);message(`${kind==='aj'?'AJ':'KPP'}파렛트 · ${data.customer.name} · ${data.boxes}박스 · 주문 ${data.orderNo} 저장 완료`);}});}catch(e){if(rev===generation)message(e.message,true);}
}
const autoActive = () => Boolean(autoState?.enabled || ['querying','processing'].includes(autoState?.state));
const readFilters = () => ({ owner: $('out-owner').value, from: $('out-from').value, to: $('out-to').value, type: $('out-type').value, customer: $('out-customer').value, remark: $('out-remark').value });
function updateStickyOffsets() {
  const nav=document.querySelector('.controller-tabs');document.documentElement.style.setProperty('--controller-height',`${nav?.offsetHeight||0}px`);
  const view=$('outbound-view'),note=$('out-auto-status'),options=$('out-options');if(!view||!note||!options)return;
  note.dataset.active=String(autoActive());
  view.style.setProperty('--out-auto-height',`${autoActive()?note.offsetHeight:0}px`);
  view.style.setProperty('--out-options-height',`${options.open?options.querySelector(':scope > summary').offsetHeight:0}px`);
}
function currentStatus(order) { return statusReadState === 'ready' ? documentStatus.get(order.key) : undefined; }
function visibleOrders(filter = orderFilter) {
  if (filter === 'all') return orders;
  return orders.filter(order => {
    const status = currentStatus(order);
    return !status || (filter === 'pending' ? status.pending && !status.pendingHidden : status.attention);
  });
}
function clearHiddenSelections() {
  const visible = new Set(visibleOrders().filter(o=>!o.processingIssue).map(o => o.key));
  selected = new Set([...selected].filter(key => visible.has(key)));
}
function message(text, error = false) { $('out-message').textContent = text; $('out-message').className = error ? 'error' : 'out-status'; }
function ownerOptions() {
  const selectedValue = $('out-owner').value||'*';
  const chosen=(ownerSelections.length?ownerSelections:selectedValue==='*'?[]:selectedValue.split(',')).filter(code=>owners.some(o=>o.code===code));
  const q = $('out-owner-search').value.trim().toLowerCase();
  $('out-owner').replaceChildren(new Option('전체 · 내 화주 전체', '*'));
  if(chosen.length>1)$('out-owner').add(new Option(chosen.map(code=>owners.find(o=>o.code===code).name).join(' + '),chosen.join(',')));
  owners.filter(o => (o.name + o.code).toLowerCase().includes(q)||chosen.includes(o.code)).forEach(o => $('out-owner').add(new Option(`${o.name} (${o.code})`, o.code)));
  $('out-owner').value=chosen.length?chosen.join(','):'*';ownerSelections=chosen;
  if($('out-owner-checks')){
    $('out-owner-checks').replaceChildren();
    for(const o of owners.filter(o=>(o.name+o.code).toLowerCase().includes(q))){const label=el('label'),check=el('input');check.type='checkbox';check.value=o.code;check.checked=chosen.includes(o.code);check.onchange=()=>chooseOwners(check.checked?[...ownerSelections,o.code]:ownerSelections.filter(c=>c!==o.code));label.append(check,el('span',`${o.name} (${o.code})`));$('out-owner-checks').append(label);}
    $('out-owner-multi').querySelector('summary').textContent=chosen.length?`여러 화주 선택 · ${chosen.length}개`:'여러 화주 선택';
  }
}
function chooseOwners(codes){palletMappings=new Map();ownerSelections=[...new Set(codes)];$('out-owner').value='*';ownerOptions();invalidateTms();orders=[];selected.clear();orderDetails.clear();render();message('화주를 선택한 뒤 조회를 눌러 주세요.');setBusy(busy);}
function invalidateTms(){if(!busy){$('out-tms-result').textContent='';$('out-tms-result').hidden=true;}}
function setBusy(value) {
  busy = value;
  const locked = value || autoActive();
  for (const e of $('out-filter').elements) e.disabled = locked;
  if ($('out-auto')) {
    $('out-auto').disabled = autoRequest || (!autoState?.enabled && (value || autoActive()));
    $('out-auto').textContent = autoState?.enabled ? '자동화 중지' : autoActive() ? '중지 처리 중…' : '자동화 시작 · 5분';
    $('out-auto').setAttribute('aria-pressed', String(Boolean(autoState?.enabled)));
  }
  $('out-all').disabled = value;
  $('out-run').disabled = locked || !selected.size;

  if ($('out-print')) $('out-print').disabled = locked || !selected.size;
  if ($('out-hide-pending')) {
    $('out-hide-pending').disabled = value || !selected.size || statusReadState !== 'ready';
    $('out-hide-pending').textContent = selected.size && [...selected].every(key => documentStatus.get(key)?.pendingHidden) ? '미처리 숨김 해제' : '직접 처리 완료 · 미처리 숨김';
  }
  for (const input of $('out-result-filters').querySelectorAll('button')) input.disabled = value;
  $('tab-inventory').disabled = value;
  if ($('tab-inbound')) $('tab-inbound').disabled = value;
  $('logout').disabled = locked;
  for (const input of $('out-list').querySelectorAll('input,select,button')) input.disabled = value;
  for (const input of $('out-list').querySelectorAll('.out-reset,.out-finalize,.out-delete,.out-intake,.out-pallet-register,.out-pallet-mapping')) input.disabled=locked;
  for(const article of $('out-list').querySelectorAll('.out-order'))if(orders.find(o=>o.key===article.dataset.key)?.processingIssue)for(const input of article.querySelectorAll('input,button,select'))input.disabled=true;
  for (const input of $('out-methods').querySelectorAll('input,select,button')) input.disabled = locked;
  for (const key of detailNodes.keys()) if (!orderDetails.get(key)?.data) paintOrderDetail(key);
  if (!value) queueMicrotask(() => void loadOrderDetails());
}
function selectionStatus() {
  const visible = visibleOrders(),selectable=visible.filter(o=>!o.processingIssue);
  $('out-count').textContent = `표시 ${visible.length}건 / 전체 ${orders.length}건 · ${selected.size}건 선택`;
  const chosen=visible.filter(order=>selected.has(order.key));
  const totals=$('out-selected-totals');
  totals.hidden=!chosen.length;
  totals.textContent=chosen.length ? `${chosen.reduce((sum,order)=>sum+Number(order.boxes||0),0).toLocaleString('ko-KR')}박스 · ${chosen.reduce((sum,order)=>sum+Number(order.quantity||0),0).toLocaleString('ko-KR')}개` : '';
  $('out-all').checked = selectable.length > 0 && selected.size === selectable.length;
  $('out-all').indeterminate = selected.size > 0 && selected.size < selectable.length;
  for(const [key,content] of detailNodes)content.hidden=!selected.has(key);
  setBusy(busy);
  paintPalletSelections();
}
function render() {
  clearHiddenSelections();
  detailNodes.clear();
  $('out-list').replaceChildren();
  for (const order of visibleOrders()) {
    const article = el('article', null, 'out-order'); article.dataset.key = order.key;
    Object.assign(article.dataset,{pcTitle:order.customer,pcReference:order.orderNo,pcOwner:order.ownerName,pcDate:order.date,pcType:order.type,pcDispatch:(order.expectedDispatch||'').trim(),pcBoxes:order.boxes,pcQuantity:order.quantity,pcStatus:order.status});
    const heading = el('label', null, 'out-order-heading');
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selected.has(order.key); check.setAttribute('aria-label', `${order.customer} ${order.orderNo} 선택`);
    check.addEventListener('change', () => { if (check.checked) selected.add(order.key); else selected.delete(order.key); selectionStatus(); });
    const title = el('div'),mappingArea=el('div',null,'out-pallet-mappings');mappingArea.hidden=true;title.append(el('strong', order.customer), el('small', `${order.ownerName} · ${order.orderNo}`),mappingArea);heading.append(check, title); article.append(heading);
    const meta=el('p',null,'out-meta');
    meta.append(document.createTextNode(`${order.date} · ${order.type} · `),el('strong',`박스 ${order.boxes}`,'out-quantity'),document.createTextNode(' · '),el('strong',`낱개수량 ${order.quantity}`,'out-quantity'));
    article.append(meta);
    article.append(el('p', order.remark || '비고 없음', 'out-remark'));
    if(order.processingIssue)article.append(el('p',`${order.processingIssue} · 자동 처리 제외 · 전산 확인 후 다시 조회해 주세요.`,'error out-validation'));
    const actual=(order.actualDispatch||'').trim(),expected=(order.expectedDispatch||'').trim(),phone=(order.driverPhone||'').trim();
    article.append(el('p',`${actual?'실배차':expected?'예상배차':'배차'} · ${actual||expected||'미등록'} · 기사 전화번호 · ${phone||'미등록'}`,'out-meta out-dispatch'));
    const status = el('p', '', 'out-result'); article.append(status);
    const progress=el('div',null,'out-progress');progress.setAttribute('aria-label','주문 처리 단계');article.append(progress);
    article.append(el('p', '', 'out-history'));
    article.append(el('p', '', 'out-hidden-note'));
    const pallets=el('div',null,'out-pallet-controls');pallets.hidden=true;for(const kind of ['aj','kpp']){const button=el('button',(kind==='aj'?'AJ':'KPP')+'파렛트 등록','out-pallet-register');button.type='button';button.dataset.kind=kind;button.onclick=()=>void openPallet(order,kind);pallets.append(button);}article.append(pallets);
    const content = el('div', null, 'out-detail-content');
    detailNodes.set(order.key, content); paintOrderDetail(order.key);
    article.append(content); $('out-list').append(article);
  }
  paintResults(); paintDocumentStatuses(); selectionStatus();
}
function paintOrderDetail(key) {
  const content = detailNodes.get(key); if (!content) return;
  content.hidden=!selected.has(key);
  const entry = orderDetails.get(key); content.replaceChildren();
  if (entry?.data) {
    for (const item of entry.data) {
      const row = el('div', null, 'out-item'),heading=el('div',null,'out-item-heading');heading.append(el('strong',item.name));row.append(heading,el('p', `본입수 ${item.packSize} · 박스수 ${item.boxes} · 낱개수량 ${item.quantity}`));
      const order=orders.find(o=>o.key===key),allocation=order?.result?.allocation||order?.result?.result?.allocation;
      const shortages=allocation?.lines?.filter(line=>line.code===item.code&&line.required>line.allocated)||[];
      const shortage=shortages.reduce((sum,line)=>sum+line.required-line.allocated,0);
      if(order?.type==='매출출고'&&(shortages.length||!allocation?.lines&&['partial','unallocated'].includes(order.result?.state))){
        const button=el('button','입고처리(타계정반품)','out-intake');button.type='button';button.disabled=busy||autoActive();button.setAttribute('aria-label',item.name+' 입고처리(타계정반품)');
        button.onclick=async()=>{if(busy||autoActive())return;const rev=generation;setBusy(true);try{const {openIntakeForProduct}=await import('./intake.js');await openIntakeForProduct(order.owner,item,{ownerName:order.ownerName,shortage:shortage||undefined,done:data=>{if(rev===generation)message(`${item.name} · 입고완료 ${data.quantity}개 · ${data.cell} · 접수·할당·출력을 다시 실행해 주세요.`);}});}catch(e){if(rev===generation)message(e.message,true);}finally{if(rev===generation)setBusy(false);}};
        heading.append(button);
      }
      content.append(row);
    }
    if (!entry.data.length) content.textContent = '상품상세가 없습니다.';
    if (entry.error) content.append(el('p', '상세 재조회 실패 · 이전 조회 내역 표시', 'out-meta'));
  } else if (entry?.error) {
    content.append(el('p', entry.error));
    const retry = el('button', '상품상세 다시 조회', 'text-button'); retry.type = 'button'; retry.disabled = busy;
    retry.onclick = () => { orderDetails.delete(key); paintOrderDetail(key); void loadOrderDetails(); }; content.append(retry);
  } else content.textContent = busy || ['querying','processing'].includes(autoState?.state)
    ? '처리 완료 후 상품상세 조회 예정' : '상품상세 조회 중…';
}
function cachedBulkDetails(data){return new Map((data.orders||[]).filter(o=>Array.isArray(data.details?.[o.key])).map(o=>[o.key,{data:data.details[o.key],stale:false}]));}
function retainOrderDetails(nextOrders,details) {
  // Keep the last successful display during automation; refresh it when work is idle.
  orderDetails = new Map(nextOrders.flatMap(o => {
    const fresh=details?.[o.key];if(Array.isArray(fresh))return [[o.key,{data:fresh,stale:false}]];
    const entry = orderDetails.get(o.key);
    return entry?.data ? [[o.key, { data: entry.data, stale: true }]] : [];
  }));
}
async function loadOrderDetails() {
  if (detailLoading || busy || !mounted || $('outbound-view').hidden || ['querying','processing'].includes(autoState?.state)) return;
  const visible=visibleOrders(),needsDetail=o=>!orderDetails.has(o.key)||orderDetails.get(o.key).stale;
  const desktop=document.documentElement.classList.contains('desktop-ui');
  const focused=desktop
    ? $('out-list').querySelector('.out-order[data-desktop-current=true]')?.dataset.key : undefined;
  // Read only details the user can see. Never prefetch the remaining orders.
  // Keep one in-flight read; a changed focus replaces the next requested key.
  const order=visible.find(o=>(desktop?o.key===focused:selected.has(o.key))&&needsDetail(o));
  if (!order) return;
  const cache = orderDetails, rev = generation, entry = { ...cache.get(order.key), stale: false };
  detailLoading = true; cache.set(order.key, entry);
  try {
    const { id } = await post('detail', { key: order.key }); const job = await poll(id, rev, false);
    if (!Array.isArray(job.data)) throw new Error('상품상세 응답을 확인하지 못했습니다.');
    entry.data = job.data;
  } catch (e) { entry.error = e.message; }
  finally {
    detailLoading = false;
    if (cache === orderDetails && rev === generation) paintOrderDetail(order.key);
    queueMicrotask(() => void loadOrderDetails());
  }
}
function paintOrderProgress(article, order, status) {
  const progress=article.querySelector('.out-progress');
  const returning=/반품/.test(order.type);
  const allocated=/^(할당완료|작업생성완료|피킹완료|출고완료|검수완료|검수완료\(출고확정\))$/.test(order.status);
  const received=allocated||/^(접수|출고접수|입고접수|입고완료|부분할당|할당중)$/.test(order.status);
  const planned=/^(출고예정|입고예정|예정)$/.test(order.status);
  const issue=['uncertain','partial','unallocated','failed'].includes(order.result?.state);
  const phase=(title,value,tone='waiting')=>{
    const node=el('div',null,'out-progress-step');node.dataset.tone=tone;
    node.append(el('span',title),el('strong',value));return node;
  };
  const receipt=phase('접수',received?'접수 완료':planned?'접수 대기':'상태 확인',received?'done':'waiting');
  const allocation=phase('할당',returning?'반품 · 해당 없음':issue?'결과 확인 필요':allocated?'할당 완료':order.status==='부분할당'?'부분할당':received||planned?'할당 대기':'상태 확인',returning?'neutral':issue||order.status==='부분할당'?'attention':allocated?'done':'waiting');
  const required=status?.required||[];
  let printing='기록 확인 중',tone='waiting';
  if(statusReadState==='failed'){printing='기록 확인 실패';tone='attention';}
  else if(status){
    if(Object.values(status.documents||{}).some(doc=>doc.state==='uncertain')){printing='전송 결과 확인';tone='attention';}
    else if(status.externallyPrinted){printing='전산 출력 확인';tone='done';}
    else if(required.length&&!status.requirementPending&&required.every(kind=>status.documents?.[kind]?.state==='sent')){printing='전송 완료';tone='done';}
    else if(status.smartTms||String(order.remark||'').includes('스마트')){printing='자동 출력 생략';tone='neutral';}
    else if(returning){printing='반품 · 해당 없음';tone='neutral';}
    else if(Object.values(status.documents||{}).some(doc=>doc.state==='sending'))printing='프린터 전송 중';
    else if(required.length||status.requirementPending)printing='출력 대기';
    else printing='기록 확인 필요';
  }
  const output=phase('출력',printing,tone);
  progress.replaceChildren(receipt,allocation,output);
  const records=el('div',null,'out-print-records');
  const names={sent:'전송 완료',sending:'전송 중',ready:'전송 대기',uncertain:'결과 확인 필요',missing:'전송 기록 없음'};
  for(const [kind,name]of [['picking','피킹지'],['label','라벨'],['slip','A4 물표']]){
    const state=status?.documents?.[kind]?.state;
    if(!state||state==='missing'&&!required.includes(kind))continue;
    const record=el('span',`${name} · ${names[state]||'확인 필요'}`,'out-print-record');record.dataset.state=state;records.append(record);
  }
  if(records.childElementCount)progress.append(records);
}
function paintDocumentStatuses() {
  for (const article of $('out-list').children) {
    const order = orders.find(o => o.key === article.dataset.key), status = currentStatus(order);
    const history = article.querySelector('.out-history'), last = status?.lastResult;
    history.textContent = last ? `최근 처리 기록${last.at ? ` · ${new Date(last.at).toLocaleString('ko-KR')}` : ''}: ${last.message || labels[last.state] || last.state}` : '';
    history.hidden = !last;
    const note = article.querySelector('.out-hidden-note');
    note.textContent = status?.smartTms ? `스마트오더 · 자동 출력 생략 · ${status.external?.tmsStatus==='8'?'TMS 완료':status.external?.tmsStatus==='1'?'TMS 미전송':status.external?.tmsStatus==='5'?'TMS 진행중 · 재확인 요망':'TMS 상태 재확인 요망'}` : status?.externallyPrinted ? `전산 출력 확인 · ${status.external.tmsStatus==='8'?'TMS 완료':status.external.tmsStatus==='1'?'TMS 미전송':status.external.tmsStatus==='5'?'TMS 진행중 · 재확인 요망':'TMS 상태 미확인'}` : status?.external?.state==='unknown' ? '전산 출력 여부 재확인 요망' : status?.pendingHidden ? '직접 처리 완료로 미처리에서 숨김 · 주문 선택 후 숨김 해제 가능' : '';
    note.hidden = !note.textContent;
    article.dataset.attention = status?.attention ? 'true' : 'false';
    paintOrderProgress(article,order,status);
  }
  for (const button of $('out-result-filters').querySelectorAll('button')) {
    const filter = button.dataset.filter, count = button.querySelector('.out-filter-count');
    button.setAttribute('aria-pressed', String(filter === orderFilter));
    count.hidden = !orders.length || (filter !== 'all' && statusReadState !== 'ready');
    count.textContent = count.hidden ? '' : String(visibleOrders(filter).length);
  }
}
async function refreshDocumentStatuses() {
  const rev = generation, request = ++statusRequest;
  if (!orders.length) return;
  $('out-document-message').textContent = '처리 기록 확인 중…';
  try {
    const result = await api('/api/workflow/status');
    if (rev !== generation || request !== statusRequest) return;
    if (!Array.isArray(result.orders)) throw new Error('문서 상태 응답을 확인할 수 없습니다.');
    documentStatus = new Map(result.orders.map(row => [row.key, row])); statusReadState = 'ready';
    $('out-document-message').textContent = '전산 출력이 확인된 주문은 미처리에서 자동 제외됩니다. 전체 목록에서 확인할 수 있습니다.';
    $('out-document-message').className = 'out-document-note';
  } catch (e) {
    if (rev !== generation || request !== statusRequest) return;
    statusReadState = 'failed';
    $('out-document-message').textContent = `처리 기록 확인 실패: ${e.message} · 상태를 확인할 때까지 미처리·확인 필요에 포함합니다.`;
    $('out-document-message').className = 'error';
  }
  const visibleKeys = visibleOrders().map(o => o.key);
  if (visibleKeys.join('\n') !== [...$('out-list').children].map(a => a.dataset.key).join('\n')) render();
  else { clearHiddenSelections(); paintDocumentStatuses(); selectionStatus(); }
}
function paintResults(results = []) {
  for (const r of results) {
    const order = orders.find(o => o.key === r.key);
    if (order) { order.status = r.status; order.result = r; }
  }
  for (const article of $('out-list').children) {
    const o = orders.find(o => o.key === article.dataset.key); const r = o.result;
    const actions = article.querySelector('.out-pallet-controls');
    article.dataset.pcStatus=o.status;
    article.dataset.state = r?.state || '';
    paintOrderProgress(article,o,currentStatus(o));
    article.querySelector('.out-result').textContent = `전산: ${o.status}` + (['workflow','reset','shipment','delete'].includes(r?.phase) ? ` · ${r.message}` : r ? ` · ${r.phase === 'receipt' ? '접수 단계' : '할당 단계'} · ${labels[r.state] || r.state} · ${r.message || ''}` : o.type === '매출반품' ? ' · 접수만 처리 · 할당·출력 제외' : /반품/.test(o.type) ? ' · 반품은 할당 제외' : '');
    if(results.length)paintOrderDetail(o.key);
    for(const button of article.querySelectorAll('.out-reset,.out-finalize,.out-delete,.out-proof-button'))button.remove();
    if(r?.phase!=='delete'&&['매출출고','타계정출고'].includes(o.type)&&!String(o.remark||'').startsWith('유지기한변경건')){
      const button=el('button',r?.phase==='shipment'?'검수완료 처리 결과 확인':/검수완료|출고완료/.test(o.status)?'검수완료 확인':'검수완료처리','out-finalize');button.type='button';button.disabled=busy||autoActive();
      button.onclick=async()=>{try{const {openShipmentCompletion}=await import('./shipment.js');await openShipmentCompletion(o,async data=>{o.status=data.status;o.result=undefined;render();await refreshDocumentStatuses();message(`${o.customer} · ${data.status} · ${data.quantity}개 전산 처리 완료`);});}catch(e){message(e.message,true);}};actions.append(button);
    }
    const action=(name,recheck)=>{const button=el('button',name,'out-reset');button.type='button';button.disabled=busy||autoActive();button.onclick=()=>void resetOrder(o,recheck);actions.append(button);};
    if(r?.phase==='reset'&&r.resetId){action('예정 복귀 결과 재확인',true);if(o.type!=='매출반품')action('예정 복귀 이어서','continue');}
    else if(['매출출고','타계정출고'].includes(o.type)&&!['delete','reset','shipment'].includes(r?.phase)&&!String(o.remark||'').startsWith('유지기한변경건')&&(['출고접수','접수'].includes(o.status)?r?.state!=='uncertain'&&!(r?.phase==='workflow'&&r.state!=='complete'):o.status==='할당완료'&&!['unallocated','uncertain'].includes(r?.state)))action('예정으로 되돌리기');
    const deleteAction=(text,recheck)=>{const button=el('button',text,'out-delete');button.type='button';button.disabled=busy||autoActive();button.onclick=()=>void deleteOrder(o,recheck);actions.append(button);};
    if(r?.phase==='delete'&&r.resetId){deleteAction('삭제 결과 재확인',true);deleteAction('삭제 이어서','continue');}
    else if(['매출출고','타계정출고'].includes(o.type)&&['출고예정','예정','출고접수','접수','부분할당','할당중','할당완료'].includes(o.status)&&!['shipment','reset'].includes(r?.phase)&&!(r?.phase==='workflow'&&r.state!=='complete')&&!String(o.remark||'').startsWith('유지기한변경건'))deleteAction('삭제하기');
    if(o.proofAvailable===true){
      const button=el('button','인수증 보기','out-proof-button');button.type='button';button.disabled=busy;
      button.onclick=async()=>{const version=generation;try{const {openOrderProof}=await import('./inbound.js');if(version===generation)await openOrderProof({...o,reference:o.orderNo},{prefix:'/api/outbound/',valid:()=>version===generation});}catch(e){if(version===generation)message(e.message,true);}};
      article.insertBefore(button,article.querySelector('.out-detail-content'));
    }
  }
}
async function poll(id, rev, progress = true) {
  while (rev === generation) {
    const job = await api('/api/outbound/jobs/' + encodeURIComponent(id));
    if (progress) { paintResults(job.results); message(job.status || '전산 응답 대기 중'); }
    if (job.state === 'failed') throw new Error(job.error);
    if (job.state === 'complete') return job;
    await new Promise(resolve => setTimeout(resolve, progress ? 1200 : 250));
  }
  throw new Error('연결이 변경됐습니다.');
}
async function deleteOrder(order,recheck=false) {
  if(busy||autoActive())return;
  const steps=/^(출고)?예정$/.test(order.status)?'예정 주문을 전산에서 바로 삭제합니다.':'현재 할당·접수 상태를 해제해 예정으로 돌린 뒤 전산 주문을 삭제합니다.';
  if(recheck!==true&&!window.confirm(`${order.customer} · ${order.orderNo}\n${recheck==='continue'?'확인된 단계는 반복하지 않고 남은 삭제 단계를 진행합니다.':steps}\n이 주문의 모든 상품이 삭제됩니다. 진행할까요?`))return;
  const rev=generation;setBusy(true);
  try{
    let job=await api(recheck?`/api/order-reset/jobs/${encodeURIComponent(order.result.resetId)}/${recheck==='continue'?'continue':'recheck'}`:'/api/order-reset/start-delete',{method:'POST',body:JSON.stringify({key:order.key,requestId:crypto.randomUUID(),confirm:true})});
    while(rev===generation&&['running','checking'].includes(job.state)){
      message(`주문 삭제 · ${job.phase||'결과 확인'} 중…`);await new Promise(r=>setTimeout(r,500));job=await api(`/api/order-reset/jobs/${encodeURIComponent(job.id)}`);
    }
    if(rev!==generation)return;
    if(job.state!=='complete'){
      if(job.state==='uncertain')order.result={state:'uncertain',phase:'delete',resetId:job.id,message:'주문 삭제 결과 확인 필요 · '+(job.error||'전산 상태를 확인해 주세요.')};
      render();throw new Error(job.error||'주문을 삭제하지 못했습니다.');
    }
    orders=orders.filter(o=>o.key!==order.key);selected.delete(order.key);orderDetails.delete(order.key);render();
    const query=await post('query',readFilters()),fresh=await poll(query.id,rev,false);
    orders=fresh.data.orders;orderDetails=cachedBulkDetails(fresh.data);selected.clear();documentStatus.clear();statusReadState='loading';render();await refreshDocumentStatuses();
    message(`${order.customer} · ${order.orderNo} · 전산 삭제 완료`);
  }catch(e){if(rev===generation)message(e.message,true);}finally{if(rev===generation)setBusy(false);}
}
async function resetOrder(order,recheck=false) {
  if(busy||autoActive())return;
  if(recheck==='continue'&&!window.confirm(`${order.customer} · ${order.orderNo}\n전산에서 완료된 취소 단계는 반복하지 않고, 남은 예정 복귀 단계만 진행할까요?`))return;
  const returning=order.type==='매출반품';
  const explanation=returning?'저장상태변경으로 예정 상태로 되돌립니다. 다음 접수는 처음부터 새로 처리합니다.': '할당·피킹·출고수량 확인 → 필요한 할당취소 → TMS취소 → 예정 상태로 되돌립니다.\n이전 출력 기록은 보관하고, 다음 접수·할당·출력은 처음부터 새로 처리합니다.';
  if(!recheck&&!window.confirm(`${order.customer} · ${order.orderNo}\n${explanation} 진행할까요?`))return;
  const rev=generation;setBusy(true);
  try{
    let job=await api(recheck?`/api/order-reset/jobs/${encodeURIComponent(order.result.resetId)}/${recheck==='continue'?'continue':'recheck'}`:'/api/order-reset/start',{method:'POST',body:JSON.stringify({key:order.key,requestId:crypto.randomUUID(),confirm:true})});
    while(rev===generation&&['running','checking'].includes(job.state)){
      message(`예정 복귀 · ${job.phase||'결과 확인'} 중…`);await new Promise(r=>setTimeout(r,500));job=await api(`/api/order-reset/jobs/${encodeURIComponent(job.id)}`);
    }
    if(rev!==generation)return;
    if(job.state!=='complete'){
      if(job.state==='uncertain')order.result={state:'uncertain',phase:'reset',resetId:job.id,message:'예정 복귀 결과 재확인 필요 · '+(job.error||'전산 상태를 확인해 주세요.')};
      render();throw new Error(job.error||'예정 복귀를 완료하지 못했습니다.');
    }
    const query=await post('query',readFilters()),fresh=await poll(query.id,rev,false);
    orders=fresh.data.orders;orderDetails=cachedBulkDetails(fresh.data);selected.clear();documentStatus.clear();statusReadState='loading';render();await refreshDocumentStatuses();
    message(`${order.customer} · 예정 복귀 완료. 수량 수정 후 ${returning?'접수':'접수·할당·출력'}를 새로 진행할 수 있습니다.`);
  }catch(e){if(rev===generation){if(recheck&&order.result?.resetId){order.result={...order.result,state:'uncertain',message:'예정 복귀 확인 필요 · '+e.message.replace('OUTTYPENAME','매출유형').split(/Call log:|cookie:/i)[0].trim().slice(0,240)};render();}message(e.message,true);}}finally{if(rev===generation)setBusy(false);}
}
export function connectOutbound(data) {
  if (!mounted) mount();
  clearTimeout(autoTimer); autoState=null; autoRequest=false;autoSnapshot='';autoJob='';
  generation++;palletMappings=new Map();ownerSelections=[];$('out-owner').value='*';$('out-tms-result').textContent='';$('out-tms-result').hidden=true; orderDetails = new Map(); owners = data.owners; orders = []; selected.clear(); busy = false; orderFilter = 'all'; documentStatus.clear(); statusReadState = 'loading'; $('out-document-message').textContent = ''; $('out-methods').replaceChildren(); $('out-options').open = false;
  const tomorrow = new Date(Date.now() + 86400000);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(tomorrow);
  $('out-from').value = date; $('out-to').value = date; ownerOptions(); render(); message('조건을 선택한 뒤 조회를 눌러 주세요.');updateStickyOffsets();
  void refreshAutomation();
}
export function resetOutbound() { generation++;palletMappings=new Map();ownerSelections=[]; orderDetails = new Map(); clearTimeout(autoTimer);autoState=null;autoSnapshot='';autoJob=''; orders = []; selected.clear(); busy = false; documentStatus.clear(); statusReadState = 'loading'; if (mounted) { render(); $('out-document-message').textContent = ''; $('inventory-view').hidden = false; $('outbound-view').hidden = true; } }
async function pollTms(job,rev){const id=job.id;while(['running','checking'].includes(job.state)){if(rev!==generation)return null;$('out-tms-result').hidden=false;$('out-tms-result').textContent='TMS 조회·전송 중…';await new Promise(r=>setTimeout(r,350));job=await api('/api/tms/jobs/'+id);}return rev===generation?job:null;}
function paintTms(job){
 const groups=new Map();
 for(const r of job.results||[]){const g=groups.get(r.owner)||{name:r.ownerName||owners.find(o=>o.code===r.owner)?.name||r.owner||'선택 화주',success:0,failed:0,check:0};
  if(r.state==='complete')g.success++;else if(r.state==='failed')g.failed++;else if(['uncertain','sending','waiting'].includes(r.state))g.check++;else if(r.state==='skipped'&&r.message?.includes('앞선 전송'))g.failed++;
  groups.set(r.owner,g);
 }
 const lines=[...groups.values()].filter(g=>g.success||g.failed||g.check).sort((a,b)=>a.name.localeCompare(b.name,'ko')).map(g=>`${g.name} : TMS ${[g.success?`${g.success}건 성공`:'',g.failed?`${g.failed}건 실패`:'',g.check?`${g.check}건 재확인 요망`:''].filter(Boolean).join(' / ')}`);
 if(job.error&&(!lines.length||job.queryComplete===false))lines.push(`${job.owners?.length===1?job.owners[0].name:$('out-owner').selectedOptions[0]?.textContent||'선택 화주'} : ${job.queryComplete===false||job.state==='failed'?'조회·처리 실패 · 재확인 요망':'재확인 요망'}`);
 $('out-tms-result').textContent=lines.join('\n')||'TMS 전송 대상 없음';$('out-tms-result').hidden=false;
}
async function restoreTms(){const rev=generation;try{const h=await api('/api/tms/history');if(rev!==generation||busy||!h.jobs?.length)return;const job=h.jobs.find(j=>['running','checking','uncertain'].includes(j.state));if(!job)return;paintTms(job);if(['running','checking'].includes(job.state)){setBusy(true);try{const done=await pollTms(job,rev);if(done)paintTms(done);}finally{if(rev===generation)setBusy(false);}}}catch{/* Normal orders remain available if a prior server lacks the TMS route. */}}
function mount() {
  mounted = true;
  const workspace = $('workspace'); const inventory = el('div'); inventory.id = 'inventory-view';
  while (workspace.firstChild) inventory.append(workspace.firstChild);
  const nav = el('nav', null, 'controller-tabs'); nav.setAttribute('aria-label', '업무 선택');
  const inv = el('button', '재고조회', 'primary'); inv.id = 'tab-inventory'; const out = el('button', '출고조회 · 할당', 'text-button'); out.id = 'tab-outbound'; nav.append(inv, out);
  const section = el('section'); section.id = 'outbound-view'; section.hidden = true;
  section.innerHTML = `<div class="page-heading"><h1>출고조회 · 할당</h1></div>
    <form id="out-filter" class="card out-filters"><div class="out-owner-field"><label>화주<select id="out-owner"></select></label><details id="out-owner-multi"><summary>여러 화주 선택</summary><div id="out-owner-checks"></div></details></div><label class="out-owner-search-field">화주 검색<input id="out-owner-search" type="search" placeholder="화주명 또는 코드"></label><label class="out-from-field">납품 시작일<input id="out-from" type="date" required></label><label class="out-to-field">납품 종료일<input id="out-to" type="date" required></label><label class="out-type-field">매출유형<select id="out-type"><option value="">전체</option><option>매출출고</option><option>매출반품</option><option>타계정출고</option><option>타계정반품</option></select></label><label class="out-customer-field">거래처명<input id="out-customer" type="search" maxlength="100" placeholder="이름 일부로 검색"></label><label class="out-remark-field">비고<input id="out-remark" type="search" maxlength="100" placeholder="예: 마켓뱅"></label><div id="out-filter-actions"><button type="submit" class="primary">조회</button></div></form>
    <p id="out-tms-result" class="out-tms-result" role="status" aria-live="polite" hidden></p>
    <p id="out-message" role="status" aria-live="polite"></p><details id="out-options" class="card out-settings"><summary>옵션세팅</summary><div id="out-methods"></div></details>
    <div id="out-result-filters" class="out-result-filters" role="group" aria-label="주문 처리 상태 필터"><button type="button" data-filter="all" aria-pressed="true">전체<span class="out-filter-count" hidden></span></button><button type="button" data-filter="pending" aria-pressed="false">미처리<span class="out-filter-count" hidden></span></button><button type="button" data-filter="attention" aria-pressed="false">확인 필요<span class="out-filter-count" hidden></span></button></div>
    <p id="out-document-message" class="out-document-note" role="status" aria-live="polite"></p>
    <div class="out-toolbar"><label><input id="out-all" type="checkbox"> 표시된 주문 전체 선택</label><strong id="out-count"></strong><strong id="out-selected-totals" hidden></strong><button id="out-run" class="primary" disabled>접수·할당·출력</button></div><div id="out-list"></div>`;
  workspace.append(nav, inventory, section);
  $('out-owner').onchange=()=>chooseOwners($('out-owner').value==='*'?[]:$('out-owner').value.split(','));
  $('out-filter').addEventListener('input',()=>{invalidateTms();setBusy(busy);});
  $('out-filter').addEventListener('change',()=>{invalidateTms();setBusy(busy);});
  const auto = el('button', '자동화 시작 · 5분', 'text-button');auto.id='out-auto';auto.type='button';auto.onclick=toggleAutomation;
  $('out-filter-actions').append(auto);
  const autoNote=el('p','선택한 조건으로 5분마다 미처리 주문을 접수·할당·출력하고, 켠 날 오후 6시(한국시간)에 자동 종료합니다.','out-auto-note');autoNote.id='out-auto-status';autoNote.setAttribute('role','status');
  $('out-filter').after(autoNote);
  if(typeof ResizeObserver!=='undefined'){const stickyObserver=new ResizeObserver(updateStickyOffsets);stickyObserver.observe(autoNote);stickyObserver.observe(nav);stickyObserver.observe($('out-options').querySelector(':scope > summary'));}
  window.addEventListener('resize',updateStickyOffsets);
  const print = el('button', '출력', 'text-button'); print.id = 'out-print';
  print.onclick = () => oneTouch('print');
  section.querySelector('.out-toolbar').append(print);
  const hide = el('button', '직접 처리 완료 · 미처리 숨김', 'text-button'); hide.id = 'out-hide-pending'; hide.type = 'button';
  hide.onclick = changePendingVisibility;
  section.querySelector('.out-toolbar').append(hide);
  for (const input of section.querySelectorAll('label>input,label>select')) { input.parentElement.htmlFor = input.id; }
  inv.onclick = () => { inventory.hidden = false; section.hidden = true; inv.className = 'primary'; out.className = 'text-button'; };
  out.onclick = () => { inventory.hidden = true; section.hidden = false; inv.className = 'text-button'; out.className = 'primary'; recoverWorkflow(); void refreshAutomation(); if(!busy)void restoreTms(); void loadOrderDetails(); };
  window.addEventListener('stock-outbound-focused',()=>{paintPalletSelections();void loadOrderDetails();});
  $('out-options').addEventListener('toggle', async () => {
    updateStickyOffsets();
    if (!$('out-options').open || $('out-methods').children.length) return;
    const rev = generation; $('out-methods').textContent = '옵션을 불러오는 중…';
    try { const { mountOptions } = await import('./options.js'); await mountOptions($('out-methods'), owners, () => rev === generation); if(rev===generation)setBusy(busy); }
    catch (e) { if (rev === generation) $('out-methods').textContent = e.message; }
  });
  $('out-owner-search').oninput = ownerOptions;
  for (const button of $('out-result-filters').querySelectorAll('button')) button.onclick = () => { if (busy) return; orderFilter = button.dataset.filter; clearHiddenSelections(); render(); };
  $('out-filter').onsubmit = async e => {
    e.preventDefault(); if (busy || autoActive()) return; selected.clear(); orders = []; orderDetails = new Map(); documentStatus.clear(); statusReadState = 'loading'; statusRequest++; render(); setBusy(true); const rev = generation;
    try {
      const { id } = await post('query', readFilters());
      const job = await poll(id, rev); if (rev !== generation) return; orders = job.data.orders; orderDetails=cachedBulkDetails(job.data); render();
      message(`${orders.length}건 조회 · ${new Date(job.data.checkedAt).toLocaleString('ko-KR')} · 출력여부 제한 없음`);
    } catch (error) { message(error.message, true); } finally { if (rev === generation) { setBusy(false); recoverWorkflow(); } }
  };
  $('out-all').onchange = () => { selected = new Set($('out-all').checked ? visibleOrders().filter(o=>!o.processingIssue).map(o => o.key) : []); render(); };
  $('out-run').onclick = () => oneTouch('all');
}

let following = false;
function paintAutomation(state) {
  autoState=state;
  if(autoActive()&&state.filter){
    $('out-owner-search').value='';ownerSelections=state.filter.owner==='*'?[]:String(state.filter.owner||'').split(',');ownerOptions();
    for(const [key,id] of Object.entries({owner:'out-owner',from:'out-from',to:'out-to',type:'out-type',customer:'out-customer',remark:'out-remark'}))$(id).value=state.filter[key]||'';
  }
  const next=state.nextAt ? ` · 다음 조회 ${new Date(state.nextAt).toLocaleTimeString('ko-KR')}` : '';
  const stopAt=state.stopAt && autoActive() ? ` · 종료 ${new Date(state.stopAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'numeric',day:'numeric',hour:'numeric',minute:'2-digit'})} (한국시간)` : '';
  $('out-auto-status').textContent=`${state.enabled?'자동화 켜짐 · 5분 간격':'자동화 중지'} · ${state.message||''}${next}${stopAt}`;
  if(autoActive())$('out-auto-status').textContent+=' · 현재 날짜·검색조건 고정 · 화면을 닫아도 계속 실행';
  if(autoActive()&&state.sort?.length)$('out-auto-status').textContent+=' · 시작 시 정렬 순서로 출력';
  setBusy(busy);
  updateStickyOffsets();
}
async function refreshAutomation() {
  clearTimeout(autoTimer);const rev=generation,version=++autoVersion;
  try {
    const state=await api('/api/automation/status');if(rev!==generation||version!==autoVersion||autoRequest)return;
    const wasActive=autoActive();paintAutomation(state);
    const snapshotVersion=state.snapshot ? `${state.snapshot.checkedAt}:${state.snapshot.revision || 0}` : '';
    if(state.snapshot&&(autoActive()||wasActive)&&snapshotVersion!==autoSnapshot){
      autoSnapshot=snapshotVersion;retainOrderDetails(state.snapshot.orders,state.snapshot.details);orders=state.snapshot.orders;selected.clear();render();await refreshDocumentStatuses();
    }
    if(state.lastJobId&&state.lastJobId!==autoJob){autoJob=state.lastJobId;if(!following&&!busy)void recoverWorkflow();}
  }catch(e){if(rev===generation)$('out-auto-status').textContent=`자동화 상태 확인 실패 · ${e.message}`;}
  finally {if(rev===generation&&version===autoVersion)autoTimer=setTimeout(refreshAutomation,3000);}
}
async function toggleAutomation() {
  if(autoRequest)return;
  const stopping=Boolean(autoState?.enabled);
  if(!stopping&&(busy||autoActive()||!$('out-filter').reportValidity()))return;
  const rev=generation;autoVersion++;clearTimeout(autoTimer);autoRequest=true;setBusy(busy);
  try {
    const sort=document.documentElement.classList.contains('desktop-ui')?JSON.parse($('out-list').dataset.desktopSort||'[]'):[];
    const state=await api('/api/automation/'+(stopping?'stop':'start'),{method:'POST',body:JSON.stringify(stopping?{}:{...readFilters(),sort:sort.length?sort:undefined})});
    if(rev===generation){paintAutomation(state);if(!stopping){orderFilter='pending';selected.clear();render();}}
  }catch(e){if(rev===generation)$('out-auto-status').textContent=e.message;}
  finally {if(rev===generation){autoRequest=false;setBusy(busy);autoTimer=setTimeout(refreshAutomation,1000);}}
}
async function changePendingVisibility() {
  if (busy || !selected.size || statusReadState !== 'ready') return;
  const rev = generation, keys = [...selected];
  const hidden = !keys.every(key => documentStatus.get(key)?.pendingHidden);
  statusRequest++;
  setBusy(true);
  try {
    await api('/api/workflow/pending-visibility', { method: 'POST', body: JSON.stringify({ keys, hidden }) });
    if (rev !== generation) return;
    // Apply the confirmed change immediately; a later status failure must not
    // silently claim a write failed or cause a duplicate workflow submission.
    for (const key of keys) { const status = documentStatus.get(key); if (status) status.pendingHidden = hidden; }
    selected.clear(); render();
    message(hidden ? `${keys.length}건을 미처리 목록에서 숨겼습니다. 전체 목록에서 확인·해제할 수 있습니다.` : `${keys.length}건의 미처리 숨김을 해제했습니다.`);
  } catch (e) { if (rev === generation) message(e.message, true); }
  finally { if (rev === generation) setBusy(false); }
}
function paintWorkflow(job) {
  const rows = job.results.map(r => ({ ...r, phase: 'workflow' }));
  if (!orders.length && job.state === 'running') { orders = rows; render(); }
  paintResults(rows);
  const working = rows.find(r => !['waiting','complete','failed','skipped'].includes(r.state));
  message(job.state === 'running' ? (job.tms?.state==='running'?'출력·접수 완료 · TMS 전송 확인 중…':working ? `${working.customer} · ${working.message}` : '원터치 처리 중…') : `처리 결과: 전송 완료 ${rows.filter(r => r.state === 'complete').length}건 · 제외 ${rows.filter(r => r.state === 'skipped').length}건 · 확인 필요 ${rows.filter(r => r.state === 'failed'||r.tms&&!['complete','skipped'].includes(r.tms.state)).length}건`);
  if(job.tms&&job.state!=='running'){
    const grouped=new Map();for(const r of job.tms.results||[]){const name=r.ownerName||r.owner;if(!grouped.has(name))grouped.set(name,{ok:0,fail:0});const g=grouped.get(name);if(r.state==='complete'||r.state==='skipped'&&r.tmsStatus==='8')g.ok++;else g.fail++;}
    const summary=[...grouped].map(([name,g])=>`${name} : TMS 성공 ${g.ok}건${g.fail?` / 재확인 ${g.fail}건`:''}`).join(' · ')||'TMS 재확인 요망';message($('out-message').textContent+' · '+summary);
  }
  const timings=job.timings||{},parts=Object.entries({receipt:'접수',allocation:'할당',pdfPrepare:'PDF 준비',printerStage:'출력 단계',total:'전체'}).filter(([key])=>Number.isFinite(timings[key])).map(([key,title])=>`${title} ${(timings[key]/1000).toFixed(2)}초`);
  if(!Number.isFinite(timings.receipt)&&!Number.isFinite(timings.allocation)&&Number.isFinite(timings.allocationBatch))parts.unshift(`접수·할당 확인 ${(timings.allocationBatch/1000).toFixed(2)}초`);
  if(parts.length&&job.state!=='running')message($('out-message').textContent+' · 처리 시간: '+parts.join(' / '));
}
async function watchWorkflow(job, rev) {
  const { followWorkflow } = await import('./workflow.js');
  following = true; setBusy(job.state === 'running');
  try { paintWorkflow(job); if (job.state === 'running') await followWorkflow(job.id, paintWorkflow, () => rev === generation); }
  finally { following = false; if (rev === generation) { setBusy(false); await refreshDocumentStatuses(); } }
}
function selectedOrdersInDisplayOrder() {
  const source=$('out-list'),byKey=new Map(visibleOrders().filter(o=>selected.has(o.key)).map(o=>[o.key,o]));
  const table=document.documentElement.classList.contains('desktop-ui')?source.closest('.desktop-list-layout')?.querySelector('.desktop-data-table tbody'):null;
  const rows=[...(table||source).children].map(node=>byKey.get(node.dataset.key)).filter(Boolean);
  if(rows.length!==byKey.size||new Set(rows.map(o=>o.key)).size!==rows.length)throw Error('화면의 주문 순서를 확인하지 못했습니다. 목록을 다시 확인해 주세요.');
  return rows;
}
async function oneTouch(action) {
  if (busy || autoActive() || !selected.size) return;
  const rev = generation; setBusy(true);
  try {
    const rows = selectedOrdersInDisplayOrder();
    const { startWorkflow } = await import('./workflow.js');
    const job = await startWorkflow(rows, action);
    if (job && rev === generation) await watchWorkflow(job, rev);
  } catch (e) { message(e.message + ' 화면을 다시 열면 진행 상태를 자동 확인합니다.', true); }
  finally { if (rev === generation) setBusy(false); }
}
async function recoverWorkflow() {
  if (following || busy) return;
  const rev = generation;
  try {
    const { job } = await api('/api/workflow/active');
    // Completed jobs are history. A fresh WMS query must remain authoritative.
    if (job?.state === 'running' && rev === generation) await watchWorkflow(job, rev);
  }
  catch (e) { if (rev === generation) message(e.message, true); }
  finally { if (rev === generation && !following) await refreshDocumentStatuses(); }
}
