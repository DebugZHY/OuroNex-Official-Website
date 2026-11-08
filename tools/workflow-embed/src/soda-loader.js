const assetBase = new URL('.', document.currentScript?.src || document.baseURI);
let pending;

export const deliverableUrls = Object.freeze({
  modelUrl: new URL('../models/transmission-tower.glb', assetBase).href,
  compressedModelUrl: new URL('../models/transmission-tower.glb.gz', assetBase).href,
  metadataUrl: new URL('../models/transmission-tower.meta.json', assetBase).href,
});

export function prepareModelView() {
  if (pending) return pending;
  pending = Promise.all([
    new Promise((resolve, reject) => {
      if (document.querySelector('link[data-soda-model-style="ready"]')) return resolve();
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = new URL('soda-viewer.css', assetBase).href;
      link.dataset.sodaModelStyle = 'loading';
      link.onload = () => { link.dataset.sodaModelStyle = 'ready'; resolve(); };
      link.onerror = () => { link.remove(); reject(new Error('The model view stylesheet could not be loaded.')); };
      document.head.append(link);
    }),
    new Promise((resolve, reject) => {
      if (window.SODAModelView?.mount) return resolve();
      const script = document.createElement('script');
      script.src = new URL('soda-viewer.js', assetBase).href; script.async = true;
      script.onload = () => window.SODAModelView?.mount ? resolve() : reject(new Error('The model viewer is unavailable.'));
      script.onerror = () => { script.remove(); reject(new Error('The model viewer could not be loaded.')); };
      document.head.append(script);
    }),
  ]).then(() => window.SODAModelView).catch(error => { pending = undefined; throw error; });
  return pending;
}
