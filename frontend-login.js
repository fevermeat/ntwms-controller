import {api,apiBase,setApiSession} from './api.js';

export function connectFrontend() {
  let preferred;try{const saved=localStorage.getItem('stock-print-client');if(/^[a-f0-9]{32}$/.test(saved||''))preferred=saved;}catch{}
  const state=crypto.randomUUID();
  const target=new URL(apiBase+'/');target.searchParams.set('frontend_origin',location.origin);target.searchParams.set('frontend_state',state);
  const popup=window.open(target,'stock-wms-login','popup,width=620,height=820');
  if(!popup)throw Error('전산 로그인 창을 열 수 없습니다. 이 사이트의 팝업을 허용해 주세요.');
  return new Promise((resolve,reject)=>{
    const timer=setInterval(()=>{if(popup.closed)finish(Error('전산 로그인 창이 닫혔습니다. 다시 연결해 주세요.'));},500);
    const timeout=setTimeout(()=>finish(Error('로그인 확인 시간이 지났습니다. 다시 연결해 주세요.')),300000);
    const onMessage=async event=>{
      if(event.origin!==apiBase||event.source!==popup||event.data?.type!=='stock-frontend-login'||event.data.state!==state||!/^[a-f0-9]{64}$/.test(event.data.token||''))return;
      window.removeEventListener('message',onMessage);clearInterval(timer);clearTimeout(timeout);
      setApiSession(event.data.token);
      try{
        if(event.data.clientPrinting===true&&!document.documentElement.classList.contains('mobile-device')){
          const current=await api('/api/print-client/status');
          if((current.id||null)!==(preferred||null)){
            try{await api('/api/print-client/select',{method:'POST',body:JSON.stringify({id:preferred||null})});}
            catch(error){if(error.status!==404)throw error;try{localStorage.removeItem('stock-print-client');}catch{}await api('/api/print-client/select',{method:'POST',body:JSON.stringify({id:null})});}
          }
        }
        resolve(await api('/api/session'));
      }catch(error){reject(error);}
    };
    function finish(error){clearInterval(timer);clearTimeout(timeout);window.removeEventListener('message',onMessage);popup.close();reject(error);}
    window.addEventListener('message',onMessage);
  });
}

export async function completeFrontendLogin() {
  const query=new URLSearchParams(location.search),origin=query.get('frontend_origin'),state=query.get('frontend_state');
  if(!window.opener||!origin||!/^[a-f0-9-]{36}$/.test(state||''))return;
  const result=await api('/api/frontend-token',{method:'POST',body:JSON.stringify({origin})});
  const clientPrinting=typeof result.clientPrinting==='boolean'?result.clientPrinting:typeof (await api('/api/print-client/status').catch(()=>({}))).connected==='boolean';
  window.opener.postMessage({type:'stock-frontend-login',state,token:result.token,clientPrinting},origin);
  window.close();
}
