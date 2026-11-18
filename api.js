if (typeof document !== 'undefined' && typeof navigator !== 'undefined') {
  const phone = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  document.documentElement.classList.toggle('mobile-device', phone);
}
export const apiBase = typeof document === 'undefined' ? '' : (document.querySelector('meta[name="stock-api-base"]')?.content || '').replace(/\/$/,'');
export const remoteApi = Boolean(apiBase && apiBase !== location.origin);
let remoteToken = '';
try { if (remoteApi) remoteToken=sessionStorage.getItem('stock-api-session:'+apiBase)||''; } catch {}
export function setApiSession(token) {
  remoteToken=token||'';
  try { if(remoteApi){if(remoteToken)sessionStorage.setItem('stock-api-session:'+apiBase,remoteToken);else sessionStorage.removeItem('stock-api-session:'+apiBase);} } catch {}
}
export async function apiFetch(path, options = {}) {
  if (!path.startsWith('/api/')) throw new Error('올바른 API 경로를 확인해 주세요.');
  let printClient;
  try { printClient=localStorage.getItem('stock-print-client'); } catch {}
  return fetch(apiBase+path, { ...options, ...(remoteApi?{credentials:'omit'}:{}), headers:{'Content-Type':'application/json',...(remoteApi&&remoteToken?{Authorization:'Bearer '+remoteToken}:{}),...(printClient?{'X-Stock-Print-Client':printClient}:{}),...options.headers} });
}
export function compareOrderFields(left, right, sort, value) {
  for (const {key, direction} of sort) {
    const a = String(value(left, key) ?? ''), b = String(value(right, key) ?? '');
    const comparison = ['boxes','quantity','pack','remaining'].includes(key)
      ? Number(a) - Number(b) : a.localeCompare(b, 'ko', {numeric:true});
    if (comparison) return direction * comparison;
  }
  return 0;
}

export async function api(path, options = {}) {
  let response;
  try {
    response = await apiFetch(path, options);
  } catch {
    throw new Error('서버 연결이 끊겼습니다. 인터넷 연결과 재고 리모컨 PC의 실행 상태를 확인해 주세요.');
  }
  let text;
  try { text = await response.text(); }
  catch { throw new Error('조회 응답을 받는 도중 연결이 끊겼습니다. 다시 조회해 주세요.'); }
  let data;
  try { data = JSON.parse(text); }
  catch {
    const error = new Error('서버에서 정상적인 응답을 받지 못했습니다. 연결이 잠시 지연될 수 있으니 다시 시도해 주세요.');
    error.status = response.status;
    throw error;
  }
  if (!response.ok) {
    if(response.status===401 && data.code==='SESSION_GONE')setApiSession('');
    if (response.status === 401 && path !== '/api/login' && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('stock-login-required', { detail: { sessionGone: data.code === 'SESSION_GONE' } }));
    }
    const error = new Error(data.error || '연결 오류가 발생했습니다.'); error.status = response.status; error.code = data.code; throw error;
  }
  if(path==='/api/logout')setApiSession('');
  return data;
}
