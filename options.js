import { api } from './api.js';
const node = (tag, text) => { const n = document.createElement(tag); if (text != null) n.textContent = text; return n; };
function select(values, current) { const s = node('select'); for (const [v, label] of values) s.add(new Option(label, v)); s.value = current; return s; }
function field(title, input) { const l = node('label'); l.className = 'print-field'; l.append(node('span', title), input); return l; }
function optionValues(settings, owners) {
  return { printers: { ...settings.printers }, ownerModes: Object.fromEntries(owners.map(o => [o.code, settings.ownerModes?.[o.code] || 'label'])), allocationMethods: Object.fromEntries(owners.map(o => [o.code, settings.allocationMethods?.[o.code] || (/베스트바이앤베버리지|비티알커머스/.test(o.name) ? 'detail' : 'order')])), dispatchNames: { ...settings.dispatchNames }, slipRemarkRules: (settings.slipRemarkRules || []).map(r => ({ ...r })) };
}
function mergeOptionDraft(base, draft, latest, owners) {
  const before = optionValues(base, owners), remote = optionValues(latest, owners), merged = {}, conflicts = [];
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ruleMap = rows => Object.fromEntries(rows.map((r, i) => [r.keyword.trim().normalize('NFKC') || `__draft-empty-${i}`, r]));
  for (const group of ['printers','ownerModes','allocationMethods','dispatchNames','slipRemarkRules']) {
    const maps = group === 'slipRemarkRules' ? [before[group], draft[group], remote[group]].map(ruleMap) : [before[group], draft[group], remote[group]];
    const [b, l, r] = maps, entries = [];
    for (const key of new Set([...Object.keys(r), ...Object.keys(l), ...Object.keys(b)])) {
      let value = r[key];
      if (!same(l[key], b[key])) {
        if (same(r[key], b[key]) || same(l[key], r[key])) value = l[key];
        else conflicts.push({ group, key, local: l[key], remote: r[key] });
      }
      if (value !== undefined) entries.push([key, value]);
    }
    merged[group] = group === 'slipRemarkRules' ? entries.map(([,v]) => v) : Object.fromEntries(entries);
  }
  return { draft: merged, conflicts };
}
export async function mountOptions(container, owners, valid = () => true, recovery = null) {
  const { settings, printers, transport, deviceId } = recovery?.loaded || await api('/api/printing/settings'); if (!valid()) return;
  const values = recovery?.draft || settings;
  container.replaceChildren();
  const recoveryBar = node('div'); recoveryBar.className = 'option-recovery';
  const reload = node('button', '최신 설정 다시 불러오기'); reload.type = 'button'; reload.className = 'text-button';
  const recoveryStatus = node('p', recovery?.message || '다른 기기에서 바꾼 설정을 불러올 때 작성 중인 변경값을 함께 대조합니다.'); recoveryStatus.setAttribute('role', 'status'); recoveryBar.append(reload, recoveryStatus); container.append(recoveryBar);
  if (transport === 'client') { const {mountPrintClient} = await import('./print-client.js'); if(!valid())return; mountPrintClient(container,api,()=>reload.click(),{loadedDeviceId:deviceId}); }
  const methods = {}, modes = {}, printerFields = {};
  const saveArea = () => { const wrapper = node('div'), button = node('button', '옵션 저장'), status = node('p'); button.type = 'button'; button.className = 'primary'; status.setAttribute('role', 'status'); wrapper.append(button, status); return { wrapper, button, status }; };
  const dispatchSave = saveArea(), remarkSave = saveArea();
  const ownerSettings = node('details'); ownerSettings.append(node('summary', '화주별 할당·출력 방식')); container.append(ownerSettings);
  const ownerFilter = node('input'); ownerFilter.type = 'search'; ownerFilter.placeholder = '화주명 또는 코드'; ownerFilter.setAttribute('aria-label', '옵션 화주 검색'); ownerSettings.append(ownerFilter);
  const ownerRows = node('div'); ownerSettings.append(ownerRows);
  for (const o of owners) {
    const row = node('div'); row.className = 'option-owner'; row.dataset.search = (o.name + o.code).toLowerCase();
    const method = select([['order', '오더할당'], ['detail', '상세할당']], values.allocationMethods?.[o.code] || (/베스트바이앤베버리지|비티알커머스/.test(o.name) ? 'detail' : 'order'));
    const mode = select([['label', '라벨 · 16박스 이상 A4 2장'], ['slip', '물표 · A4 1장'], ['slip-custom', 'A4 물표 · 커스텀 자동 장수']], values.ownerModes[o.code] || 'label'); methods[o.code] = method; modes[o.code] = mode;
    row.append(node('strong', `${o.name} (${o.code})`), field('할당 방식', method), field('출력 방식', mode)); ownerRows.append(row);
  }
  ownerFilter.oninput = () => { for (const row of ownerRows.children) row.hidden = !row.dataset.search.includes(ownerFilter.value.trim().toLowerCase()); };
  ownerSettings.append(node('p', '커스텀 A4 물표: 보증금과 트레이더스 파렛트·파레트를 제외하고 같은 상품의 박스수를 합산합니다. 8박스 이상인 품목마다 2장, 8박스 미만 품목의 합이 8박스 이상이면 2장 추가합니다. 주문당 최소 2장입니다.'));
  const printerSettings = node('details'); printerSettings.className='print-pc-only'; printerSettings.append(node('summary', '프린터 설정')); container.append(printerSettings);
  for (const [kind, label] of [['picking', '피킹지'], ['slip', 'A4 물표'], ['label', '라벨']]) {
    const choices = [['', '프린터 선택'], ...printers.filter(p => !p.virtual).map(p => [p.name, p.name])];
    if (values.printers[kind] && !choices.some(([name]) => name === values.printers[kind])) choices.push([values.printers[kind], values.printers[kind] + ' · 설치 확인 필요']);
    const s = select(choices, values.printers[kind]); printerFields[kind] = s; printerSettings.append(field(label, s));
  }
  printerSettings.append(node('p', transport === 'client' ? '이 PC에 연결된 피킹지·A4·라벨 프린터를 선택하세요. 설정은 PC별로 저장됩니다.' : '현재 서버 PC에 연결된 프린터 설정입니다.'));
  const dispatch = node('details'); dispatch.append(node('summary', '배차 이름 관리 · 기본 변환표 포함'));
  dispatch.append(node('p', '전산 배차명에 등록한 문구가 포함되면 적용됩니다. 예: 호남 → 호남이면 호남1호·호남용차에도 적용됩니다. 여러 문구가 겹치면 가장 긴 문구를 우선하며, 같은 길이의 다른 이름이 충돌하면 빈칸으로 표시됩니다.'));
  const mappings = node('div'); dispatch.append(mappings);
  const add = (from = '', to = '', first = false) => {
    const row = node('div'); row.className = 'print-mapping'; const a = node('input'), b = node('input'), remove = node('button', '삭제');
    a.value = from; b.value = to; a.maxLength = 100; b.maxLength = 40; a.setAttribute('aria-label', '전산 예상배차'); b.setAttribute('aria-label', '물표 배차 이름');
    a.placeholder = '포함 문구 · 예: 호남'; b.placeholder = '표시 이름 · 예: 호남';
    remove.type = 'button'; remove.onclick = () => row.remove(); row.append(a, node('span', '→'), b, remove);
    if (first) { mappings.prepend(row); row.after(dispatchSave.wrapper); } else mappings.append(row);
  };
  Object.entries(values.dispatchNames).forEach(([a, b]) => add(a, b));
  const plus = node('button', '배차 추가'); plus.type = 'button'; plus.onclick = () => add('', '', true); dispatch.insertBefore(plus, dispatch.children[1]); plus.after(mappings); dispatch.append(node('p', '등록되지 않은 배차는 A4 물표에 빈칸으로 표시됩니다.')); container.append(dispatch);
  const remarkRules = node('details'); remarkRules.append(node('summary', '비고별 A4 배송처·배차 변경'));
  remarkRules.append(node('p', '비고에 포함된 단어로 A4 물표의 배송처명과 배차를 함께 변경합니다. 배차를 비우면 기존 배차도 빈칸으로 표시합니다. 기존 배차 이름 관리보다 우선하며, 겹치면 가장 긴 문구를 사용합니다. 같은 길이의 서로 다른 규칙이 겹치면 설정 확인을 요청합니다. 전산 원본·피킹지·라벨은 변경하지 않습니다.'));
  const rules = node('div'); remarkRules.append(rules);
  const addRule = (rule = {}, first = false) => {
    const row = node('div'); row.className = 'slip-remark-rule';
    for (const [key, title, max] of [['keyword', '비고 포함 단어', 100], ['customer', '변경할 배송처명', 160], ['dispatch', '배차 · 빈칸 가능', 40]]) {
      const input = node('input'); input.value = rule[key] || ''; input.maxLength = max; input.dataset.ruleField = key; input.setAttribute('aria-label', title); row.append(field(title, input));
    }
    const remove = node('button', '삭제'); remove.type = 'button'; remove.onclick = () => row.remove(); row.append(remove);
    if (first) { rules.prepend(row); row.after(remarkSave.wrapper); } else rules.append(row);
  };
  (values.slipRemarkRules || []).forEach(rule => addRule(rule));
  const addRemarkRule = node('button', '비고 규칙 추가'); addRemarkRule.type = 'button'; addRemarkRule.onclick = () => addRule({}, true); remarkRules.insertBefore(addRemarkRule, remarkRules.children[1]); addRemarkRule.after(rules);
  remarkRules.append(node('p', '아래 옵션 저장을 누르면 이 계정과 서버 PC에 저장됩니다. 새로 생성하는 A4 물표부터 적용합니다.'));
  container.append(remarkRules);
  const status = node('p'); status.setAttribute('role', 'status'); const save = node('button', '옵션 저장'); save.className = 'primary'; save.type = 'button';
  const saveButtons = [save, dispatchSave.button, remarkSave.button], saveStatuses = [status, dispatchSave.status, remarkSave.status];
  let recovering = false;
  const capture = () => {
    const dispatchNames = Object.create(null);
    for (const row of mappings.querySelectorAll('.print-mapping')) { const [a, b] = row.querySelectorAll('input'); if (!a.value.trim() && !b.value.trim()) continue; if (Object.hasOwn(dispatchNames, a.value.trim())) throw new Error('배차 이름이 중복됐습니다.'); dispatchNames[a.value.trim()] = b.value.trim(); }
    const slipRemarkRules = [...rules.querySelectorAll('.slip-remark-rule')].map(row => Object.fromEntries([...row.querySelectorAll('input')].map(input => [input.dataset.ruleField, input.value.trim()]))).filter(rule => Object.values(rule).some(Boolean));
    const keywords = slipRemarkRules.map(r=>r.keyword.normalize('NFKC')).filter(Boolean);if(new Set(keywords).size!==keywords.length)throw new Error('비고 포함 단어가 중복됐습니다.');
    return { printers: Object.fromEntries(Object.entries(printerFields).map(([k, v]) => [k, v.value])), ownerModes: Object.fromEntries(Object.entries(modes).map(([k, v]) => [k, v.value])), allocationMethods: Object.fromEntries(Object.entries(methods).map(([k, v]) => [k, v.value])), dispatchNames, slipRemarkRules };
  };
  const restoreView = next => { next.open = [...container.querySelectorAll(':scope > details')].map(d => d.open); next.search = ownerFilter.value; return mountOptions(container, owners, valid, next); };
  const reloadLatest = async () => {
    if (recovering) return; recovering = true;
    const controls = [...container.querySelectorAll('input,select,button')].map(e => [e, e.disabled]); for (const [e] of controls) e.disabled = true;
    try { const draft = capture(), loaded = await api('/api/printing/settings'); if (!valid() || !container.isConnected) return; const merged = mergeOptionDraft(settings, draft, loaded.settings, owners); await restoreView({ loaded, ...merged, message: merged.conflicts.length ? '다른 기기와 같은 항목을 변경했습니다. 아래에서 사용할 값을 선택해 주세요.' : '최신 설정과 작성 중인 변경값을 불러왔습니다. 확인 후 옵션 저장을 눌러 주세요.' }); }
    catch (e) { recoveryStatus.textContent = '설정을 불러오지 못했습니다. 작성 중인 값은 유지됩니다. ' + e.message; }
    finally { recovering = false; for (const [e, disabled] of controls) if (e.isConnected) e.disabled = disabled; }
  };
  reload.onclick = reloadLatest;
  if (recovery?.conflicts?.length) {
    const panel = node('div'); panel.className = 'option-conflicts'; panel.setAttribute('role', 'alert'); const choices = [];
    const groupNames = { printers:'프린터', ownerModes:'출력 방식', allocationMethods:'할당 방식', dispatchNames:'배차', slipRemarkRules:'비고 규칙' };
    const display = value => value === undefined ? '(삭제)' : typeof value === 'object' ? `${value.keyword} → ${value.customer} / ${value.dispatch || '(빈칸)'}` : ({label:'라벨',slip:'A4 1장','slip-custom':'커스텀 A4',order:'오더할당',detail:'상세할당',picking:'피킹지'}[value] || value || '(빈칸)');
    for (const conflict of recovery.conflicts) {
      const title = `${groupNames[conflict.group]} · ${owners.find(o=>o.code===conflict.key)?.name || ({picking:'피킹지',slip:'A4 물표',label:'라벨'}[conflict.key] || conflict.key)}`;
      const row = node('div'); row.className = 'option-conflict-row'; const s = select([['','선택해 주세요'],['remote','최신 설정 사용'],['local','내 입력 유지']], '');
      row.append(node('strong',title),node('p','최신 설정: '+display(conflict.remote)),node('p','내 입력: '+display(conflict.local)),field('사용할 값',s));panel.append(row);choices.push({conflict,input:s});
    }
    const apply = node('button', '선택한 값 적용'); apply.type = 'button'; apply.className = 'primary'; const note = node('p');note.setAttribute('role','status');
    apply.onclick = async () => { if (choices.some(c=>!c.input.value)) { note.textContent = '모든 충돌 항목에서 사용할 값을 선택해 주세요.'; return; } const draft = capture(); for (const {conflict:c,input} of choices) { const value = c[input.value]; if(c.group === 'slipRemarkRules') { const map = Object.fromEntries(draft.slipRemarkRules.map((r,i)=>[r.keyword.trim().normalize('NFKC') || `__draft-empty-${i}`,r])); if(value===undefined)delete map[c.key];else map[c.key]=value;draft.slipRemarkRules=Object.values(map); } else { if(value===undefined)delete draft[c.group][c.key];else draft[c.group][c.key]=value; } } await restoreView({loaded:{settings,printers},draft,message:'선택한 값을 적용했습니다. 확인 후 옵션 저장을 눌러 주세요.'}); };
    panel.append(apply,note);recoveryBar.after(panel);for(const b of saveButtons)b.disabled=true;reload.disabled=true;
  }
  const saveOptions = async () => {
    if (save.disabled) return;
    for (const button of saveButtons) button.disabled = true;
    try {
      const draft = capture(), { slipRemarkRules } = draft;
      const seenRules = new Set();
      for (const rule of slipRemarkRules) { if (!rule.keyword || !rule.customer) throw new Error('비고 포함 단어와 배송처명을 입력해 주세요.'); const key = rule.keyword.normalize('NFKC'); if (seenRules.has(key)) throw new Error('비고 포함 단어가 중복됐습니다.'); seenRules.add(key); }
      const { settings: saved } = await api('/api/printing/settings', { method: 'POST', body: JSON.stringify({ revision: settings.revision, ...draft }) });
      Object.assign(settings,saved); for (const message of saveStatuses) { message.textContent = '옵션이 저장됐습니다. 다음 로그인에도 이 설정을 사용합니다.'; message.className = ''; }
    } catch (e) { if (e.code === 'SETTINGS_CONFLICT' || e.status === 409 && e.message.includes('설정이 변경')) { await reloadLatest(); } else for (const message of saveStatuses) { message.textContent = e.message; message.className = 'error'; } } finally { for (const button of saveButtons) if (button.isConnected && !recovery?.conflicts?.length) button.disabled = false; }
  };
  for (const button of saveButtons) button.onclick = saveOptions;
  const history = node('button', '출력 내역 · 문제 해결'); history.type = 'button'; history.className = 'text-button print-pc-only'; history.onclick = async () => { const { openPrinting } = await import('./printing.js'); await openPrinting(owners, [], { historyOnly: true }); };
  container.append(save, history, status);
  if (recovery?.open) [...container.querySelectorAll(':scope > details')].forEach((d,i)=>d.open=Boolean(recovery.open[i]));
  if (recovery?.search) { ownerFilter.value=recovery.search;ownerFilter.oninput(); }
}
