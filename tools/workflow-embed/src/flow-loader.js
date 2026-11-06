const assetBase = new URL('.', document.currentScript?.src || document.baseURI);
let pending;

export function prepareFlow() {
  if (pending) return pending;
  pending = Promise.all([
    new Promise((resolve, reject) => {
      if (document.querySelector('link[data-sida-flow-style="ready"]')) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL('flow.css', assetBase).href;
      link.dataset.sidaFlowStyle = 'loading';
      link.onload = () => { link.dataset.sidaFlowStyle = 'ready'; resolve(); };
      link.onerror = () => { link.remove(); reject(new Error('The workflow stylesheet could not be loaded.')); };
      document.head.append(link);
    }),
    new Promise((resolve, reject) => {
      if (window.SIDAFlow?.mount) return resolve(window.SIDAFlow);
      const script = document.createElement('script');
      script.src = new URL('flow.js', assetBase).href;
      script.async = true;
      script.onload = () => window.SIDAFlow?.mount ? resolve(window.SIDAFlow) : reject(new Error('The workflow is unavailable.'));
      script.onerror = () => { script.remove(); reject(new Error('The workflow could not be loaded.')); };
      document.head.append(script);
    }),
  ]).then(() => window.SIDAFlow).catch((error) => { pending = undefined; throw error; });
  return pending;
}
