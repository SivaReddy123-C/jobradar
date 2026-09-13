export function extensionRequest<T>(action: string, payload?: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { window.removeEventListener("message", receive); reject(new Error("JobRadar Assist is not responding. Load extension/dist in Chrome, then reload this app.")); }, 7000);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.channel !== "jobradar-response" || event.data.id !== id) return;
      clearTimeout(timer); window.removeEventListener("message", receive);
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: "jobradar-request", id, action, payload }, location.origin);
  });
}
