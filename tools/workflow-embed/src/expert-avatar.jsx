import { useEffect, useRef } from 'react';

const runtimes = new Map();

/* Use the already resolved resource URL, so homepage, standalone and subpath mounts agree.
   The variable import stays a native runtime import in the parent's IIFE build: the canonical
   implementation and its CSS/SVGs remain static features assets, never bundled copies. */
export function sharedAvatarModuleURL(portraitURL, baseURL) {
  return new URL('../../expert-avatars.js', new URL(portraitURL, baseURL)).href;
}

function loadRuntime(portraitURL, doc) {
  const url = sharedAvatarModuleURL(portraitURL, doc.baseURI);
  if (!runtimes.has(url)) {
    runtimes.set(url, import(url).catch(error => {
      runtimes.delete(url);
      throw error;
    }));
  }
  return runtimes.get(url);
}

export function ExpertAvatar({ expert, state }) {
  const host = useRef(null);
  const controller = useRef(null);
  const latestState = useRef(state);
  latestState.current = state;

  useEffect(() => {
    const element = host.current;
    let disposed = false;
    let avatar;
    // A real canonical SVG also serves as the fallback if the runtime request fails.
    const fallback = element.ownerDocument.createElement('img');
    fallback.src = expert.src;
    fallback.alt = '';
    fallback.setAttribute('aria-hidden', 'true');
    element.replaceChildren(fallback);
    element.setAttribute('data-avatar-ready', 'loading');
    loadRuntime(expert.src, element.ownerDocument).then(runtime => {
      if (disposed) return;
      avatar = runtime.mountExpertAvatar(element, { id: expert.id, state: latestState.current });
      controller.current = avatar;
      return avatar.ready;
    }).catch(error => {
      if (!disposed) {
        element.setAttribute('data-avatar-ready', 'error');
        console.warn('Shared expert avatar unavailable; keeping the static portrait.', error);
      }
    });
    return () => {
      disposed = true;
      avatar?.destroy();
      controller.current = null;
    };
  }, [expert.id, expert.src]);

  useEffect(() => { controller.current?.setState(state); }, [state]);

  return <span ref={host} className="we-stage-expert" data-expert={expert.id}
    data-avatar-state={state} role="img" aria-label={expert.name} title={expert.name} />;
}
