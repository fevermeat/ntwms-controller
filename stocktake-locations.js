import {api,apiFetch} from './api.js';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);n.className=cls;if(text!=null)n.textContent=text;return n;};
export function createStocktakeLocations({panel,context,setBusy,isBusy,onConfig,onImported}){
 const details=el('details',null,'stocktake-location-settings');details.append(el('summary','로케이션 엑셀 등록'));
 const help=el('p','화주코드 / 화주명 / 로케이션을 한 행씩 입력하세요. 화주를 비우면 현재 선택한 화주로 등록합니다.','muted small'),tools=el('div',null,'stocktake-location-tools'),template=el('button','엑셀 양식 받기','picking-button'),choose=el('button','엑셀 파일 선택','picking-button'),files=el('input'),status=el('p',null,'stocktake-location-status'),preview=el('div',null,'stocktake-location-preview'),apply=el('button','확인한 로케이션 추가','primary');
 template.type=choose.type=apply.type='button';files.type='file';files.accept='.xlsx';files.hidden=true;files.setAttribute('aria-label','로케이션 등록 엑셀');tools.append(template,choose,files);details.append(help,tools,status,preview,apply);panel.append(details);
 let generation=0,working=false,pending=null;
 const path=action=>'/api/stocktake/locations'+action+'?owner='+encodeURIComponent(context().owner);
 function sync(){template.disabled=choose.disabled=working||isBusy();apply.disabled=working||isBusy()||!pending?.summary.some(s=>s.added>0);apply.hidden=!pending;}
 async function refresh(){const rev=generation;try{const result=await api(path(''));if(rev===generation)onConfig(result);}catch(e){if(rev===generation)status.textContent=e.message;}}
 template.onclick=async()=>{if(working||isBusy())return;working=true;setBusy(true);try{const r=await apiFetch(path('/template'));if(!r.ok){const d=await r.json();throw Error(d.error||'양식을 받지 못했습니다.');}const url=URL.createObjectURL(await r.blob()),a=el('a');a.href=url;a.download='화주별_로케이션_등록양식.xlsx';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){status.textContent=e.message;}finally{working=false;setBusy(false);sync();}};
 choose.onclick=()=>files.click();
 files.onchange=async()=>{const file=files.files[0];if(!file||working||isBusy())return;const rev=generation;pending=null;preview.replaceChildren();working=true;setBusy(true);status.textContent='엑셀의 화주·로케이션을 확인하고 있습니다…';
  try{
   if(!/\.xlsx$/i.test(file.name)||file.size>4*1024*1024)throw Error('4MB 이하의 .xlsx 파일을 선택해 주세요.');
   const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('엑셀 파일을 읽지 못했습니다.'));reader.readAsDataURL(file);});
   const result=await api(path('/preview'),{method:'POST',body:JSON.stringify({data})});if(rev!==generation)return;pending=result;
   const table=el('table'),head=el('tr');for(const text of ['화주','추가','이미 등록','등록 후 전체'])head.append(el('th',text));table.append(head);for(const row of result.summary){const tr=el('tr');for(const value of [`${row.name} (${row.owner})`,row.added,row.existing,row.total])tr.append(el('td',String(value)));table.append(tr);}preview.append(table);
   status.textContent=result.summary.some(s=>s.added>0)?`추가할 목록을 확인하고 등록해 주세요.${result.duplicate?' 파일 내 중복 '+result.duplicate+'행 제외.':''}`:'모든 로케이션이 이미 등록되어 있습니다.';
  }catch(e){if(rev===generation)status.textContent=e.message;}finally{files.value='';working=false;setBusy(false);sync();}
 };
 apply.onclick=async()=>{if(!pending||working||isBusy())return;const rev=generation;let saved=false;working=true;setBusy(true);status.textContent='화주별 로케이션을 저장하고 있습니다…';
  try{const result=await api(path('/apply'),{method:'POST',body:JSON.stringify({id:pending.id})});if(rev!==generation)return;pending=null;saved=true;status.textContent=`등록 완료 · ${result.summary.map(s=>s.name+' '+s.added+'셀 추가').join(' · ')}`;preview.replaceChildren();await refresh();}
  catch(e){if(rev===generation)status.textContent=e.message;}finally{working=false;setBusy(false);sync();}if(saved&&rev===generation)await onImported();
 };
 sync();return {sync,refresh,connect(){generation++;pending=null;preview.replaceChildren();status.textContent='';sync();void refresh();},reset(){generation++;pending=null;working=false;preview.replaceChildren();status.textContent='';files.value='';sync();}};
}
