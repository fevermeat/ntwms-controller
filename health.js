import {apiFetch} from './api.js';
let mounted = false;
export function mountHealth() {
  if (mounted) return; mounted = true;
  const workspace = document.getElementById('workspace');
  const panel = document.createElement('details'); panel.className = 'health-panel card'; panel.hidden = true;
  const heading = document.createElement('div'); heading.className = 'health-heading';
  const title = document.createElement('strong'); title.textContent = '연결 상태';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'text-button'; refresh.textContent = '새로 확인';
  const reconnect = document.createElement('button'); reconnect.id = 'health-reconnect'; reconnect.type = 'button'; reconnect.className = 'picking-button health-reconnect'; reconnect.textContent = '재로그인하기';
  const badge = document.createElement('span'); badge.className = 'health-connection-note'; badge.setAttribute('role', 'status');
  const summary = document.createElement('summary'); summary.append(title, badge, reconnect);
  heading.append(refresh); panel.append(summary, heading);
  const rows = {};
  for (const [key, name] of [['server', '서버'], ['wms', '전산'], ['printers', '프린터']]) {
    const row = document.createElement('p'); row.className = 'health-row'; row.textContent = name + ' · 확인 중'; row.dataset.state = 'unknown'; rows[key] = { row, name }; panel.append(row);
  }
  const details = document.createElement('div'); details.className = 'health-devices'; panel.append(details);
  const reconnectMessage = document.createElement('p'); reconnectMessage.className = 'health-note'; reconnectMessage.hidden = true; reconnectMessage.setAttribute('role', 'status'); panel.append(reconnectMessage);
  const time = document.createElement('p'); time.className = 'health-note'; panel.append(time);
  const note = document.createElement('p'); note.className = 'health-note'; note.textContent = '로그인 연결은 마지막 사용부터 7일간 유지됩니다. 재로그인은 버튼을 누를 때만 실행합니다. 프린터 상태는 Windows 보고 기준입니다.'; panel.append(note);
  workspace.before(panel);
  const measure=()=>document.documentElement.style.setProperty('--health-height',`${panel.hidden?0:panel.offsetHeight}px`);
  if(typeof ResizeObserver!=='undefined')new ResizeObserver(measure).observe(panel);
  panel.addEventListener('toggle',measure);window.addEventListener('resize',measure);
  let timer, controller, generation = 0, enabled = false, expired = false, reconnecting = false, sessionGone = false;
  const active = () => !workspace.hidden && !document.hidden && !expired && !reconnecting;
  function requireLogin(gone = false) {
    sessionGone = gone; expired = gone; panel.dataset.needsLogin = 'true';
    badge.textContent = gone ? '로그인 필요' : '연결 끊김';
    reconnect.textContent = gone ? '로그인하기' : '재로그인하기';
  }
  window.addEventListener('stock-login-required', event => {
    if (workspace.hidden) return;
    requireLogin(Boolean(event.detail?.sessionGone));
    if (expired) { clearTimeout(timer); controller?.abort(); }
  });
  function draw(key, state, message) { rows[key].row.dataset.state = state; rows[key].row.textContent = rows[key].name + ' · ' + message; }
  async function read() {
    if (!active() || controller) return;
    clearTimeout(timer); const rev = generation; controller = new AbortController(); const current = controller;
    const timeout = setTimeout(() => current.abort(), 25000); refresh.disabled = true;
    try {
      const response = await apiFetch('/api/health', { signal: current.signal });
      if (rev !== generation || expired) return;
      if (response.status === 401) { requireLogin(true); window.dispatchEvent(new CustomEvent('stock-login-required', { detail: { sessionGone: true } })); throw new Error('이전 로그인 정보가 없습니다. 로그인하기를 눌러 주세요.'); }
      if (!response.ok) throw new Error('서버 상태 조회 실패');
      const data = await response.json(); if (rev !== generation || expired) return;
      if (data.wms?.reachable === false) {
        if (!panel.dataset.needsLogin) {
          badge.textContent = '전산 서버 응답 없음';
          window.dispatchEvent(new CustomEvent('stock-wms-unreachable'));
        }
      } else if (data.wms?.requiresLogin) {
        requireLogin(); window.dispatchEvent(new CustomEvent('stock-login-required'));
      } else if (data.wms?.requiresLogin === false) {
        delete panel.dataset.needsLogin; badge.textContent = ''; reconnect.textContent = '재로그인하기';
        window.dispatchEvent(new CustomEvent('stock-connection-healthy'));
      }
      for (const key of Object.keys(rows)) draw(key, data[key]?.state || 'unknown', data[key]?.message || '상태 확인 불가');
      details.replaceChildren();
      for (const printer of data.printers?.devices || []) { const p = document.createElement('p'); p.textContent = printer.name + ' · ' + printer.message; p.dataset.state = printer.state; details.append(p); }
      time.textContent = '확인 시각 · ' + new Date(data.checkedAt).toLocaleTimeString('ko-KR');
    } catch (error) {
      if (rev !== generation) return;
      draw('server', 'warning', expired ? '로그인 필요' : '응답 없음 · PC 실행 상태나 인터넷 연결 확인');
      draw('wms', 'unknown', '상태 확인 불가'); draw('printers', 'unknown', '상태 확인 불가'); details.replaceChildren();
      time.textContent = expired ? error.message : '상태를 확인하지 못했습니다. 새로 확인을 눌러 주세요.';
    } finally {
      clearTimeout(timeout); if (controller === current) controller = null;
      if (rev === generation) { refresh.disabled = false; if (active()) timer = setTimeout(read, 60000); }
    }
  }
  function sync() {
    panel.hidden = workspace.hidden;
    if (workspace.hidden) { expired = sessionGone = false; panel.open = false; delete panel.dataset.needsLogin; badge.textContent = ''; reconnectMessage.hidden = true; reconnect.textContent = '재로그인하기'; }
    measure();
    const next = active();
    if (next === enabled) return; enabled = next; generation++;
    clearTimeout(timer); controller?.abort(); controller = null; refresh.disabled = false;
    if (next) read();
  }
  refresh.onclick = read;
  reconnect.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    if (reconnecting) return;
    if (sessionGone) { window.dispatchEvent(new CustomEvent('stock-session-gone')); return; }
    reconnecting = true; generation++; clearTimeout(timer); controller?.abort(); controller = null;
    refresh.disabled = reconnect.disabled = true; panel.dataset.needsLogin = 'true';
    badge.textContent = '이전 로그인 정보로 연결 중…'; reconnect.textContent = '재로그인 중…';
    reconnectMessage.hidden = true;
    const request = async method => {
      const response = await apiFetch('/api/reconnect', { method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: '{}' } : {}) });
      if (response.status === 401) { requireLogin(true); throw new Error('이전 로그인 정보가 없습니다. 로그인하기를 눌러 주세요.'); }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '재로그인 상태를 확인하지 못했습니다.');
      return data;
    };
    try {
      let job = await request('POST');
      while (job.state === 'running') {
        await new Promise(resolve => setTimeout(resolve, 1000));
        job = await request('GET');
      }
      if (job.state !== 'complete') throw new Error(job.error || '재로그인을 완료하지 못했습니다.');
      expired = sessionGone = false; delete panel.dataset.needsLogin;
      badge.textContent = '재로그인 완료'; reconnect.textContent = '재로그인하기';
      reconnectMessage.textContent = '재로그인 완료 · 사용하던 화면에서 계속 작업할 수 있습니다.'; reconnectMessage.hidden = false;
      window.dispatchEvent(new CustomEvent('stock-reconnected', { detail: job.data }));
    } catch (error) {
      panel.dataset.needsLogin = 'true'; badge.textContent = sessionGone ? '로그인 필요' : '재로그인 확인 필요';
      reconnect.textContent = sessionGone ? '로그인하기' : '재로그인하기';
      reconnectMessage.textContent = error.message || '재로그인하지 못했습니다. 전산 접속 상태를 확인하고 다시 눌러 주세요.'; reconnectMessage.hidden = false;
      panel.open = true;
    } finally {
      reconnecting = false; refresh.disabled = reconnect.disabled = false;
      enabled = false; sync();
    }
  };
  new MutationObserver(sync).observe(workspace, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('visibilitychange', sync); sync();
}
mountHealth();
