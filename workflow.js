import { api } from './api.js';
const post = (path, data) => api('/api/workflow/' + path, { method: 'POST', body: JSON.stringify(data) });
export async function choosePrintKinds() {
  const d = document.createElement('dialog'); d.className = 'print-dialog';
  const header = document.createElement('div'); header.className = 'workflow-dialog-heading';
  const h = document.createElement('h2'); h.textContent = '출력할 종류를 선택해 주세요';
  const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '취소'; cancel.className = 'workflow-dialog-cancel';
  header.append(h, cancel); d.append(header);
  const checks = {};
  for (const [kind, title] of [['picking', '피킹지'], ['label', '라벨물표 · 전산 물표라벨3'], ['slip', 'A4 물표']]) {
    const label = document.createElement('label'); label.className = 'print-field';
    const c = document.createElement('input'); c.type = 'checkbox'; checks[kind] = c;
    label.append(c, document.createTextNode(title)); d.append(label);
  }
  const copiesLabel = document.createElement('label'); copiesLabel.className = 'print-field'; copiesLabel.textContent = 'A4 물표 매수 · 주문당';
  const copies = document.createElement('input'); copies.type = 'number'; copies.min = '1'; copies.max = '100'; copies.step = '1'; copies.value = '1'; copiesLabel.append(copies); copiesLabel.hidden = true; d.append(copiesLabel);
  checks.slip.onchange = () => { copiesLabel.hidden = !checks.slip.checked; };
  const error = document.createElement('p'); error.setAttribute('role', 'alert'); d.append(error);
  const go = document.createElement('button'); go.textContent = '선택한 종류 출력'; go.className = 'primary';
  d.append(go);
  let choice = null;
  go.onclick = () => {
    const kinds = Object.keys(checks).filter(k => checks[k].checked), slipCopies = checks.slip.checked ? Number(copies.value) : 1;
    if (!kinds.length) { error.textContent = '출력할 종류를 하나 이상 선택해 주세요.'; return; }
    if (!Number.isInteger(slipCopies) || slipCopies < 1 || slipCopies > 100) { error.textContent = 'A4 물표는 주문당 1~100장을 입력해 주세요.'; return; }
    choice = { kinds, slipCopies }; d.close();
  };
  cancel.onclick = () => d.close(); document.body.append(d); d.showModal();
  return new Promise(resolve => d.addEventListener('close', () => { d.remove(); resolve(choice); }, { once: true }));
}
export async function startWorkflow(orders, action) {
  if (document.documentElement.classList.contains('mobile-device')) throw new Error('인쇄 기능은 PC에서 이용해 주세요.');
  if (action === 'missing') return post('start', { keys: orders.map(o => o.key), action, policy: 'missing', requestId: crypto.randomUUID() });
  const manualPrint = action === 'print' ? await choosePrintKinds() : undefined;
  if (action === 'print' && !manualPrint) return null;
  const keys = orders.map(o => o.key);
  // Both explicit output actions include previously printed orders. The server
  // still checks current order data, allocation and uncertain print results.
  return post('start', { keys, action, policy: 'reprint', manualPrint, requestId: crypto.randomUUID() });
}
export async function followWorkflow(id, update, valid = () => true) {
  while (valid()) { const job = await api('/api/workflow/jobs/' + id); if (!valid()) return; update(job); if (job.state !== 'running') return job; await new Promise(r => setTimeout(r, 1500)); }
}
