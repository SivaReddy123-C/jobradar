async function refresh() { const response = await chrome.runtime.sendMessage({action:'STATUS'}); const s = response.result; document.getElementById('status').textContent = response.error || ((s.active ? 'Running. ' : 'Stopped. ') + s.entries.filter(e=>e.status==='confirmed').length + ' confirmed; ' + s.entries.filter(e=>e.status==='submission_uncertain').length + ' uncertain.'); }
document.getElementById('stop').addEventListener('click',async()=>{await chrome.runtime.sendMessage({action:'STOP'}); await refresh();});
refresh();
