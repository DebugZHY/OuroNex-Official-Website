(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
  const sharedMotion = window.OuroMotion;
  const captions = {
    structure: 'Interdependent members. A system, not isolated parts.',
    knowledge: 'Engineering knowledge, connected to the work it informs.',
    workflow: 'Context → specialist tools → professional review.'
  };

  document.querySelectorAll('canvas[data-engineering-scene]').forEach(canvas => {
    if (canvas.dataset.rendered) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;
    const shell = canvas.closest('.scene-shell') || canvas.parentElement;
    const buttons = [...shell.querySelectorAll('[data-scene-mode]')];
    const pause = shell.querySelector('[data-scene-pause]');
    const caption = shell.querySelector('[data-scene-caption]');
    const label = shell.querySelector('[data-scene-label]');
    let width = 0, height = 0, dpr = 1;
    let mode = canvas.dataset.engineeringScene === 'network' ? 'knowledge' : 'structure';
    let manualPause = false, visible = true, raf = 0, lastTime = 0, phase = 0, modeAnimation = null;
    let yaw = -.42, pitch = .13, pointerX = 0, pointerY = 0;
    const vertices = [], edges = [], floors = [];
    const sides = 8, levels = 12;
    const edgeKeys = new Set();
    const addEdge = (a, b, kind) => {
      const key = [Math.min(a, b), Math.max(a, b)].join(':');
      if (!edgeKeys.has(key)) { edges.push({ a, b, kind }); edgeKeys.add(key); }
    };

    // A tapered, gently twisted diagrid provides one coherent structural system.
    for (let level = 0; level <= levels; level++) {
      const fraction = level / levels;
      const radius = 1.04 - fraction * .27 + Math.sin(fraction * Math.PI) * .1;
      const twist = fraction * .4;
      const ring = [];
      for (let side = 0; side < sides; side++) {
        const angle = side / sides * Math.PI * 2 + Math.PI / 8 + twist;
        const point = [Math.cos(angle) * radius, fraction * 3.8 - 1.9, Math.sin(angle) * radius];
        ring.push(vertices.length);
        vertices.push(point);
      }
      floors.push(ring);
    }
    floors.forEach((ring, level) => {
      ring.forEach((index, side) => {
        addEdge(index, ring[(side + 1) % sides], 'floor');
        if (level < levels) {
          addEdge(index, floors[level + 1][side], 'column');
          addEdge(index, floors[level + 1][(side + (level % 2 ? sides - 1 : 1)) % sides], 'brace');
        }
      });
    });

    const project = ([x, y, z], scale = 1) => {
      const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
      const rz = x * Math.sin(yaw) + z * Math.cos(yaw);
      const ry = y * Math.cos(pitch) - rz * Math.sin(pitch);
      const depth = y * Math.sin(pitch) + rz * Math.cos(pitch);
      const factor = 6.8 / (6.8 + depth);
      const unit = Math.min(width * .245, height * .173) * scale;
      return { x: width * .5 + rx * unit * factor, y: height * .48 - ry * unit * factor, z: depth, factor };
    };
    const stroke = (a, b, color, weight = 1, dash = []) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = weight;
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.setLineDash([]);
    };
    const dot = (point, radius, color) => {
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(point.x, point.y, radius, 0, Math.PI * 2); ctx.fill();
    };
    const annotation = (point, text, left) => {
      const x = left ? Math.max(18, point.x - 78) : Math.min(width - 100, point.x + 36);
      const y = point.y - 18;
      stroke(point, { x: left ? x + 64 : x - 7, y }, 'rgba(154,179,217,.42)', .7);
      ctx.font = '9px "IBM Plex Mono", monospace';
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = 'rgba(8,14,23,.9)';
      ctx.fillRect(x - 4, y - 16, textWidth + 8, 17);
      ctx.fillStyle = '#b8c9e1';
      ctx.textAlign = 'left'; ctx.fillText(text, x, y - 5);
    };

    function draw() {
      if (!width || !height) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const points = vertices.map(point => project(point));
      // Perspective ground lines anchor the object without a screen-filling glow.
      for (let i = -5; i <= 5; i++) {
        const alpha = .06 + (1 - Math.abs(i) / 6) * .045;
        stroke(project([i * .6, -1.96, -3]), project([i * .6, -1.96, 3]), `rgba(127,157,202,${alpha})`, .6);
        stroke(project([-3, -1.96, i * .6]), project([3, -1.96, i * .6]), `rgba(127,157,202,${alpha})`, .6);
      }
      const base = [[-1.4,-1.93,-1.4], [1.4,-1.93,-1.4], [1.4,-1.93,1.4], [-1.4,-1.93,1.4]].map(v => project(v));
      ctx.beginPath(); base.forEach((p,i) => i ? ctx.lineTo(p.x,p.y) : ctx.moveTo(p.x,p.y)); ctx.closePath();
      ctx.fillStyle = 'rgba(92,132,194,.045)'; ctx.fill();
      base.forEach((p,i) => stroke(p, base[(i+1)%base.length], 'rgba(144,172,214,.28)', .85));

      if (mode === 'structure') {
        floors.filter((_, i) => i % 3 === 0).forEach(ring => {
          ctx.beginPath(); ring.forEach((n,i) => i ? ctx.lineTo(points[n].x,points[n].y) : ctx.moveTo(points[n].x,points[n].y)); ctx.closePath();
          ctx.fillStyle = 'rgba(126,164,226,.018)'; ctx.fill();
        });
      }
      const sorted = edges.slice().sort((a,b) => (points[b.a].z + points[b.b].z) - (points[a.a].z + points[a.b].z));
      sorted.forEach(edge => {
        const a = points[edge.a], b = points[edge.b];
        const front = 1 - Math.min(1, Math.max(0, ((a.z + b.z) / 2 + 1.6) / 3.2));
        const alpha = (mode === 'structure' ? .17 : .07) + front * (mode === 'structure' ? .6 : .2);
        const color = edge.kind === 'brace' ? `rgba(117,162,235,${alpha})` : `rgba(193,210,237,${alpha * .86})`;
        stroke(a,b,color,edge.kind === 'column' ? 1.05 : .75);
      });
      points.forEach((p,i) => {
        if (i % 2 === 0) dot(p, p.z < 0 ? 1.55 : 1, `rgba(192,215,249,${p.z < 0 ? .8 : .24})`);
      });

      if (mode === 'knowledge') {
        const anchors = [floors[2][1], floors[5][3], floors[9][5], floors[11][0]];
        const centre = project([0, .1, 0]);
        anchors.forEach((n,i) => {
          const p = points[n];
          stroke(p, centre, 'rgba(126,172,254,.72)', 1.1, [3,5]);
          ctx.strokeStyle = 'rgba(114,158,255,.52)'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x,p.y,7,0,Math.PI*2); ctx.stroke();
          dot(p,2.6,'#b1ceff');
          if (width > 360) annotation(p, ['CONTEXT','KNOWLEDGE','REFERENCES','REVIEW'][i], i % 2 === 0);
        });
        dot(centre,4,'#a6c7ff');
      } else if (mode === 'workflow') {
        const route = [floors[0][1],floors[3][2],floors[6][2],floors[9][3],floors[12][3]];
        route.forEach((n,i) => {
          dot(points[n],3,'#c4d8fa');
          if (i) {
            const a = points[route[i-1]], b = points[n];
            stroke(a,b,'rgba(145,183,247,.9)',1.6);
            const t = (phase * .18 + i * .23) % 1;
            dot({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t},2.4,'#f0f6ff');
          }
        });
        if (width > 360) {
          annotation(points[route[0]],'PROJECT INPUT',true);
          annotation(points[route[2]],'SPECIALIST TOOLS',false);
          annotation(points[route[4]],'ENGINEER REVIEW',true);
        }
      } else {
        const highlight = edges.filter(e => e.kind === 'brace' && e.a % sides === 2);
        highlight.forEach(edge => stroke(points[edge.a],points[edge.b],'rgba(142,188,255,.78)',1.25));
        if (width > 390) {
          annotation(points[floors[9][1]],'DIAGRID',false);
          annotation(points[floors[2][4]],'CONNECTED SYSTEM',true);
        }
      }
      // Small coordinate ticks belong to the drawing rather than imitating product telemetry.
      const origin = { x: width - 46, y: height - 44 };
      stroke(origin,{x:origin.x+20,y:origin.y},'rgba(150,176,214,.55)',.8);
      stroke(origin,{x:origin.x,y:origin.y-22},'rgba(150,176,214,.55)',.8);
      stroke(origin,{x:origin.x-12,y:origin.y+9},'rgba(150,176,214,.4)',.8);
      ctx.font = '8px "IBM Plex Mono",monospace'; ctx.fillStyle = '#8599b6';
      ctx.fillText('X',origin.x+23,origin.y+3);
      ctx.fillText('Y',origin.x-22,origin.y+18);
      ctx.fillText('Z',origin.x-3,origin.y-26);
      canvas.dataset.rendered = 'true';
    }

    function isPaused() { return manualPause || reduced.matches || (sharedMotion && !sharedMotion.enabled); }
    function updateControls() {
      shell.dataset.mode = mode;
      shell.dataset.motion = isPaused() ? 'paused' : 'running';
      buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.sceneMode === mode)));
      if (pause) {
        pause.setAttribute('aria-pressed', String(isPaused()));
        pause.textContent = reduced.matches ? 'Reduced motion' : sharedMotion && !sharedMotion.enabled ? 'Motion paused' : manualPause ? 'Resume diagram' : 'Pause diagram';
        pause.disabled = reduced.matches || Boolean(sharedMotion && !sharedMotion.enabled);
      }
      if (caption) caption.textContent = captions[mode];
      if (label) label.textContent = mode === 'structure' ? 'Structural system' : mode === 'knowledge' ? 'Domain knowledge' : 'Engineering workflow';
    }
    function cancel() { if (raf) cancelAnimationFrame(raf); raf = 0; lastTime = 0; }
    function start() {
      modeAnimation?.cancel(); modeAnimation = null;
      cancel(); updateControls(); draw();
      if (visible && !document.hidden && !isPaused()) {
        if (sharedMotion) sharedMotion.request();
        else raf = requestAnimationFrame(frame);
      }
    }
    function frame(time) {
      raf = 0;
      if (!visible || document.hidden || isPaused()) { lastTime = 0; return false; }
      if (!lastTime) lastTime = time;
      const elapsed = Math.min((time-lastTime)/1000,.1);
      if (elapsed >= 1/32) {
        phase += elapsed; lastTime = time;
        const targetYaw = -.42 + Math.sin(phase*.13)*.1 + pointerX*.11;
        const targetPitch = .13 + pointerY*.055;
        yaw += (targetYaw-yaw)*.06; pitch += (targetPitch-pitch)*.06;
        draw();
      }
      if (!sharedMotion) raf = requestAnimationFrame(frame);
      return true;
    }
    function resize() {
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1,1.75);
      canvas.width = Math.round(width*dpr); canvas.height = Math.round(height*dpr);
      start();
    }
    buttons.forEach(button => button.addEventListener('click', () => {
      if (!Object.hasOwn(captions,button.dataset.sceneMode)) return;
      if (mode === button.dataset.sceneMode) return;
      mode = button.dataset.sceneMode; start();
      if (!isPaused() && canvas.animate) {
        modeAnimation = canvas.animate([{ opacity: .52 }, { opacity: 1 }], { duration: 480, easing: 'cubic-bezier(.16,1,.3,1)' });
      }
    }));
    pause?.addEventListener('click', () => { if (!reduced.matches) { manualPause = !manualPause; start(); } });
    canvas.addEventListener('pointermove', event => {
      if (!finePointer.matches || isPaused()) return;
      const rect = canvas.getBoundingClientRect();
      pointerX = (event.clientX-rect.left)/rect.width-.5;
      pointerY = (event.clientY-rect.top)/rect.height-.5;
    }, { passive:true });
    canvas.addEventListener('pointerleave', () => { pointerX=0; pointerY=0; });
    reduced.addEventListener('change', () => { pointerX=0; pointerY=0; start(); });
    document.addEventListener('ouronex:motion-state', start);
    document.addEventListener('visibilitychange', start);
    window.addEventListener('pagehide', cancel);
    window.addEventListener('pageshow', start);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => { visible=entries[0].isIntersecting; start(); }, { threshold:0 }).observe(canvas);
    }
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize',resize);
    sharedMotion?.subscribe(frame);
    resize();
  });
})();
