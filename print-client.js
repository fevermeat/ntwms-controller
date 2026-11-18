import {apiFetch,apiBase} from './api.js';
const mobile = () => /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
export function mountPrintClient(container, api, onConnected = () => {}) {
  if (mobile()) return;
  let id;try{id=localStorage.getItem('stock-print-client');}catch{}
  const box = document.createElement('details'); box.className='print-client-setup';
  const heading = document.createElement('summary'); heading.textContent = '이 PC 인쇄 연결';
  const name = document.createElement('input'); name.placeholder = '예: 사무실 김완석 PC'; name.maxLength = 80; name.setAttribute('aria-label','PC 이름');
  const status = document.createElement('p'); status.className='muted small'; status.setAttribute('role','status');
  const register = document.createElement('button'); register.type = 'button'; register.className='text-button'; register.textContent = '이 PC 연결 파일 받기';
  register.onclick = async () => {
    register.disabled = true;
    try {
      const result = await api('/api/print-client/register',{method:'POST',body:JSON.stringify({name:name.value})});
      id = result.id;
      try { localStorage.setItem('stock-print-client',result.id); } catch { /* This session remains paired. */ }
      const blob = new Blob([JSON.stringify({server:apiBase||location.origin,token:result.token},null,2)],{type:'application/json'});
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href=url;link.download='connection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status.textContent = 'connection.json을 프로그램 폴더에 넣고 install.cmd를 한 번 실행한 뒤 연결하기를 누르세요.';
    } catch(error) { status.textContent=error.message; } finally {register.disabled=false;}
  };
  const download = document.createElement('button'); download.type='button';download.className='text-button';download.textContent='PC 인쇄 연결 프로그램 받기';
  download.onclick=async()=>{
    download.disabled=true;
    try{const response=await apiFetch('/api/print-client/download');if(!response.ok)throw Error('인쇄 프로그램을 받지 못했습니다.');const url=URL.createObjectURL(await response.blob()),link=document.createElement('a');link.href=url;link.download='stock-print-client.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){status.textContent=error.message;}finally{download.disabled=false;}
  };
  const connect=document.createElement('a');connect.className='primary';connect.href='ntwms-print://connect';connect.textContent='연결하기';
  let connecting=false;
  connect.onclick=event=>{
    if(connecting||!id){event.preventDefault();if(!id)status.textContent='PC 이름을 입력하고 이 PC 연결 파일을 먼저 받아 주세요.';return;}
    connecting=true;connect.setAttribute('aria-disabled','true');connect.textContent='연결 확인 중…';
    status.textContent='인쇄 프로그램을 실행합니다. 브라우저에 앱 실행 확인창이 나오면 열기를 눌러 주세요.';
    void (async()=>{
      const deadline=Date.now()+30000;
      try{
        while(box.isConnected&&Date.now()<deadline){
          const result=await api('/api/print-client/status');if(!box.isConnected)return;
          if(result.connected&&result.id===id){status.textContent=`${result.name} · 연결됨`;onConnected();return;}
          await new Promise(resolve=>setTimeout(resolve,1000));
        }
        if(box.isConnected)status.textContent='연결되지 않았습니다. 프로그램 설치 폴더의 install.cmd를 한 번 실행하고, 브라우저의 앱 열기를 허용한 뒤 다시 눌러 주세요.';
      }catch(error){if(box.isConnected)status.textContent=error.message;}
      finally{connecting=false;connect.removeAttribute('aria-disabled');connect.textContent='연결하기';}
    })();
  };
  const help=document.createElement('p');help.className='muted small';help.textContent='처음 한 번 install.cmd로 설치하면 연결하기에서 프로그램 실행과 프린터 목록 갱신까지 진행합니다.';
  const actions=document.createElement('div');actions.className='print-client-actions';actions.append(connect,register,download);
  box.append(heading,name,actions,status,help);container.prepend(box);
  const selected = id ? api('/api/print-client/select',{method:'POST',body:JSON.stringify({id})}) : Promise.resolve();
  void selected.then(()=>api('/api/print-client/status')).then(result=>{status.textContent=result.connected?`${result.name} · 연결됨`:'이 PC의 연결 프로그램을 실행하고 프린터를 선택해 주세요.';}).catch(error=>{status.textContent=error.message;});
}
