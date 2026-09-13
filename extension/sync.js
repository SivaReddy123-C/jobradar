// Runs only on JobRadar's configured app origins. Page text never issues runner commands.
window.addEventListener('message', async (event) => {
  if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'jobradar-request') return;
  const { id, action, payload } = event.data;
  if (typeof id !== 'string' || !['STATUS','RUN','STOP','ERASE'].includes(action)) return;
  try {
    const response = await chrome.runtime.sendMessage({ action, payload });
    window.postMessage({ channel:'jobradar-response', id, ...response }, location.origin);
  } catch { window.postMessage({ channel:'jobradar-response', id, error:'Reload this page to reconnect JobRadar Assist.' }, location.origin); }
});
