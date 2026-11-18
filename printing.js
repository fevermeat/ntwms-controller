import { api } from './api.js';
const e = (tag, text, cls = '') => { const node = document.createElement(tag); node.className = cls; if (text != null) node.textContent = text; return node; };
const post = (path, data) => api('/api/printing/' + path, { method: 'POST', body: JSON.stringify(data) });
const kindName = { picking: '피킹지', slip: 'A4 물표', label: '물표라벨3' };
const stateName = { preparing: 'PDF 생성 중', failed: 'PDF 생성 실패', ready: 'PDF 준비 완료 · 전송 대기', sending: '프린터 전송 중', sent: '프린터 전송 완료', paused: '전송 중지', uncertain: '전송 결과 확인 필요', skipped: '다른 내역에서 전송 완료' };
function printStatus(state) {
  const status = e('span', stateName[state] || '상태 확인 필요', 'print-state');
  status.dataset.state = state;
  return status;
}
function documentHistoryKey(job, doc) {
  const item = doc.key && job.items.find(order => order.key === doc.key);
  return item ? JSON.stringify([job.warehouse, doc.key, item.processingCycle ?? 0, doc.kind]) : '';
}
const timingText = timings => Object.entries({pdfPrepare:'PDF 준비',printerCheck:'프린터 확인',prePrintVerify:'전송 전 검증',printerSend:'프린터 전송',printStatusSync:'전산 출력여부 반영'}).filter(([key])=>Number.isFinite(timings?.[key])).map(([key,title])=>`${title} ${(timings[key]/1000).toFixed(2)}초`).join(' · ');
const button = (text, action, cls = 'text-button') => { const b = e('button', text, cls); b.type = 'button'; b.onclick = action; return b; };
function modeSelect(value) { const s = e('select'); s.add(new Option('라벨 · 16박스 이상은 A4 2장', 'label')); s.add(new Option('물표 · A4 1장', 'slip')); s.add(new Option('A4 물표 · 커스텀 자동 장수', 'slip-custom')); s.value = value || 'label'; return s; }
function field(text, input) { const l = e('label', null, 'print-field'); l.append(e('span', text), input); return l; }
export async function openPrinting(owners, orders, options = {}) {
  if (document.documentElement.classList.contains('mobile-device')) return;
  if (document.getElementById('print-dialog')) return;
  const dialog = e('dialog', null, 'print-dialog'); dialog.id = 'print-dialog'; dialog.setAttribute('aria-label', '피킹지·물표·라벨 출력');
  const title = e('div', null, 'print-heading'); title.append(e('h2', '피킹지 · 물표 · 라벨'), button('닫기', () => dialog.close()));
  const status = e('p', '프린터 설정을 불러오는 중…'); status.setAttribute('role', 'status');
  const content = e('div'); dialog.append(title, status, content); document.body.append(dialog); dialog.showModal();
  let closed = false, busy = false, timer;
  dialog.addEventListener('close', () => { closed = true; clearTimeout(timer); dialog.remove(); });
  const attempt = async fn => { if (busy) return; busy = true; try { await fn(); } catch (err) { status.textContent = err.message; status.className = 'error'; } finally { busy = false; } };
  try {
    let { settings, printers, transport } = await api('/api/printing/settings'); if (closed) return;
    status.textContent = transport === 'client' ? 'PDF를 확인한 뒤 이 PC에 연결된 프린터로 출력합니다.' : 'PDF를 확인한 뒤 설정된 프린터로 출력합니다.';
    const settingsBox = e('details', null, 'card print-settings'); settingsBox.append(e('summary', '프린터 · 화주별 출력 · 배차 이름 관리'));
    const printerInputs = {};
    for (const kind of ['picking', 'slip', 'label']) {
      const select = e('select'); select.add(new Option('프린터 선택', ''));
      for (const p of printers.filter(p => !p.virtual)) select.add(new Option(p.name, p.name));
      select.value = settings.printers[kind]; printerInputs[kind] = select; settingsBox.append(field(kindName[kind] + ' 프린터', select));
    }
    settingsBox.append(e('p', '라벨은 전산 원본 장수와 프린터의 기존 용지 설정을 사용합니다. 보증금과 트레이더스 파렛트·파레트도 원본 라벨에는 포함됩니다.', 'muted small'));
    const ownerModes = {}, ownerBox = e('details'); ownerBox.append(e('summary', '화주별 기본 출력 방식'));
    for (const owner of owners) { const select = modeSelect(settings.ownerModes[owner.code]); ownerModes[owner.code] = select; ownerBox.append(field(owner.name + ' · ' + owner.code, select)); }
    settingsBox.append(ownerBox);
    const mappingBox = e('details'); mappingBox.append(e('summary', '예상배차 → 물표 표시 이름'));
    mappingBox.append(e('p', '전산 예상배차에 포함된 문구를 등록하세요. 겹치면 가장 긴 문구를 우선합니다. 미등록 또는 같은 길이의 이름 충돌은 물표 가운데를 빈칸으로 둡니다.', 'muted small'));
    const mappings = e('div');
    const addMapping = (from = '', to = '') => {
      const row = e('div', null, 'print-mapping'); const a = e('input'), b = e('input'); a.value = from; b.value = to; a.maxLength = 100; b.maxLength = 40;
      a.setAttribute('aria-label', '전산 예상배차'); a.placeholder = '예: (호남1호)'; b.setAttribute('aria-label', '물표 표시 이름'); b.placeholder = '예: 호남';
      row.append(a, e('span', '→'), b, button('삭제', () => row.remove())); mappings.append(row);
    };
    Object.entries(settings.dispatchNames).forEach(([a, b]) => addMapping(a, b));
    mappingBox.append(mappings, button('배차 이름 추가', () => addMapping())); settingsBox.append(mappingBox);
    const selectors = new Map();
    settingsBox.append(button('설정 저장', () => attempt(async () => {
      const names = Object.create(null);
      for (const row of mappings.children) { const [a, b] = row.querySelectorAll('input'); if (!a.value.trim() && !b.value.trim()) continue; if (Object.hasOwn(names, a.value.trim())) throw new Error('같은 예상배차가 중복됐습니다.'); names[a.value.trim()] = b.value.trim(); }
      const saved = await post('settings', { revision: settings.revision, printers: Object.fromEntries(Object.entries(printerInputs).map(([k, v]) => [k, v.value])), ownerModes: Object.fromEntries(Object.entries(ownerModes).map(([k, v]) => [k, v.value])), dispatchNames: names });
      settings = saved.settings;
      for (const order of orders) selectors.get(order.key).value = settings.ownerModes[order.owner] || 'label';
      status.className = ''; status.textContent = '설정이 저장됐습니다. 선택 주문에도 화주 기본값을 적용했습니다.';
    }), 'primary'));
    if (!options.historyOnly) content.append(settingsBox);
    const selection = e('section', null, 'card'); selection.append(e('h3', `선택 주문 ${orders.length}건`));
    for (const order of orders) { const select = modeSelect(settings.ownerModes[order.owner]); selectors.set(order.key, select); selection.append(field(`${order.customer} · ${order.orderNo}`, select)); }
    selection.append(e('p', '보증금과 트레이더스 파렛트·파레트를 뺀 박스수로 16박스 기준을 판단합니다. 피킹지를 프린터에 전송한 뒤 NTWMS 출력여부를 반영합니다.', 'muted small'));
    const reprint = e('input'); reprint.type = 'checkbox'; selection.append(field('이미 출력한 주문을 다시 생성 (재출력용)', reprint));
    const history = e('section'); history.append(e('h3', '출력 내역'));
    const jobsBox = e('div'); history.append(jobsBox);
    const loadHistory = async () => { const data = await api('/api/printing/jobs'); if (!closed) renderJobs(data.jobs); };
    selection.append(button('선택 주문 PDF 준비', () => attempt(async () => {
      if (!orders.length) throw new Error('출고조회에서 주문을 먼저 선택해 주세요.');
      if (reprint.checked && !confirm('기존 출력 여부를 확인하셨나요? 선택한 주문의 보고서를 다시 생성하며 전산 출력횟수가 늘어날 수 있습니다.')) return;
      status.className = ''; status.textContent = '선택 주문의 상품상세와 원본 PDF를 준비합니다…';
      const job = await post('prepare', { requestId: crypto.randomUUID(), reprint: reprint.checked, items: orders.map(o => ({ key: o.key, mode: selectors.get(o.key).value })) });
      await loadHistory(); watch(job.id);
    }), 'primary'));
    if (!options.historyOnly) content.append(selection);
    content.append(button('출력 내역 새로고침', () => attempt(loadHistory)), history);
    const watch = async id => {
      clearTimeout(timer); if (closed) return;
      try {
        const job = await api('/api/printing/jobs/' + id); if (closed) return;
        status.textContent = job.error || stateName[job.state]; status.className = job.error ? 'error' : '';
        await loadHistory(); if (['preparing', 'sending'].includes(job.state)) timer = setTimeout(() => watch(id), 1800);
      } catch (err) { if (!closed) { status.textContent = err.message + ' 출력 내역 새로고침으로 확인해 주세요.'; status.className = 'error'; } }
    };
    function renderJobs(jobs) {
      jobsBox.replaceChildren();
      if (!jobs.length) jobsBox.append(e('p', '출력 내역이 없습니다.', 'muted'));
      const laterTransmissions = new Map();
      for (const job of jobs) {
        if (job.archived) continue;
        for (const doc of job.documents) {
          if (doc.state !== 'sent') continue;
          const key = documentHistoryKey(job, doc);
          if (key && (!laterTransmissions.has(key) || job.createdAt > laterTransmissions.get(key))) laterTransmissions.set(key, job.createdAt);
        }
      }
      for (const job of jobs) {
        const box = e('article', null, 'card print-job');
        const summary = e('header', null, 'print-status-line');
        const state = job.documents.some(doc => doc.state === 'uncertain') ? 'uncertain' : job.state;
        summary.append(e('strong', `${new Date(job.createdAt).toLocaleString('ko-KR')}${job.abandoned ? ' · 보관 종료' : ''}`), printStatus(state));
        box.append(summary);
        if(job.archived)box.append(e('p','예정 복귀 이전의 처리 회차 · PDF 열람만 가능','muted small'));
        box.append(e('p', job.items.map(o => `${o.customer} (${o.orderNo})`).join(' / ')));
        for (const plan of job.plans) box.append(e('p', `${plan.customer}: 총 ${plan.totalBoxes} − 제외 품목 ${plan.excludedBoxes} = ${plan.effectiveBoxes}박스 · ${kindName[plan.output]} ${plan.copies}부 · 배차 ${plan.dispatchName || '(빈칸)'}${plan.slipRemarkKeyword ? ` · 비고 규칙: ${plan.slipRemarkKeyword} → A4 배송처 ${plan.slipCustomer}` : ''}`, 'small'));
        if (job.error) box.append(e('p', job.error, 'error'));
        if (timingText(job.timings)) { const timing = e('details',null,'print-timings');timing.append(e('summary','처리 시간'),e('p',timingText(job.timings),'small'));box.append(timing); }
        if (!job.archived && job.state === 'failed' && !job.abandoned) box.append(button('누락 PDF 이어서 준비', () => attempt(async () => { await post(`jobs/${job.id}/resume`, { confirm: true }); watch(job.id); }), 'primary'));
        for (const doc of job.documents) {
          const row = e('div', null, 'print-document'); const link = e('a', `${doc.customer} · ${kindName[doc.kind]} PDF`); link.href = doc.url; link.target = '_blank'; link.rel = 'noopener';
          const heading = e('div', null, 'print-status-line');
          heading.append(link, printStatus(doc.state));
          row.append(heading, e('p', `${doc.pages}쪽 × ${doc.copies}부 = ${doc.pages * doc.copies}장 · ${doc.printer}`, 'small'));
          if (doc.state === 'uncertain' && doc.error) row.append(e('p', doc.error, 'out-document-note'));
          if (!job.archived && doc.state === 'ready' && laterTransmissions.get(documentHistoryKey(job, doc)) > job.createdAt) {
            row.append(e('p', '이후 같은 주문의 이 문서 유형이 다른 내역에서 전송됐습니다.', 'small'));
          }
          if (doc.kind === 'picking' && doc.state === 'sent') row.append(e('p', doc.wmsPrint?.state === 'confirmed' ? 'NTWMS 출력여부 Y 확인 완료' : `NTWMS 출력여부 ${doc.wmsPrint?.state === 'updating' ? '반영 중' : '확인 필요'}${doc.wmsPrint?.error ? ' · ' + doc.wmsPrint.error : ''}`, doc.wmsPrint?.state === 'confirmed' ? 'small' : 'out-document-note'));
          if (!job.archived && doc.state === 'uncertain') {
            for (const [value, label, prompt] of [['sent', '출력됨 확인', '프린터에서 출력됐거나 대기열에 들어간 것을 확인했나요? 이 문서는 다시 보내지 않습니다.'], ['ready', '미출력 확인 후 다시 대기', '종이가 나오지 않았고 프린터 대기열에도 없는 것을 확인했나요? 확인하면 이 문서를 다시 전송할 수 있습니다.']]) row.append(button(label, () => attempt(async () => { if (!confirm(prompt)) return; await post(`jobs/${job.id}/resolve`, { document: doc.id, resolution: value, confirm: true }); await loadHistory(); })));
          }
          box.append(row);
        }
        if (!job.archived && !['preparing', 'sending'].includes(job.state) && job.documents.some(d => d.kind === 'picking' && d.state === 'sent' && d.wmsPrint?.state !== 'confirmed')) box.append(button('NTWMS 출력여부 반영', () => attempt(async () => {
          if (!confirm('피킹지 전송 완료 주문의 NTWMS 출력여부를 확인하고, N이면 Y로 반영합니다. 종이는 다시 출력하지 않습니다. 계속할까요?')) return;
          await post(`jobs/${job.id}/sync-status`, { confirm: true }); watch(job.id);
        })));
        if (!job.archived && !job.abandoned && ['ready', 'paused'].includes(job.state) && job.documents.some(d => d.state === 'ready') && !job.documents.some(d => d.state === 'uncertain')) box.append(button('대기 문서 순서대로 출력', () => attempt(async () => {
          const docs = job.documents.filter(d => d.state === 'ready');
          if (!confirm('설정된 PC의 프린터로 출력합니다.\n\n' + docs.map(d => `${d.customer} · ${kindName[d.kind]} ${d.pages * d.copies}장 → ${d.printer}`).join('\n') + '\n\n출력할까요?')) return;
          await post(`jobs/${job.id}/send`, { confirm: true }); watch(job.id);
        }), 'primary'));
        if (!job.archived && !job.abandoned && !['preparing', 'sending'].includes(job.state) && !job.documents.some(d => d.state === 'uncertain')) box.append(button('보관 종료', () => attempt(async () => { if (!confirm('이 내역에서 더 이상 출력하지 않도록 종료할까요? PDF는 남고, 필요하면 새로 생성할 수 있습니다.')) return; await post(`jobs/${job.id}/abandon`, { confirm: true }); await loadHistory(); })));
        if (job.state === 'sent') box.append(e('p', '프린터에 전송했습니다. 실제 용지 배출은 프린터에서 확인해 주세요.', 'muted small'));
        jobsBox.append(box);
      }
    }
    await loadHistory();
  } catch (err) { if (!closed) { status.textContent = err.message; status.className = 'error'; } }
}
