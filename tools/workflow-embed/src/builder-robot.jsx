import { useEffect, useRef, useState } from 'preact/hooks';
import fallbackMark from './sida-mark.png';

const bundleBase = document.currentScript?.src || document.baseURI;
const rendererUrl = new URL('welcome-robot.js', bundleBase).href;
const fallbackUrl = new URL(fallbackMark, bundleBase).href;
let rendererPromise;

function loadRenderer() {
  if (window.SIDAWelcomeRobot) return Promise.resolve(window.SIDAWelcomeRobot);
  if (!rendererPromise) rendererPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = rendererUrl;
    script.onload = () => resolve(window.SIDAWelcomeRobot);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return rendererPromise;
}

export function BuilderRobot({ size = 224 }) {
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    let cleanup;
    setReady(false);
    loadRenderer().then((renderer) => {
      if (!disposed) cleanup = renderer.mount(canvasRef.current, size, () => {
        if (!disposed) setReady(true);
      });
    }).catch(() => {});
    return () => { disposed = true; cleanup?.(); };
  }, [size]);
  return (
    <span class="we-welcome-mark" style={{ width: size, height: size }} data-welcome-robot={ready ? 'ready' : 'loading'}>
      {!ready && <img class="we-welcome-fallback" src={fallbackUrl} alt="" width="224" height="224"
        draggable={false} />}
      <canvas ref={canvasRef} tabIndex={ready ? 0 : -1} role="img"
        aria-label="SIDA 3D logo. Use arrow keys to rotate."
        draggable={false} />
    </span>
  );
}
