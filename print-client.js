import {apiFetch,apiBase} from './api.js';
const mobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
export function mountPrintClient(container, api) {
  if (mobile()) return;
  const box = document.createElement('details'); box.className='print-client-setup';
  const heading = document.createElement('summary'); heading.textContent = '이 PC 인쇄 연결';
  const name = document.createElement('input'); name.placeholder = '예: 사무실 김완석 PC'; name.maxLength = 80; name.setAttribute('aria-label','PC 이름');
  const status = document.createElement('p'); status.className='muted small'; status.setAttribute('role','status');
  const register = document.createElement('button'); register.type = 'button'; register.className='text-button'; register.textContent = '이 PC 연결 파일 받기';
  register.onclick = async () => {
    register.disabled = true;
    try {
      const result = await api('/api/print-client/register',{method:'POST',body:JSON.stringify({name:name.value})});
      try { localStorage.setItem('stock-print-client',result.id); } catch { /* This session remains paired. */ }
      const blob = new Blob([JSON.stringify({server:apiBase||location.origin,token:result.token},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url;link.download='connection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent = 'connection.json을 인쇄 연결 프로그램 폴더에 넣고 실행한 뒤 옵션을 다시 불러오세요.';
    } catch(error) { status.textContent=error.message; } finally {register.disabled=false;}
  };
  const download = document.createElement('button'); download.type='button';download.className='text-button';download.textContent='PC 인쇄 연결 프로그램 받기';
  download.onclick=async()=>{
    download.disabled=true;
    try{const response=await apiFetch('/api/print-client/download');if(!response.ok)throw Error('인쇄 프로그램을 받지 못했습니다.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='stock-print-client.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status.textContent=error.message;}finally{download.disabled=false;}
  };
  const actions=document.createElement('div');actions.className='print-client-actions';actions.append(register,download);
  box.append(heading,name,actions,status);container.prepend(box);
  let id;try{id=localStorage.getItem('stock-print-client');}catch{}
  const selected = id ? api('/api/print-client/select',{method:'POST',body:JSON.stringify({id})}) : Promise.resolve();
  void selected.then(()=>api('/api/print-client/status')).then(result=>{status.textContent=result.connected?`${result.name} · 연결됨`:'이 PC의 연결 프로그램을 실행하고 프린터를 선택해 주세요.';}).catch(error=>{status.textContent=error.message;});
}
