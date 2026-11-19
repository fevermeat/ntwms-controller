import {apiFetch,apiBase} from './api.js';
const mobile=()=>/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)||navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1;
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
export function mountPrintClient(container,api,onConnected=()=>{},{loadedDeviceId}={}){
 if(mobile())return;
 let id;try{id=localStorage.getItem('stock-print-client');}catch{}
 let devices=[],current={},initialized=false,connecting=false,refreshing,deviceSignature='';
 const box=node('details');box.className='print-client-setup';box.open=true;box.append(node('summary','이 PC 인쇄 연결'));
 const pc=node('select');pc.setAttribute('aria-label','연결할 PC');const pcLabel=node('label','연결할 PC');pcLabel.append(pc);
 const connect=node('a','인쇄 프로그램 연결하기');connect.className='primary';connect.href='ntwms-print://connect';
 const status=node('p');status.className='print-client-state';status.setAttribute('role','status');
 const advanced=node('details');advanced.className='print-client-install';advanced.append(node('summary','처음 설치 · 다른 PC 등록'));
 const name=node('input');name.placeholder='예: 사무실 김완석 PC';name.maxLength=80;name.setAttribute('aria-label','새 PC 이름');
 const register=node('button','새 PC 등록 파일 받기');register.type='button';register.className='text-button';
 const download=node('button','인쇄 프로그램 받기');download.type='button';download.className='text-button';
 const help=node('p','이미 설치한 PC는 위에서 이름을 선택하고 연결만 누르세요. 처음 설치할 때만 프로그램과 연결 파일을 받아 압축을 푼 폴더에 connection.json을 넣고 install.cmd를 한 번 실행합니다.');help.className='muted small';
 const installStatus=node('p');installStatus.setAttribute('role','status');const nameLabel=node('label','새 PC 이름');nameLabel.append(name);advanced.append(nameLabel,register,download,installStatus,help);
 const actions=node('div');actions.className='print-client-actions';actions.append(connect);box.append(pcLabel,actions,status,advanced);container.prepend(box);
 const remember=value=>{id=value;try{localStorage.setItem('stock-print-client',value);}catch{}};
 const chosen=()=>devices.find(d=>d.id===pc.value);
 function buttonState(){const d=chosen();pc.disabled=connecting;connect.setAttribute('aria-disabled',String(connecting));connect.textContent=connecting?'연결 확인 중…':d?.connected?(current.id===d.id&&id===d.id?'프린터 연결 확인':'이 PC에 연결'):'인쇄 프로그램 실행·연결';}
 function describe(){const d=chosen();let text;if(d&&current.id===d.id&&current.connected&&id===d.id){status.dataset.state='connected';text=`${d.name}${d.computerName?' · '+d.computerName:''} · 연결됨\n프린터 ${d.printerCount}대${d.busy?' · 인쇄 중':''}`;}else{status.dataset.state='waiting';text=d?.connected?`${d.name}${d.computerName?' · '+d.computerName:''} · 프로그램 실행 중\n위 연결 버튼을 누르면 이 PC로 인쇄합니다.`:d?'프로그램이 연결되지 않았습니다. 위 버튼으로 실행하고 다시 확인하세요.':'연결할 PC를 확인 중입니다. 이미 설치했다면 위 버튼으로 프로그램을 실행하세요.';}if(status.textContent!==text)status.textContent=text;}
 function paint(){const previous=pc.value,online=devices.filter(d=>d.connected),visible=devices.filter(d=>d.connected||d.id===id||d.id===current.id||d.id===previous).sort((a,b)=>Number(b.connected)-Number(a.connected));
  const wanted=initialized&&visible.some(d=>d.id===previous)?previous:online.some(d=>d.id===id)?id:online.length===1?online[0].id:visible.some(d=>d.id===id)?id:'';
  const signature=JSON.stringify(visible);if(signature!==deviceSignature||!initialized){pc.replaceChildren(new Option(visible.length?'연결할 PC 선택':'연결된 PC 없음',''));for(const d of visible)pc.add(new Option(`${d.name}${d.computerName?' · '+d.computerName:''} · ${d.connected?'실행 중 · 프린터 '+d.printerCount+'대':'연결 끊김'}`,d.id));pc.value=wanted;deviceSignature=signature;}initialized=true;buttonState();if(!connecting)describe();if(!devices.length)advanced.open=true;
 }
 function refresh(){if(refreshing)return refreshing;refreshing=Promise.all([api('/api/print-client/devices'),api('/api/print-client/status')]).then(([data,state])=>{devices=data.devices;current=state;paint();return state;}).finally(()=>{refreshing=null;});return refreshing;}
 pc.onchange=()=>{buttonState();describe();};
 connect.onclick=event=>{
  const target=pc.value,d=chosen();if(connecting||d?.connected)event.preventDefault();if(connecting)return;
  connecting=true;buttonState();status.textContent=d?.connected?'이 PC와 프린터를 확인합니다.':'설치된 인쇄 프로그램을 실행합니다. 브라우저의 앱 열기 안내가 나오면 열기를 눌러 주세요.';
  void(async()=>{try{
   if(target){const state=await api('/api/print-client/status');if(state.id!==target)await api('/api/print-client/select',{method:'POST',body:JSON.stringify({id:target})});}
   const deadline=Date.now()+45000;
   while(box.isConnected&&Date.now()<deadline){const state=await refresh();if(!box.isConnected)return;
    if(target&&state.id===target&&state.connected){remember(target);describe();onConnected();return;}
    const online=devices.filter(p=>p.connected);if(online.length&&!online.some(p=>p.id===target)){pc.value=online.length===1?online[0].id:'';status.textContent='실행된 PC가 확인됐습니다. PC 이름을 확인한 뒤 연결 버튼을 한 번 눌러 주세요.';return;}
    await new Promise(resolve=>setTimeout(resolve,1000));
   }
   if(box.isConnected)status.textContent='프로그램을 확인하지 못했습니다. 처음 설치한 PC라면 아래 처음 설치 안내를 확인하세요. 이미 설치했다면 프로그램 폴더와 Windows 앱 열기 허용을 확인해 주세요.';
  }catch(error){if(box.isConnected)status.textContent=error.message;}finally{connecting=false;buttonState();}})();
 };
 register.onclick=async()=>{register.disabled=true;try{const result=await api('/api/print-client/register',{method:'POST',body:JSON.stringify({name:name.value})});remember(result.id);const blob=new Blob([JSON.stringify({server:apiBase||location.origin,token:result.token},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='connection.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);await refresh();pc.value=result.id;installStatus.textContent='받은 connection.json을 프로그램 폴더에 넣고 install.cmd를 한 번 실행하세요. 다음부터는 위 연결 버튼만 누르면 됩니다.';}catch(error){installStatus.textContent=error.message;}finally{register.disabled=false;buttonState();}};
 download.onclick=async()=>{download.disabled=true;try{const response=await apiFetch('/api/print-client/download');if(!response.ok)throw Error('인쇄 프로그램을 받지 못했습니다.');const url=URL.createObjectURL(await response.blob()),link=node('a');link.href=url;link.download='stock-print-client.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){installStatus.textContent=error.message;}finally{download.disabled=false;}};
 const initial=id?api('/api/print-client/select',{method:'POST',body:JSON.stringify({id})}).catch(error=>{if(![404,409].includes(error.status))throw error;}):Promise.resolve();
 void initial.then(refresh).then(state=>{if(loadedDeviceId&&state.connected&&state.id===id&&loadedDeviceId!==id)onConnected();}).catch(error=>{status.textContent=error.message;});
 const monitor=setInterval(()=>{if(!box.isConnected){clearInterval(monitor);return;}if(box.open&&!box.closest('[hidden]')&&!box.parentElement.closest('details:not([open])')&&!connecting&&document.visibilityState!=='hidden')void refresh().catch(error=>{status.textContent=error.message;});},10000);
 box.ontoggle=()=>{if(box.open&&initialized&&!connecting)void refresh().catch(error=>{status.textContent=error.message;});};
}
