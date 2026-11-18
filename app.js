import { api, compareOrderFields, remoteApi } from './api.js';
import { connectOutbound, resetOutbound } from './outbound.js';
import { connectInbound, resetInbound } from './inbound.js';
import {openExpiryChange} from './expiry-change.js';
const $ = id => document.getElementById(id);
const state = { owners: [], owner: '', data: null, query: '', selected: new Set(), loading: false, revision: 0 };
let intakeModule,stocktakeModule,historyModule;
let pickingCells = new Map();
let readingPicking = false;
const visiblePickingCodes = new Set();
const productPickingLines = new Map();
const pickingObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const code = entry.target.dataset.code;
    if (entry.isIntersecting) visiblePickingCodes.add(code); else visiblePickingCodes.delete(code);
  }
  void loadPickingCells();
}, { root: $('product-list'), rootMargin: '60px 0px' });
const fmt = n => n.toLocaleString('ko-KR', { maximumFractionDigits: 6 });
const stockValue=value=>value==null?'확인 필요':fmt(value);
const stockUnits=value=>value==null?'확인 필요':fmt(value)+'개';
async function openHistory(product){const owner=state.owner,revision=state.revision;try{historyModule??=await import('./inventory-history.js');if(state.owner!==owner||state.revision!==revision)return;historyModule.openInventoryHistory(owner,product,{ownerName:state.data.owner.name,valid:()=>state.owner===owner&&state.revision===revision});}catch(e){showError('load-error',e.message);}}
async function openAdjustment(product,scope){
  const owner=state.owner,revision=state.revision;
  try{const {openStockAdjustment}=await import('./shipment.js');if(state.owner!==owner||state.revision!==revision)return;await openStockAdjustment(owner,product,()=>state.owner===owner?loadOwner(owner,true):undefined,scope);}
  catch(e){showError('load-error',e.message);}
}
async function openInventoryIntake(product,cell,expiry=''){
  const owner=state.owner,revision=state.revision,ownerName=state.data.owner.name;
  try{intakeModule??=await import('./intake.js');if(state.owner!==owner||state.revision!==revision)return;await intakeModule.openIntakeForProduct(owner,product,{ownerName,defaultCell:cell.cell,defaultExpiry:expiry,done:()=>state.owner===owner?loadOwner(owner,true):undefined});}
  catch(e){showError('load-error',e.message);}
}
const normalize = text => text.normalize('NFKC').toLocaleLowerCase('ko').replace(/\s+/g, '');
function element(tag, className, text) { const el = document.createElement(tag); el.className = className; if (text !== undefined) el.textContent = text; return el; }
function showError(id, message) { $(id).textContent = message; $(id).hidden = !message; }
function loginView() {
  historyModule?.closeInventoryHistory();
  $('startup-view').hidden = true;
  intakeModule?.resetIntake();
  stocktakeModule?.resetStocktake();
  resetInbound();
  resetOutbound();
  state.revision++; state.owner = ''; state.data = null; state.query = ''; state.loading = false; state.selected.clear();
  $('workspace').hidden = true; $('login-view').hidden = false; $('logout').hidden = true;
  $('connection').textContent = '전산 연결 전'; $('connection').classList.remove('online');
}
function ownerOptions() {
  const query = normalize($('owner-search').value);
  const matches = state.owners.filter(o => normalize(o.name + o.code).includes(query));
  const select = $('owner-select'); select.replaceChildren(new Option(matches.length ? '화주를 선택해 주세요' : '일치하는 화주가 없습니다', ''));
  for (const owner of matches) select.add(new Option(`${owner.name} (${owner.code})`, owner.code));
  select.value = matches.some(o => o.code === state.owner) ? state.owner : '';
  if (state.owner && !select.value) chooseOwner('');
}
async function connected(data) {
  if(new URLSearchParams(location.search).has('frontend_origin')){const {completeFrontendLogin}=await import('./frontend-login.js');await completeFrontendLogin();return;}
  state.owners = data.owners;
  $('warehouse').textContent = data.warehouse;
  $('login-view').hidden = true; $('logout').hidden = false;
  $('connection').textContent = '전산 연결됨'; $('connection').classList.add('online');
  $('owner-search').value = ''; $('product-search').value = '';
  ownerOptions(); render();
  const preferred = state.owners.find(o => o.code === 'A00124') || state.owners[0];
  if (preferred) { $('owner-select').value = preferred.code; chooseOwner(preferred.code); }
  connectOutbound(data);
  connectInbound(data);
  try{intakeModule??=await import('./intake.js');intakeModule.connectIntake(data);}catch(error){showError('load-error','전산입력 메뉴를 불러오지 못했습니다. 새로고침해 주세요.');}
  try{stocktakeModule??=await import('./stocktake.js');stocktakeModule.connectStocktake(data,{picking:openPicking,movement:openMovement});}catch{showError('load-error','로케이션 실사 메뉴를 불러오지 못했습니다. 새로고침해 주세요.');}
  // Reveal the workspace and apply its layout in the same task, after imports.
  // No frame can paint the original card layout before the PC adapter is ready.
  $('workspace').hidden = false;
  mountDesktopWorkspace();
  $('startup-view').hidden = true;
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); showError('login-error', '');
  $('login-button').disabled = true; $('login-button').textContent = '전산 연결 중…';
  $('login-progress').textContent = '로그인 후 화주 목록을 확인합니다. 잠시 기다려 주세요.';
  try {
    const data = remoteApi ? await (await import('./frontend-login.js')).connectFrontend() : await api('/api/login', { method: 'POST', body: JSON.stringify({ username: $('username').value, password: $('password').value }) });
    $('password').value = ''; await connected(data);
  } catch (error) { showError('login-error', error.message); }
  finally { $('login-button').disabled = false; $('login-button').textContent = '전산 연결하기 ↗'; $('login-progress').textContent = '비밀번호는 서버 파일에 저장하지 않습니다.'; }
});
$('logout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); loginView(); }
  catch (error) { showError('load-error', error.message); }
});
$('owner-search').addEventListener('input', ownerOptions);
$('owner-select').addEventListener('change', () => chooseOwner($('owner-select').value));
$('owner-load').addEventListener('click', () => loadOwner(state.owner, true));
function searchProducts() {
  if (!state.data || state.loading) return;
  state.query = $('product-search').value.trim();
  state.selected.clear();
  render();
}
$('product-search-form').addEventListener('submit', event => { event.preventDefault(); searchProducts(); });
$('product-search-button').addEventListener('click', event => { event.preventDefault(); searchProducts(); });
$('refresh').addEventListener('click', () => loadOwner(state.owner, true));

function chooseOwner(code) {
  historyModule?.closeInventoryHistory();
  pickingCells = new Map();
  state.revision++; state.owner = code; state.data = null; state.query = ''; state.loading = false;
  state.selected.clear(); $('product-search').value = '';
  showError('load-error', ''); render();
}

async function loadOwner(code, refresh = false) {
  pickingCells = new Map();
  const revision = ++state.revision;
  const sameOwner = state.owner === code;
  state.owner = code; state.data = null;
  if (!sameOwner) { state.selected.clear(); $('product-search').value = ''; }
  showError('load-error', ''); state.loading = Boolean(code); render();
  if (!code) return;
  $('loading-status').textContent = '전체 목록과 합계를 확인합니다.';
  try {
    const job = await api('/api/inventory/jobs', { method: 'POST', body: JSON.stringify({ owner: code, refresh }) });
    let data;
    while (revision === state.revision) {
      const result = await api(`/api/inventory/jobs/${encodeURIComponent(job.id)}`);
      if (revision !== state.revision) return;
      if (result.state === 'complete') { data = result.data; break; }
      $('loading-status').textContent = result.status;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    if (revision !== state.revision) return;
    state.data = data;
    state.selected = new Set([...state.selected].filter(code => data.products.some(p => p.code === code)));
  } catch (error) {
    if (revision !== state.revision) return;
    if (error.status === 401) showError('load-error', '연결이 만료됐습니다. 위 연결 상태의 재로그인하기를 눌러 주세요.');
    else showError('load-error', error.message);
  } finally { if (revision === state.revision) { state.loading = false; render(); } }
}
function visibleProducts() {
  const q = normalize(state.query);
  return (state.data?.products || []).filter(p => normalize(p.name + p.code).includes(q));
}
function renderProducts() {
  const visible = visibleProducts();
  pickingObserver.disconnect(); visiblePickingCodes.clear(); productPickingLines.clear();
  $('product-list').replaceChildren();
  $('selection-tools').hidden = state.loading || !visible.length;
  $('visible-count').textContent = `${fmt(visible.length)}개 상품`;
  const checked = visible.filter(p => state.selected.has(p.code)).length;
  $('select-all').checked = Boolean(visible.length) && checked === visible.length;
  $('select-all').indeterminate = checked > 0 && checked < visible.length;
  for (const product of visible) {
    const row = element('div', `product-row${state.selected.has(product.code) ? ' checked' : ''}`);
    row.dataset.code = product.code;
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = state.selected.has(product.code);
    checkbox.id = `stock-product-${product.code}`;
    checkbox.setAttribute('aria-label', `${product.name} (${product.code}) 선택`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.selected.add(product.code); else state.selected.delete(product.code);
      row.classList.toggle('checked', checkbox.checked);
      const visible = visibleProducts();
      const count = visible.filter(p => state.selected.has(p.code)).length;
      $('select-all').checked = count === visible.length;
      $('select-all').indeterminate = count > 0 && count < visible.length;
      renderSelection();
    });
    const content = element('div', 'product-content');
    const name = element('label', 'product-name', product.name); name.htmlFor = checkbox.id; content.append(name);
    const pickingLine = element('div', 'product-picking');
    const pickingValue = element('span', 'product-picking-value');
    const retry = element('button', 'text-button', '다시 조회'); retry.type = 'button'; retry.hidden = true;
    retry.addEventListener('click', () => { pickingCells.delete(product.code); refreshProductPicking(product.code); visiblePickingCodes.add(product.code); void loadPickingCells(); });
    const change = element('button', 'picking-button', '피킹셀 변경'); change.type = 'button';
    change.setAttribute('aria-label', product.name + ' 피킹셀 변경');
    change.addEventListener('click', () => openPicking(product));
    const adjust = element('button', 'picking-button', '전산처리하기');adjust.type='button';adjust.setAttribute('aria-label',product.name+' 전산처리하기');
    adjust.disabled=!product.packSize;adjust.addEventListener('click',()=>void openAdjustment(product));
    const history=element('button','picking-button','히스토리조회');history.type='button';history.setAttribute('aria-label',product.name+' 히스토리조회');history.addEventListener('click',()=>void openHistory(product));
    pickingLine.append(pickingValue, retry, change, adjust, history); content.append(pickingLine);
    productPickingLines.set(product.code, { value:pickingValue, retry }); updateProductPicking(product.code);
    const quantity = element('div', 'pack-total'); quantity.append(element('span', '', '총수량 '), element('strong', '', fmt(product.quantity)));
    quantity.append(element('span', 'pack-total-detail', product.packSize ? `본입수 ${fmt(product.packSize)} · ${fmt(product.boxes)}박스 + 낱개 ${fmt(product.loose)}` : '본입수 · 박스수 · 낱병수 확인 필요'));
    quantity.append(element('span','pack-total-available',`가용 ${stockUnits(product.available)}`+(product.packSize&&product.availableBoxes!=null?` · ${fmt(product.availableBoxes)}박스 + 낱개 ${fmt(product.availableLoose)}`:'')));
    content.append(quantity);
    row.append(checkbox, content);
    for (const [name, value,available] of [['본입수',product.packSize],['박스 / 낱개',product.packSize?`${fmt(product.boxes)} / ${fmt(product.loose)}`:null,product.packSize?`${stockValue(product.availableBoxes)} / ${stockValue(product.availableLoose)}`:'확인 필요'],['총수량',product.quantity,stockValue(product.available)]]) {
      const metric=element('span','desktop-product-metric',value==null?'확인 필요':typeof value==='number'?fmt(value):value);
      if(available!==undefined)metric.append(element('small','inventory-available','가용 '+available));
      metric.setAttribute('aria-label',name+' '+metric.textContent);row.append(metric);
    }
    $('product-list').append(row);
    row.addEventListener('click', event => { if (!event.target.closest('button,input,label')) checkbox.click(); });
    pickingObserver.observe(row);
  }
  $('empty').hidden = state.loading || visible.length > 0;
  $('empty-title').textContent = state.data ? (state.data.products.length ? '검색 결과가 없습니다' : '현재 재고가 없습니다') : state.owner ? '재고 목록을 불러와 주세요' : '어느 화주의 재고를 찾으세요?';
  $('empty-message').textContent = state.data ? '재고가 있는 상품만 표시됩니다. 다른 상품명이나 코드를 검색해 보세요.' : state.owner ? '화주 선택 아래의 조회 버튼을 눌러 주세요.' : '화주를 선택한 후 조회 버튼을 눌러 주세요.';
}
function renderSelection() {
  $('selected-count').textContent = `${state.selected.size}개 선택`;
  $('clear-selection').disabled = !state.selected.size || state.loading;
  renderResults();
}
function updateProductPicking(code) {
  const line = productPickingLines.get(code); if (!line) return;
  const info = pickingCells.get(code);
  line.value.replaceChildren(element('span', '', '피킹셀 '), element('strong', '', info?.data ? info.data.cell : info?.error ? '조회 실패' : '조회 중…'));
  line.value.title = info?.error || info?.data?.label || '';
  line.retry.hidden = !info?.error;
}
function refreshProductPicking(code){updateProductPicking(code);if(state.selected.has(code))renderResults();}
function renderResults() {
  const products = state.data?.products.filter(p => state.selected.has(p.code)) || [];
  $('results').replaceChildren(); $('results-placeholder').hidden = products.length > 0;
  $('result-note').hidden = !products.length;
  for (const product of products) {
    const card = element('article', 'result-card');
    const top = element('div', 'result-top'); top.append(element('h3', '', product.name), element('div', 'product-code', product.code));
    const history=element('button','picking-button stock-history-button','히스토리조회');history.type='button';history.addEventListener('click',()=>void openHistory(product));top.append(history);
    const total = element('div', 'total-line'); total.append(element('span', '', '재고 합계'), element('strong', '', stockUnits(product.quantity))); top.append(total); card.append(top);
    const metrics = element('div', 'pack-metrics');
    for (const [label, value] of [['본입수',product.packSize], ['박스수',product.boxes], ['낱개수',product.loose]]) metrics.append(element('span', '', `${label} ${stockValue(value)}`));
    top.append(metrics);
    top.append(element('p','inventory-available-summary',`가용 ${stockUnits(product.available)}`+(product.packSize&&product.availableBoxes!=null?` · ${fmt(product.availableBoxes)}박스 + 낱개 ${fmt(product.availableLoose)}`:'')));
    const head = element('div', 'cell-head'); head.append(element('span', '', '보관셀 · 유지기한')); card.append(head);
    const pickingCell=pickingCells.get(product.code)?.data?.cell;
    const cells=[...product.cells].sort((a,b)=>Number(b.cell===pickingCell)-Number(a.cell===pickingCell)||a.cell.localeCompare(b.cell,'ko',{numeric:true}));
    for (const cell of cells) {
      const isPicking=cell.cell===pickingCell,cellTitle=(isPicking?'피킹셀 ':'보관셀 ')+cell.cell;
      const groupCard=element('section','cell-group'+(isPicking?' is-picking-cell':''));groupCard.setAttribute('aria-label',cellTitle+' 재고');groupCard.dataset.cell=cell.cell;
      const line = element('div', 'cell-line');
      const amount = element('div', 'cell-amount'),total=element('div','cell-group-total');total.append(element('strong','',fmt(cell.quantity)+'개'),element('small','inventory-available','가용 '+stockUnits(cell.available)));amount.append(total);
      const move = element('button', 'move-button', '보관셀이동'); move.type = 'button';
      move.disabled = cell.quantity <= 0 || !product.packSize || !/^(?:\d{7,12}|DAMAGE)$/.test(cell.cell);
      move.setAttribute('aria-label', product.name + ' ' + cell.cell + ' 보관셀 이동');
      move.addEventListener('click', () => openMovement(product, cell));
      const intake=element('button','move-button','입고처리');intake.type='button';intake.disabled=!product.packSize||!/^\d{7,12}$/.test(cell.cell);intake.setAttribute('aria-label',product.name+' '+cell.cell+' 입고처리');intake.addEventListener('click',()=>void openInventoryIntake(product,cell));
      const actions=element('div','cell-action-buttons');actions.append(move,intake);
      const label=element('div','cell-group-label');label.append(element('strong','',cellTitle),element('small','',product.packSize?`${fmt(Math.floor(cell.quantity/product.packSize))}박스 · 낱개 ${fmt(cell.quantity%product.packSize)}`:'본입수 확인 필요'));amount.append(actions); line.append(label, amount);groupCard.append(line);
      for(const group of cell.expiries||[]){
        const row=element('div','expiry-line'),description=element('div','expiry-description');description.append(element('span','',group.expiry||'유지기한 없음'),element('small','',`${stockValue(group.boxes)}박스 · 낱개 ${stockValue(group.loose)}`));
        const count=element('div','expiry-stock-count'),buttons=element('div','expiry-row-buttons'),change=element('button','move-button','유지기한변경'),move=element('button','move-button expiry-move-button','보관셀이동'),adjust=element('button','move-button expiry-adjust-button','전산처리하기');
        change.type=move.type=adjust.type='button';change.disabled=move.disabled=adjust.disabled=group.quantity<=0||!product.packSize||!/^(?:\d{7,12}|DAMAGE)$/.test(cell.cell);
        move.setAttribute('aria-label',product.name+' '+cell.cell+' '+(group.expiry||'유지기한 없음')+' 보관셀 이동');move.addEventListener('click',()=>openMovement(product,{...cell,quantity:group.quantity},{expiry:group.expiry}));
        adjust.setAttribute('aria-label',product.name+' '+cell.cell+' '+(group.expiry||'유지기한 없음')+' 전산처리하기');adjust.addEventListener('click',()=>void openAdjustment({...product,quantity:group.quantity},{cell:cell.cell,oldExpiry:group.expiry}));
        const intake=element('button','move-button expiry-intake-button','입고처리');intake.type='button';intake.disabled=!product.packSize||!/^\d{7,12}$/.test(cell.cell);intake.setAttribute('aria-label',product.name+' '+cell.cell+' '+(group.expiry||'유지기한 없음')+' 입고처리');intake.addEventListener('click',()=>void openInventoryIntake(product,cell,group.expiry));
        change.addEventListener('click',()=>openExpiryChange(state.owner,product,cell,group,()=>loadOwner(state.owner,true)));count.append(element('strong','',fmt(group.quantity)+'개'),element('small','inventory-available','가용 '+stockUnits(group.available)));buttons.append(move,change,adjust,intake);row.append(description,count,buttons);groupCard.append(row);
      }
      card.append(groupCard);
    }
    $('results').append(card);
  }
}
async function loadPickingCells() {
  if (readingPicking || state.loading) return;
  const product = visibleProducts().find(p => visiblePickingCodes.has(p.code) && !pickingCells.has(p.code));
  if (!product) return;
  readingPicking = true;
  const cache = pickingCells, owner = state.owner;
  const entry = {}; cache.set(product.code, entry);
  try {
    const job = await api('/api/picking/read', { method: 'POST', body: JSON.stringify({ owner, code: product.code }) });
    for (;;) {
      const result = await api('/api/picking/reads/' + encodeURIComponent(job.id));
      if (result.state === 'failed') throw new Error(result.error);
      if (result.state === 'complete') { entry.data = result.data; break; }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) { entry.error = error.message; }
  finally {
    readingPicking = false;
    if (cache === pickingCells) refreshProductPicking(product.code);
    void loadPickingCells();
  }
}
function render() {
  $('loading').hidden = !state.loading;
  $('product-search').disabled = !state.data || state.loading;
  $('product-search-button').disabled = !state.data || state.loading;
  $('owner-load').disabled = !state.owner || state.loading;
  $('owner-load').textContent = state.loading ? '조회 중…' : '조회';
  $('refresh').disabled = !state.data || state.loading;
  $('catalog-summary').textContent = state.loading ? '재고를 불러오는 중…' : state.data ? `${state.data.owner.name} · ${state.query ? `“${state.query}” 검색 결과 ${fmt(visibleProducts().length)}` : `재고 보유 ${fmt(state.data.products.length)}`}개 상품` : state.owner ? '조회 버튼을 눌러 재고를 불러오세요' : '화주를 선택해 주세요';
  $('checked-at').textContent = state.data?.movementStale ? '이동 전 재고 · 재조회 필요' : state.data ? `전산 조회 ${new Date(state.data.checkedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })} · 한국 시간` : '조회 시각이 여기에 표시됩니다.';
  renderProducts(); renderSelection();
}
$('select-all').addEventListener('change', () => { for (const product of visibleProducts()) { if ($('select-all').checked) state.selected.add(product.code); else state.selected.delete(product.code); } renderProducts(); renderSelection(); });
$('clear-selection').addEventListener('click', () => { state.selected.clear(); renderProducts(); renderSelection(); });
let picking = null;
function openPicking(product,context={}) {
  if($('picking-dialog').open)return;
  picking = { owner: context.owner||state.owner, code: product.code, ready: false, busy: false,done:context.done };
  $('picking-product').textContent = `${context.ownerName||state.data.owner.name} · ${product.name} (${product.code})`;
  $('picking-cell').value = ''; $('picking-cell').disabled = false;
  $('picking-preview').hidden = false; $('picking-preview').textContent = `현재 피킹셀: ${context.pickingCell??pickingCells.get(product.code)?.data?.cell ?? '확인 중'}`; $('picking-status').textContent = '';
  showError('picking-error', ''); $('picking-submit').hidden = false; $('picking-submit').disabled = false;
  $('picking-submit').textContent = '저장'; $('picking-close').disabled = false;
  $('picking-recheck').hidden = true;
  $('picking-dialog').showModal(); $('picking-cell').focus();
  return new Promise(resolve=>$('picking-dialog').addEventListener('close',resolve,{once:true}));
}
$('picking-close').addEventListener('click', () => { if (!picking?.busy) $('picking-dialog').close(); });
$('picking-dialog').addEventListener('cancel', event => { if (picking?.busy) event.preventDefault(); });
$('picking-cell').addEventListener('input', () => {
  if (!picking) return;
  picking.ready = false; $('picking-preview').hidden = true; $('picking-submit').textContent = '저장';
});
async function pollPicking(id) {
  for (;;) {
    const result = await api(`/api/picking/jobs/${encodeURIComponent(id)}`);
    if (result.state === 'failed') throw new Error(result.error);
    if (result.state === 'ready' || result.state === 'complete') return result;
    $('picking-status').textContent = result.status;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
const pickingRecheck = element('button', 'text-button', '이전 저장 결과 재확인');
pickingRecheck.id = 'picking-recheck'; pickingRecheck.type = 'button'; pickingRecheck.hidden = true;
$('picking-form').append(pickingRecheck);
pickingRecheck.addEventListener('click', async () => {
  if (!picking || picking.busy) return;
  picking.busy = true; pickingRecheck.disabled = true; $('picking-close').disabled = true; $('picking-submit').disabled = true;
  showError('picking-error', ''); $('picking-status').textContent = '전산의 현재 피킹셀을 재확인합니다…';
  try {
    const job = await api('/api/picking/recheck', { method: 'POST', body: JSON.stringify({ owner: picking.owner, code: picking.code }) });
    const result = await pollPicking(job.id);
    $('picking-status').textContent = '저장 확인 완료 · 피킹셀 ' + result.data.cell + ' (' + result.data.target + ')';
    $('picking-submit').hidden = true; pickingRecheck.hidden = true;
    if (state.owner === picking.owner) { pickingCells.set(picking.code, { data: { cell: result.data.cell, label: result.data.target } }); refreshProductPicking(picking.code); }
    await picking.done?.(result.data);
  } catch (error) { showError('picking-error', error.message); $('picking-status').textContent = ''; }
  finally { picking.busy = false; pickingRecheck.disabled = false; $('picking-close').disabled = false; $('picking-submit').disabled = false; }
});
$('picking-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!picking || picking.busy || $('picking-submit').hidden) return;
  let saving = false;
  picking.busy = true; $('picking-submit').disabled = true; $('picking-close').disabled = true; $('picking-cell').disabled = true;
  showError('picking-error', ''); $('picking-status').textContent = '상품과 셀 확인 후 저장합니다…';
  const cache = pickingCells;
  try {
    const job = await api('/api/picking/preview', { method: 'POST', body: JSON.stringify({ owner: picking.owner, code: picking.code, cell: $('picking-cell').value.trim() }) });
    picking.id = job.id;
    await pollPicking(job.id);
    saving = true;
    await api('/api/picking/save', { method: 'POST', body: JSON.stringify({ id: job.id }) });
    const result = await pollPicking(job.id);
    $('picking-status').textContent = '저장 완료 · 피킹셀 ' + result.data.cell + ' (' + result.data.target + ')';
    $('picking-submit').hidden = true;
    if(state.owner===picking.owner){cache.set(picking.code, { data: { cell: result.data.cell, label: result.data.target } });if (cache === pickingCells) refreshProductPicking(picking.code);}
    await picking.done?.(result.data);
  } catch (error) {
    showError('picking-error', saving && !/전산.*확인/.test(error.message) ? error.message + ' 저장 여부는 전산에서 확인해 주세요.' : error.message);
    pickingRecheck.hidden = !(saving || /이전 저장 결과|중복 저장/.test(error.message));
    $('picking-status').textContent = '';
    if (saving) {
      $('picking-submit').hidden = true;
      if(state.owner===picking.owner){cache.set(picking.code, { error: '저장 결과 확인 필요 · 다시 조회해 주세요.' });if (cache === pickingCells) refreshProductPicking(picking.code);}
    }
  } finally {
    picking.busy = false; $('picking-close').disabled = false; $('picking-submit').disabled = false;
    $('picking-cell').disabled = saving;
  }
});
let movement = null;
async function refreshAfterMovement(complete) {
  if (state.owner === movement.owner && state.data) {
    state.data.movementStale = true;
    $('checked-at').textContent = '이동 전 재고 · 재조회 필요';
  }
  if (!complete) return;
  const owner = movement.owner;
  $('move-dialog').close();
  if(movement.done)await movement.done();else if (state.owner === owner) await loadOwner(owner, true);
}
function openMovement(product, cell,context={}) {
  if($('move-dialog').open)return;
  const scoped=Object.hasOwn(context,'expiry');
  movement = { owner: context.owner||state.owner, code: product.code, source: cell.cell, packSize:product.packSize, busy: false, phase: 'draft',done:context.done,...(scoped?{expiry:context.expiry}: {}) };
  $('move-title').textContent=scoped?'보관셀 이동 · 유지기한 지정':'보관셀 이동';
  $('move-product').textContent = (context.ownerName||state.data.owner.name) + ' · ' + product.name + ' (' + product.code + ')'+(context.scopeLabel?'\n'+context.scopeLabel:'');
  $('move-source').replaceChildren();for(const [label,value]of[['출발 보관셀',cell.cell],['본입수',fmt(product.packSize)],['박스수',fmt(Math.floor(cell.quantity/product.packSize))],['낱본수',fmt(cell.quantity%product.packSize)]]){const item=element('div','move-source-item');item.append(element('span','',label),element('strong','',value));$('move-source').append(item);}$('move-source').append(element('p','move-source-total','조회 재고 · 총 '+fmt(cell.quantity)+'개'));
  if(scoped){const selected=element('div','move-source-item move-source-expiry');selected.append(element('span','','선택 유지기한'),element('strong','',context.expiry||'유지기한 없음'));$('move-source').append(selected);}
  if($('move-policy'))$('move-policy').textContent=scoped?'선택한 유지기한의 재고만 이동합니다. 같은 기한 안에서는 입고일이 오래된 순서로 배분합니다.':'유통기한이 빠른 재고부터 이동합니다. 기한이 같거나 없으면 입고일이 오래된 순서로 배분하며, 기한 없는 재고는 마지막에 이동합니다.';
  const available=element('p','stock-availability','이동가능수량 · 전산 조회 중…');available.id='move-available';available.setAttribute('role','status');
  const all=element('button','stock-fill-all','전량 이동');all.id='move-all';all.type='button';all.disabled=true;const availabilityRow=element('div','stock-availability-row');availabilityRow.append(available,all);$('move-source').append(availabilityRow);
  all.onclick=()=>{if(movement!==current||current.busy||current.phase==='done'||!Number.isFinite(current.available)||current.available<=0)return;$('move-boxes').value=String(Math.floor(current.available/current.packSize));$('move-each').value=String(Math.round(current.available%current.packSize*1e6)/1e6);invalidateMovement();updateMovementTotal();};
  const current=movement;
  void api('/api/stock-availability?'+new URLSearchParams({mode:'move',owner:current.owner,code:current.code,cell:current.source,...(scoped?{expiry:current.expiry}: {})})).then(data=>{
    if(movement!==current||!$('move-dialog').open)return;if(!Number.isFinite(data.available)||data.available<0)throw Error('이동가능수량 확인 필요');current.available=data.available;
    if(scoped&&data.expiry!==current.expiry){current.available=undefined;throw Error('선택 유지기한 확인 필요');}
    available.textContent=`이동가능수량 · ${fmt(data.available)}개 (${fmt(Math.floor(data.available/product.packSize))}박스 + 낱개 ${fmt(Math.round(data.available%product.packSize*1e6)/1e6)})`;if(data.reason)available.textContent+='\n'+data.reason;available.dataset.state='ready';all.disabled=current.busy||current.phase==='done'||data.available<=0;
  }).catch(()=>{if(movement===current&&$('move-dialog').open){available.textContent='이동가능수량 · 확인 필요 · 실행 전 전산에서 다시 확인합니다.';available.dataset.state='error';}});
  $('move-target').value = ''; $('move-boxes').value = $('move-each').value = '0';updateMovementTotal();
  $('move-preview').replaceChildren(); $('move-preview').hidden = true;
  $('move-status').textContent = ''; showError('move-error', '');
  $('move-close').textContent = '닫기';
  $('move-submit').hidden = false; $('move-submit').textContent = '이동';
  for (const id of ['move-target', 'move-boxes','move-each', 'move-submit', 'move-close']) $(id).disabled = false;
  $('move-dialog').showModal(); $('move-target').focus();
  return new Promise(resolve=>$('move-dialog').addEventListener('close',resolve,{once:true}));
}
function movementQuantity(){const boxes=Number($('move-boxes').value),each=Number($('move-each').value);if(!Number.isSafeInteger(boxes)||boxes<0||!Number.isFinite(each)||each<0||!Number.isSafeInteger(movement?.packSize)||movement.packSize<=0||Math.abs(each*1e6-Math.round(each*1e6))>1e-6)throw Error('박스수는 0 이상의 정수, 낱개수는 0 이상의 수량으로 입력해 주세요.');const total=Math.round((boxes*movement.packSize+each)*1e6)/1e6;if(!Number.isFinite(total)||total>Number.MAX_SAFE_INTEGER)throw Error('이동 수량 범위를 확인해 주세요.');return total;}
function updateMovementTotal(){try{const total=movementQuantity();$('move-total').textContent=`본입수 ${fmt(movement.packSize)} · 이동 합계 ${fmt(Number($('move-boxes').value))}박스 + 낱개 ${fmt(Number($('move-each').value))} · 총 ${fmt(total)}개`;}catch(e){$('move-total').textContent=e.message;}}
function invalidateMovement() {
  if (!movement || movement.busy || movement.phase === 'done') return;
  movement.phase = 'draft'; $('move-preview').hidden = true;
  $('move-submit').textContent = '이동';
}
$('move-target').addEventListener('input', invalidateMovement);
for(const id of ['move-boxes','move-each'])$(id).addEventListener('input',()=>{invalidateMovement();updateMovementTotal();});
$('move-close').addEventListener('click', () => { if (!movement?.busy) $('move-dialog').close(); });
$('move-recheck').addEventListener('click', async () => {
  if (!movement || movement.busy) return;
  movement.busy = true;
  for (const id of ['move-target', 'move-boxes','move-each', 'move-submit', 'move-close', 'move-recheck','move-all']) $(id).disabled = true;
  showError('move-error', '');
  $('move-status').textContent = '재고를 다시 읽어 이전 이동 결과를 확인합니다. 이동을 다시 실행하지 않습니다.';
  try {
    const job = await api('/api/movement/recheck', { method: 'POST', body: JSON.stringify({ owner: movement.owner, code: movement.code }) });
    const result = await pollMovement(job.id);
    movement.phase = 'done'; $('move-submit').hidden = true;
    const data = result.data;
    const panel = $('move-preview'); panel.replaceChildren(); panel.hidden = false;
    panel.append(element('p', '', data.source + ' → ' + data.target + ' · ' + fmt(data.quantity) + '개'));
    for (const row of data.results || []) panel.append(element('p', '', '로트 ' + row.lot + ': ' + (row.verified ? fmt(row.quantity) + '개 이동 확인' : '수량 대조 불일치')));
    $('move-status').textContent = result.state === 'complete' ? '이동 완료 확인 · 재실행하지 않았습니다.' : '이동 결과 확인 필요 · 중복 실행하지 마세요.';
    if (result.state !== 'complete') showError('move-error', result.error || '현재 재고가 이동 계획과 일치하지 않아 자동 확정하지 않았습니다.');
    await refreshAfterMovement(result.state === 'complete');
  } catch (error) { showError('move-error', error.message); $('move-status').textContent = ''; }
  finally {
    movement.busy = false;
    for (const id of ['move-close', 'move-recheck']) $(id).disabled = false;
    for (const id of ['move-target', 'move-boxes','move-each', 'move-submit']) $(id).disabled = movement.phase === 'done';
    $('move-all').disabled=movement.phase==='done'||!(movement.available>0);
  }
});
$('move-dialog').addEventListener('cancel', event => { if (movement?.busy) event.preventDefault(); });
async function pollMovement(id) {
  for (;;) {
    const result = await api('/api/movement/jobs/' + encodeURIComponent(id));
    if (result.state === 'failed') {
      const error = new Error(result.error);
      error.beforeMovement = true;
      throw error;
    }
    if (['ready', 'complete', 'uncertain'].includes(result.state)) return result;
    $('move-status').textContent = result.status || '전산에서 확인 중…';
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
$('move-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (!movement || movement.busy || movement.phase === 'done') return;
  let executing = false;
  movement.busy = true;
  for (const id of ['move-target', 'move-boxes','move-each', 'move-submit', 'move-close', 'move-recheck','move-all']) $(id).disabled = true;
  showError('move-error', ''); $('move-status').textContent = Object.hasOwn(movement,'expiry')?'선택 유지기한의 이동가능수량 확인 후 이동합니다…':'유통기한·입고일순 이동가능수량 확인 후 이동합니다…';
  try {
    const quantity=movementQuantity();if(quantity<=0)throw Error('이동할 박스수 또는 낱개수를 입력해 주세요.');
    const scoped=Object.hasOwn(movement,'expiry');
    const payload = { owner: movement.owner, code: movement.code, source: movement.source, target: $('move-target').value.trim(), quantity,...(scoped?{expiry:movement.expiry}: {}) };
    const job = await api('/api/movement/preview', { method: 'POST', body: JSON.stringify(payload) });
    movement.id = job.id;
    const prepared = await pollMovement(job.id);
    if (prepared.state !== 'ready') throw new Error('이동 준비 결과를 확인하지 못했습니다.');
    if(scoped&&(prepared.data?.expiry!==movement.expiry||!prepared.data.allocations?.length||prepared.data.allocations.some(a=>a.expiry!==movement.expiry)))throw Error('선택한 유지기한의 이동 준비 결과가 다릅니다. 재고를 다시 조회해 주세요.');
    executing = true;
    $('move-status').textContent = '보관셀 이동 실행 중…';
    await api('/api/movement/execute', { method: 'POST', body: JSON.stringify({ id: job.id }) });
    const result = await pollMovement(job.id);
    movement.phase = 'done'; $('move-submit').hidden = true;
    $('move-status').textContent = result.state === 'complete' ? '이동 완료 · ' + fmt(result.data.quantity) + '개' : '이동 결과 확인 필요 · 중복 실행하지 마세요.';
    if (result.state === 'uncertain') {
      showError('move-error', result.data?.error || result.error || '일부 로트의 이동 결과가 계획과 다릅니다. 전산에서 확인해 주세요.');
      $('move-preview').hidden = false;
      for (const r of result.data?.results || []) $('move-preview').append(element('p', '', '로트 ' + r.lot + ': ' + (r.verified ? fmt(r.quantity) + '개 이동 확인' : '확인 필요')));
    }
    await refreshAfterMovement(result.state === 'complete');
  } catch (error) {
    const detail = /locator\.|Call log:|parseSelector|Timeout\s*\d+/i.test(error.message)
      ? '전산 입력 화면을 처리하지 못했습니다.' : error.message;
    showError('move-error', detail + (executing ? (error.beforeMovement ? ' 실행 전에 중단되어 재고 이동을 요청하지 않았습니다. 닫고 다시 시작해 주세요.' : ' 중복 실행하지 말고 전산에서 이동 여부를 확인해 주세요.') : ''));
    $('move-status').textContent = '';
    if (executing) { movement.phase = 'done'; $('move-submit').hidden = true; }
  } finally {
    movement.busy = false; $('move-close').disabled = false; $('move-submit').disabled = false; $('move-recheck').disabled = false;
    for(const id of ['move-target','move-boxes','move-each'])$(id).disabled = movement.phase === 'done';
    $('move-all').disabled=movement.phase==='done'||!(movement.available>0);
  }
});
// Desktop presentation shares the original forms, controls and lock state.
// It never creates a second write action or makes a network request.
function mountDesktopWorkspace() {
  if (mountDesktopWorkspace.mounted) { const nav=document.querySelector('.controller-tabs');if(nav)nav.dataset.warehouse=$('warehouse').textContent;return; }
  if (!window.matchMedia) return;
  mountDesktopWorkspace.mounted=true;
  const media=window.matchMedia('(min-width: 1100px)'),workspace=$('workspace'),adapters=[];
  const create=(tag,cls,text)=>element(tag,cls,text);
  const configs=[
    {id:'out-list',title:'주문 목록',detail:'선택 주문 상세',sortLimit:2,select:'.out-order-heading input[type=checkbox]',columns:[['title','거래처 / 주문번호'],['owner','화주'],['date','납품일'],['type','매출유형'],['dispatch','예상배차'],['boxes','박스'],['quantity','수량'],['status','전산 상태']]},
    {id:'in-list',title:'입고 목록',detail:'선택 입고 상세',select:'.in-purchase-select',columns:[['title','거래처 / 관리번호'],['owner','화주'],['date','입고예정일'],['dispatch','배차'],['quantity','지시수량'],['remaining','남은 수량'],['status','전산 상태']]},
    {id:'intake-list',title:'상품 목록',detail:'선택 상품 · 전산입고',columns:[['title','상품명'],['pack','본입수'],['boxes','박스'],['quantity','현재 수량'],['status','처리 상태']]}
  ];
  function setText(node,text){const value=String(text??'');if(node.textContent!==value)node.textContent=value;}
  function setData(node,name,value){const text=String(value);if(node.dataset[name]!==text)node.dataset[name]=text;}
  function adapter(config) {
    const source=$(config.id);if(!source||source.dataset.desktopBound)return;
    source.dataset.desktopBound='true';
    const layout=create('div','desktop-list-layout'),panel=create('section','desktop-table-panel'),label=create('div','desktop-table-heading',config.title),scroll=create('div','desktop-table-scroll'),table=create('table','desktop-data-table'),head=create('thead'),header=create('tr'),body=create('tbody'),pane=create('aside','desktop-detail-pane'),heading=create('div','desktop-detail-heading',config.detail),empty=create('p','desktop-detail-empty','조회한 목록에서 항목을 선택해 주세요.');
    pane.setAttribute('aria-label',config.detail);table.setAttribute('aria-label',config.title);
    panel.append(label,scroll);scroll.append(table);table.append(head,body);head.append(header);
    if(config.select){const th=create('th','desktop-check-column');th.textContent='선택';header.append(th);}
    let current='',sort=[],scheduled=false,enabled=false,records=new Map(),rows=new Map(),notifiedArticle;
    const headingCount=create('span','',config.title);label.replaceChildren(headingCount);
    let resetSort;
    if(config.sortLimit===2){
      const tools=create('div','desktop-sort-tools'),hint=create('span','desktop-sort-hint','열 제목 클릭: 1·2순위 정렬');
      resetSort=create('button','desktop-sort-reset','정렬 초기화');resetSort.type='button';resetSort.disabled=true;resetSort.onclick=()=>{sort=[];sync();};
      tools.append(hint,resetSort);label.append(tools);
    }
    const sortButtons=new Map();
    for(const [key,title]of config.columns){const th=create('th',key==='title'?'desktop-name-column':'desktop-col-'+key),button=create('button','desktop-sort',title);button.type='button';if(config.sortLimit===2)button.title='누른 순서대로 1·2순위 정렬 · 같은 열은 오름차순 → 내림차순 → 해제 · 다른 열을 더 누르면 2순위 변경';button.onclick=()=>{const index=sort.findIndex(s=>s.key===key);if(index>=0)sort=config.sortLimit===2&&sort[index].direction===-1?sort.filter((_,i)=>i!==index):sort.map((s,i)=>i===index?{key,direction:-s.direction}:s);else sort=[...(config.sortLimit===2?sort.slice(0,1):[]),{key,direction:1}];sync();};th.append(button);header.append(th);sortButtons.set(key,{button,th,title});}
    source.before(layout);layout.append(panel,pane);pane.append(heading,empty,source);source.classList.add('desktop-detail-source');
    function focus(key){current=key;sync();}
    function sync(){
      scheduled=false;if(!enabled)return;
      const articles=[...source.children].filter(node=>node.dataset.pcTitle!==undefined);
      table.classList.toggle('desktop-no-selection',Boolean(config.select)&&!articles.some(node=>node.querySelector(config.select)));
      records=new Map(articles.map(node=>[node.dataset.key||node.dataset.pcKey,node]));
      if(!records.has(current))current=records.keys().next().value||'';
      empty.hidden=records.size>0;setText(headingCount,config.title+' · '+records.size+'건');
      for(const [key,row]of rows)if(!records.has(key)){row.remove();rows.delete(key);}
      for(const [key,article]of records){
        let row=rows.get(key);
        if(!row){row=create('tr','desktop-data-row');row.dataset.key=key;if(config.select){const td=create('td','desktop-check-column'),check=create('input');check.type='checkbox';check.setAttribute('aria-label',article.dataset.pcTitle+' 선택');check.onchange=()=>{const original=records.get(key)?.querySelector(config.select);if(original&&!original.disabled&&original.checked!==check.checked)original.click();focus(key);};td.append(check);row.append(td);}
          for(const [field]of config.columns){
            const td=create('td',field==='title'?'desktop-name-column':'desktop-col-'+field);
            if(field==='title'){
              const button=create('button','desktop-row-focus');button.type='button';button.onclick=()=>focus(key);
              td.append(button,create('small','desktop-reference'));
              if(config.id==='out-list'){
                const compact=create('div','desktop-order-context');
                for(const key of ['owner','date','type'])compact.append(create('small','desktop-compact-'+key));
                td.append(compact);
              }
            }
            if(field==='status'&&config.id==='out-list')td.append(create('span','desktop-order-status'));
            row.append(td);
          }
          row.addEventListener('click',event=>{if(!event.target.closest('button,input,label'))focus(key);});rows.set(key,row);
        }
        let index=0;
        if(config.select){const original=article.querySelector(config.select),check=row.children[index++].firstElementChild;check.hidden=!original;check.disabled=!original||original.disabled;check.checked=Boolean(original?.checked);}
        for(const [field]of config.columns){const td=row.children[index++],value=article.dataset['pc'+field[0].toUpperCase()+field.slice(1)];
          if(field==='title'){
            const [button,reference,compact]=td.children;
            setText(button,value);button.setAttribute('aria-pressed',String(current===key));setText(reference,article.dataset.pcReference);
            if(compact)for(const [index,key]of ['pcOwner','pcDate','pcType'].entries())setText(compact.children[index],article.dataset[key]);
          }else{
            const numeric=['boxes','quantity','pack','remaining'].includes(field),n=Number(value);
            setText(td.firstElementChild||td,value==null||value===''?'—':numeric&&Number.isFinite(n)?fmt(n):value);
            if(td.firstElementChild)setData(td.firstElementChild,'status',value||'');
          }
        }
        setData(row,'current',current===key);setData(row,'attention',article.dataset.attention==='true'||article.dataset.pcAttention==='true');setData(row,'state',article.dataset.state||'');
        setData(article,'desktopCurrent',current===key);
      }
      let keys=[...records.keys()];
      if(sort.length) keys.sort((a,b)=>compareOrderFields(a,b,sort,(key,field)=>records.get(key).dataset['pc'+field[0].toUpperCase()+field.slice(1)]));
      if(config.id==='out-list')setData(source,'desktopSort',JSON.stringify(sort));
      let cursor=body.firstElementChild;for(const key of keys){const row=rows.get(key);if(cursor===row)cursor=cursor.nextElementSibling;else body.insertBefore(row,cursor);}
      for(const [key,{button,th,title}]of sortButtons){const index=sort.findIndex(s=>s.key===key),s=sort[index];setText(button,title+(s?` ${s.direction===1?'▲':'▼'}${config.sortLimit===2?index+1:''}`:''));if(index===0)th.setAttribute('aria-sort',s.direction===1?'ascending':'descending');else th.removeAttribute('aria-sort');if(s){setData(th,'sortPriority',index+1);setData(th,'sortDirection',s.direction===1?'ascending':'descending');}else{delete th.dataset.sortPriority;delete th.dataset.sortDirection;}}
      if(resetSort)resetSort.disabled=!sort.length;
      layout.dataset.empty=String(!records.size);
      const currentArticle=records.get(current);
      if(config.id==='out-list'&&currentArticle!==notifiedArticle){
        notifiedArticle=currentArticle;
        if(currentArticle)window.dispatchEvent(new CustomEvent('stock-outbound-focused',{detail:{key:current}}));
      }
    }
    function schedule(){if(!enabled||scheduled)return;scheduled=true;requestAnimationFrame(sync);}
    source.addEventListener('change',schedule);
    const observer=new MutationObserver(schedule);
    adapters.push({setActive(value){enabled=value;observer.disconnect();if(value){sync();observer.observe(source,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['disabled','hidden','class','data-state','data-attention','data-pc-title','data-pc-reference','data-pc-owner','data-pc-date','data-pc-type','data-pc-status','data-pc-quantity','data-pc-remaining','data-pc-boxes','data-pc-attention','data-pc-dispatch']});}else scheduled=false;}});
  }
  for(const config of configs)adapter(config);
  const productList=$('product-list');if(productList&&!$('desktop-product-heading')){const head=create('div','desktop-product-heading');head.id='desktop-product-heading';for(const text of ['','상품 / 피킹셀','본입수','박스 / 낱개','총수량'])head.append(create('span','',text));productList.before(head);}
  const nav=document.querySelector('.controller-tabs');if(nav){nav.dataset.warehouse=$('warehouse').textContent;nav.addEventListener('click',event=>{if(media.matches&&event.target.closest('button:not(:disabled)'))window.scrollTo({top:0,behavior:'instant'});});}
  let active;
  function refresh(){const next=media.matches&&!workspace.hidden;if(active===next)return;active=next;document.documentElement.classList.toggle('desktop-ui',active);for(const item of adapters)item.setActive(active);window.dispatchEvent(new Event('resize'));}
  if(media.addEventListener)media.addEventListener('change',refresh);else media.addListener(refresh);
  new MutationObserver(refresh).observe(workspace,{attributes:true,attributeFilter:['hidden']});
  refresh();
}

window.addEventListener('stock-login-required', () => {
  if ($('workspace').hidden) return;
  $('connection').textContent = '재로그인 필요'; $('connection').classList.remove('online');
});
function showConnected() {
  if ($('workspace').hidden) return;
  $('connection').textContent = '전산 연결됨'; $('connection').classList.add('online');
}
window.addEventListener('stock-reconnected', showConnected);
window.addEventListener('stock-connection-healthy', showConnected);
window.addEventListener('stock-wms-unreachable', () => {
  if ($('workspace').hidden) return;
  $('connection').textContent = '전산 서버 응답 없음'; $('connection').classList.remove('online');
});
window.addEventListener('stock-session-gone', () => {
  loginView(); showError('login-error', '이전 로그인 정보가 없습니다. 한 번 로그인하면 이후 재로그인 버튼에서 다시 사용할 수 있습니다.');
});
if(remoteApi){
  for(const id of ['username','password']){const field=$(id);field.hidden=true;field.required=false;document.querySelector(`label[for="${id}"]`).hidden=true;}
  $('login-form').querySelector('.muted').textContent='전산 서버의 로그인 창에서 연결해 주세요.';
  $('login-button').textContent='전산 로그인 창 열기 ↗';
}
try { await connected(await api('/api/session')); } catch { loginView(); }
