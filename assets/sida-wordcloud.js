/* Word cloud for the Information Management panel.

   The vocabulary is the Buildings Department's “Codes, design manuals and
   guidelines” index together with the section headings and recurring terms of
   those documents. Every document keeps its official title in a <title> node, so
   hovering a short label still names the full publication.

   Layout follows the react-d3-cloud arrangement: weights become font sizes, the
   heaviest word takes the centre, and the rest walk an Archimedean spiral until
   a free slot is found. Words are either horizontal or turned a quarter turn, so
   every bounding box stays axis aligned and collisions stay exact.
*/
(function () {
  'use strict';

  var HOST_SELECTOR = '[data-sida-wordcloud]';
  var FALLBACK_CLASS = 'sida-wordcloud__fallback';
  var MAX_STEPS = 4200;
  var SPIRAL_STEP = 1.9;
  var SPIRAL_TURN = 0.22;
  var GAP_X = 9;
  var GAP_Y = 9;

  /* kind: code = code of practice, manual = design manual, guide = guideline,
     term = heading or recurring term inside those documents. */
  var WORDS = [
    { text: 'Structural Use of Concrete', weight: 10, kind: 'code', title: 'Code of Practice for the Structural Use of Concrete 2013 (2020 Edition)' },
    { text: 'Structural Use of Steel', weight: 10, kind: 'code', title: 'Code of Practice for the Structural Use of Steel 2011 (2023 Edition)' },
    { text: 'Wind Effects in Hong Kong', weight: 9, kind: 'code', title: 'Code of Practice on Wind Effects in Hong Kong 2019' },
    { text: 'Dead and Imposed Loads', weight: 9, kind: 'code', title: 'Code of Practice for Dead and Imposed Loads 2011 (2021 Edition)' },
    { text: 'Foundations', weight: 8, kind: 'code', title: 'Code of Practice for Foundations 2017 (2024 Edition)' },
    { text: 'Fire Safety in Buildings', weight: 8, kind: 'code', title: 'Code of Practice for Fire Safety in Buildings 2011 (2024 Edition)' },
    { text: 'Precast Concrete Construction', weight: 6, kind: 'code', title: 'Code of Practice for Precast Concrete Construction 2016' },
    { text: 'Structural Use of Glass', weight: 6, kind: 'code', title: 'Code of Practice for Structural Use of Glass 2018' },
    { text: 'Means of Escape in Case of Fire', weight: 6, kind: 'code', title: 'Code of Practice for the Provision of Means of Escape in Case of Fire 1996' },
    { text: 'Barrier Free Access', weight: 6, kind: 'manual', title: 'Design Manual - Barrier Free Access 2008 (2025 Edition)' },
    { text: 'Site Supervision', weight: 5, kind: 'code', title: 'Code of Practice for Site Supervision 2009 (2024 Edition)' },
    { text: 'Demolition of Buildings', weight: 5, kind: 'code', title: 'Code of Practice for Demolition of Buildings 2004' },
    { text: 'Building Works for Lifts and Escalators', weight: 5, kind: 'code', title: 'Code of Practice for Building Works for Lifts and Escalators 2011 (2020 Edition)' },
    { text: 'Access for External Maintenance', weight: 5, kind: 'code', title: 'Code of Practice on Access for External Maintenance 2021 (2024 Edition)' },
    { text: 'Mandatory Building Inspection Scheme', weight: 5, kind: 'code', title: 'Code of Practice for the Mandatory Building Inspection Scheme and the Mandatory Window Inspection Scheme 2012 (2023 Edition)' },
    { text: 'Means of Access for Firefighting and Rescue', weight: 4, kind: 'code', title: 'Code of Practice for the Provision of Means of Access for Firefighting and Rescue 2004' },
    { text: 'Fire Resisting Construction', weight: 4, kind: 'code', title: 'Code of Practice for Fire Resisting Construction 1996' },
    { text: 'Technical Memorandum for Supervision Plans', weight: 4, kind: 'code', title: 'Technical Memorandum for Supervision Plans 2009' },
    { text: 'Universal Accessibility', weight: 4, kind: 'manual', title: 'Design Manual on Universal Accessibility 2026' },
    { text: 'Energy Efficiency of Residential Buildings', weight: 4, kind: 'guide', title: 'Guidelines on Design and Construction Requirements for Energy Efficiency of Residential Buildings 2014' },
    { text: 'Minor Works Control System', weight: 5, kind: 'guide', title: 'General Guidelines on Minor Works Control System' },
    { text: 'Technical Guidelines on Minor Works', weight: 3, kind: 'guide', title: 'Technical Guidelines on Minor Works Control System (2024 Edition)' },
    { text: 'Adaptive Re-use of Heritage Buildings', weight: 4, kind: 'guide', title: 'Practice Guidebook for Adaptive Re-use of and Alteration and Addition Works to Heritage Buildings 2012 (2021 Edition)' },
    { text: 'Design and Construction of Bamboo Scaffolds', weight: 4, kind: 'guide', title: 'Guidelines on the Design and Construction of Bamboo Scaffolds' },
    { text: 'Building Maintenance Guidebook', weight: 4, kind: 'guide', title: 'Building Maintenance Guidebook' },
    { text: 'Prevention of Water Seepage', weight: 4, kind: 'guide', title: 'Guidelines on Prevention of Water Seepage in New Buildings' },
    { text: 'Drainage System and Sanitary Fitments', weight: 3, kind: 'guide', title: 'Guidelines on Maintenance and Repair of Drainage System and Sanitary Fitments' },
    { text: 'Erection and Maintenance of Advertising Signs', weight: 3, kind: 'guide', title: 'Guide on Erection & Maintenance of Advertising Signs' },
    { text: 'Abandoned or Dangerous Signboards', weight: 3, kind: 'guide', title: 'Guidelines for Identification of Abandoned or Dangerous Signboards' },
    { text: 'Greening in Buildings', weight: 3, kind: 'guide', title: 'Introductory Guide on Greening in Buildings' },
    { text: 'Building Information Modelling', weight: 3, kind: 'guide', title: 'Guidelines for Using Building Information Modelling in General Building Plans Submission 2019' },
    { text: 'Prioritisation of Actionable UBW', weight: 3, kind: 'guide', title: "Extract of the Buildings Department's Internal Guidelines on Prioritisation of Actionable Unauthorised Building Works" },
    { text: 'Surcharge on Defaulted Works', weight: 2, kind: 'guide', title: "The Buildings Department's Internal Guidelines on Imposition of a Surcharge on Works carried out in default of Owners" },
    { text: 'Overall Thermal Transfer Value', weight: 3, kind: 'code', title: 'Code of Practice for Overall Thermal Transfer Value in Buildings 1995' },
    { text: 'Oil Storage Installations', weight: 2, kind: 'code', title: 'Code of Practice for Oil Storage Installations 1992' },
    { text: 'Fire Safety Design for Caverns', weight: 2, kind: 'guide', title: 'Guide to Fire Safety Design for Caverns 1994' },
    { text: 'Explanatory Materials to Structural Steel', weight: 3, kind: 'term', title: 'Explanatory Materials to Code of Practice for the Structural Use of Steel 2011' },

    { text: 'Limit state design', weight: 5, kind: 'term', title: 'Section 2 of the steel code' },
    { text: 'Materials', weight: 5, kind: 'term', title: 'Section 3 of the steel code' },
    { text: 'Load factors', weight: 4, kind: 'term', title: 'Section 4 of the steel code' },
    { text: 'Serviceability', weight: 4, kind: 'term', title: 'Section 5 of the steel code' },
    { text: 'Section classification', weight: 3, kind: 'term', title: 'Section 7 of the steel code' },
    { text: 'Connections', weight: 5, kind: 'term', title: 'Section 9 of the steel code' },
    { text: 'Composite construction', weight: 3, kind: 'term', title: 'Section 10 of the steel code' },
    { text: 'Cold-formed steel', weight: 3, kind: 'term', title: 'Section 11 of the steel code' },
    { text: 'Fabrication & erection', weight: 3, kind: 'term', title: 'Sections 14 and 15 of the steel code' },
    { text: 'Loading tests', weight: 3, kind: 'term', title: 'Section 16 of the steel code' },
    { text: 'Existing structures', weight: 3, kind: 'term', title: 'Section 17 of the steel code' },
    { text: 'Dead load', weight: 4, kind: 'term', title: 'Dead and imposed loads code' },
    { text: 'Imposed load', weight: 4, kind: 'term', title: 'Dead and imposed loads code' },
    { text: 'Load combination', weight: 3, kind: 'term', title: 'Dead and imposed loads code' },
    { text: 'Basic wind speed', weight: 4, kind: 'term', title: 'Wind effects code' },
    { text: 'Gust factor', weight: 3, kind: 'term', title: 'Wind effects code' },
    { text: 'Terrain roughness', weight: 3, kind: 'term', title: 'Wind effects code' },
    { text: 'Topographic amplification', weight: 2, kind: 'term', title: 'Wind effects code' },
    { text: 'Dynamic response', weight: 3, kind: 'term', title: 'Wind effects code' },
    { text: 'Vortex shedding', weight: 2, kind: 'term', title: 'Wind effects code' },
    { text: 'Concrete grade', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Nominal cover', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Anchorage', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Lap length', weight: 2, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Crack width', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Shear wall', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Punching shear', weight: 2, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Durability', weight: 3, kind: 'term', title: 'Structural use of concrete code' },
    { text: 'Fire resistance', weight: 4, kind: 'term', title: 'Fire safety in buildings code' },
    { text: 'Escape route', weight: 3, kind: 'term', title: 'Means of escape code' },
    { text: 'Fire compartment', weight: 2, kind: 'term', title: 'Fire resisting construction code' },
    { text: 'Pile capacity', weight: 3, kind: 'term', title: 'Foundations code' },
    { text: 'Settlement', weight: 3, kind: 'term', title: 'Foundations code' },
    { text: 'Site formation', weight: 3, kind: 'term', title: 'Foundations code' },
    { text: 'RTTV', weight: 2, kind: 'term', title: 'Energy efficiency guidelines' },
    { text: 'Bolt & weld', weight: 2, kind: 'term', title: 'Steel code connections' },
    { text: 'Buckling', weight: 2, kind: 'term', title: 'Steel code member design' }
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function measureContext() {
    var canvas = document.createElement('canvas');
    return canvas.getContext('2d');
  }

  function fontFor(size, weight) {
    return (weight >= 600 ? '600 ' : '500 ') + size.toFixed(1) + 'px Manrope, "Segoe UI", system-ui, sans-serif';
  }

  function splitLabel(text, ctx, maxWidth) {
    var parts = text.split(' ');
    if (parts.length < 3) return [text];
    var best = null;
    for (var cut = 2; cut < parts.length; cut += 1) {
      var head = parts.slice(0, cut).join(' ');
      var tail = parts.slice(cut).join(' ');
      var headWidth = ctx.measureText(head).width;
      var tailWidth = ctx.measureText(tail).width;
      var width = Math.max(headWidth, tailWidth);
      if (width > maxWidth) continue;
      var balance = Math.abs(headWidth - tailWidth);
      if (!best || balance < best.balance) best = { lines: [head, tail], width: width, balance: balance };
    }
    return best ? best.lines : [text];
  }

  function buildBoxes(words, ctx, style, maxLineWidth) {
    return words.map(function (word) {
      var size = style.minSize + (style.maxSize - style.minSize) * Math.pow(word.ratio, 1.7);
      ctx.font = fontFor(size, 500);
      var width = ctx.measureText(word.text).width;
      var lines = [word.text];
      var height = size * 1.24;
      // A long publication name wraps onto a second line instead of shrinking away.
      var wrapLength = maxLineWidth < 480 ? 22 : 32;
      if (width > maxLineWidth || word.text.length > wrapLength) {
        var wrapped = splitLabel(word.text, ctx, maxLineWidth);
        if (wrapped.length > 1) {
          lines = wrapped;
          width = Math.max.apply(null, wrapped.map(function (line) { return ctx.measureText(line).width; }));
          height = size * 1.24 * 2;
        }
      }
      var vertical = word.vertical;
      return {
        word: word,
        size: size,
        lines: lines,
        vertical: vertical,
        width: vertical ? height : width,
        height: vertical ? width : height,
        advance: width,
        textHeight: height
      };
    });
  }

  function overlaps(box, x, y, placed) {
    var left = x - box.width / 2;
    var right = x + box.width / 2;
    var top = y - box.height / 2;
    var bottom = y + box.height / 2;
    for (var i = 0; i < placed.length; i += 1) {
      var other = placed[i];
      if (left < other.right && right > other.left && top < other.bottom && bottom > other.top) return true;
    }
    return false;
  }

  function layout(words, ctx, width, height) {
    var maxWeight = 0;
    var minWeight = Infinity;
    words.forEach(function (word) {
      if (word.weight > maxWeight) maxWeight = word.weight;
      if (word.weight < minWeight) minWeight = word.weight;
    });
    var span = Math.max(1, maxWeight - minWeight);
    var prepared = words.map(function (word) {
      return {
        text: word.text,
        title: word.title,
        kind: word.kind,
        weight: word.weight,
        // Publications claim the space first; section terms fill what is left.
        publication: word.kind !== 'term',
        ratio: Math.pow((word.weight - minWeight) / span, 0.82)
      };
    });
    prepared.sort(function (a, b) {
      if (a.publication !== b.publication) return a.publication ? -1 : 1;
      return b.weight - a.weight;
    });

    var random = mulberry32(0x5eed);
    prepared.forEach(function (word) {
      // Long labels lean a quarter turn the way the reference cloud does.
      word.vertical = word.text.length > 13 ? random() < 0.62 : random() < 0.1;
    });

    var style = {
      minSize: Math.max(10, Math.min(12.5, width / 58)),
      maxSize: Math.max(19, Math.min(38, width / 20))
    };
    var boxes = buildBoxes(prepared, ctx, style, Math.max(180, width * 0.62));
    var placed = [];
    var padX = GAP_X;
    var padY = GAP_Y;
    var cx = width / 2;
    var cy = height / 2;

    function attempt(box, index) {
      if (box.width + padX * 2 > width || box.height + padY * 2 > height) return false;
      for (var step = 0; step <= MAX_STEPS; step += 1) {
        var angle = step * SPIRAL_TURN + index;
        var radius = SPIRAL_STEP * angle;
        var x = cx + radius * Math.cos(angle);
        var y = cy + radius * Math.sin(angle) * 0.78;
        if (x - box.width / 2 < padX || x + box.width / 2 > width - padX) continue;
        if (y - box.height / 2 < padY || y + box.height / 2 > height - padY) continue;
        if (overlaps(box, x, y, placed)) continue;
        box.x = x;
        box.y = y;
        placed.push({
          left: x - box.width / 2,
          right: x + box.width / 2,
          top: y - box.height / 2,
          bottom: y + box.height / 2
        });
        box.keep = true;
        return true;
      }
      return false;
    }

    var overflow = [];
    boxes.forEach(function (box, index) {
      if (!attempt(box, index)) overflow.push(box);
    });

    // Later passes shrink the leftovers rather than dropping a publication.
    var SCALES = [0.86, 0.74, 0.64, 0.56, 0.48];
    var remaining = overflow;
    SCALES.forEach(function (scale, round) {
      var stillOut = [];
      remaining.forEach(function (box, index) {
        var shrunk = Object.assign({}, box, {
          size: box.size * scale,
          width: box.width * scale,
          height: box.height * scale
        });
        if (shrunk.size < 7.6) { stillOut.push(box); return; }
        if (attempt(shrunk, index + boxes.length + round * 97)) {
          box.keep = true;
          box.x = shrunk.x;
          box.y = shrunk.y;
          box.size = shrunk.size;
          box.width = shrunk.width;
          box.height = shrunk.height;
        } else {
          stillOut.push(box);
        }
      });
      remaining = stillOut;
    });

    return boxes.filter(function (box) { return box.keep; });
  }

  function render(host, boxes, width, height) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('class', 'sida-wordcloud__svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', host.getAttribute('aria-label') || 'Index of Hong Kong building codes, design manuals and guidelines');

    boxes.forEach(function (box) {
      var group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.setAttribute('class', 'sida-wordcloud__word sida-wordcloud__word--' + box.word.kind);
      var transform = 'translate(' + box.x.toFixed(2) + ' ' + box.y.toFixed(2) + ')';
      if (box.vertical) transform += ' rotate(-90)';
      group.setAttribute('transform', transform);

      var lines = box.lines || [box.word.text];
      var lineHeight = box.size * 1.24;
      lines.forEach(function (line, lineIndex) {
        var text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', box.size.toFixed(1));
        text.setAttribute('y', ((lineIndex - (lines.length - 1) / 2) * lineHeight).toFixed(2));
        text.textContent = line;
        if (lineIndex === 0 && box.word.title) {
          var title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
          title.textContent = box.word.title;
          text.appendChild(title);
        }
        group.appendChild(text);
      });
      svg.appendChild(group);
    });

    var previous = host.querySelector('svg');
    if (previous && previous.parentNode) previous.parentNode.removeChild(previous);
    host.appendChild(svg);
  }

  function mount(host) {
    if (host.dataset.sidaWordcloudReady === '1') return null;
    host.dataset.sidaWordcloudReady = '1';
    var ctx = measureContext();
    if (!ctx) return null;
    var timer = 0;
    var lastWidth = 0;
    var lastHeight = 0;

    function draw() {
      var width = Math.round(host.clientWidth);
      var height = Math.round(host.clientHeight);
      if (width < 120 || height < 120) return;
      lastWidth = width;
      lastHeight = height;
      var boxes = layout(WORDS, ctx, width, height);
      render(host, boxes, width, height);
      var placedText = boxes.map(function (box) { return box.word.text; });
      var dropped = WORDS.filter(function (word) { return placedText.indexOf(word.text) === -1; })
        .map(function (word) { return word.text; });
      host.setAttribute('data-wordcloud-placed', String(boxes.length));
      host.setAttribute('data-wordcloud-dropped', dropped.join('|'));
      host.classList.add('is-ready');
    }

    function schedule() {
      if (timer) return;
      timer = setTimeout(function () {
        timer = 0;
        var width = Math.round(host.clientWidth);
        var height = Math.round(host.clientHeight);
        if (Math.abs(width - lastWidth) < 16 && Math.abs(height - lastHeight) < 16) return;
        draw();
      }, 140);
    }

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(schedule).observe(host);
    } else {
      window.addEventListener('resize', schedule);
    }

    draw();
    return { redraw: draw };
  }

  function boot() {
    var hosts = Array.prototype.slice.call(document.querySelectorAll(HOST_SELECTOR));
    hosts.forEach(function (host) {
      var fallback = host.querySelector('.' + FALLBACK_CLASS);
      try {
        var mounted = mount(host);
        if (mounted && fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);
      } catch (error) {
        host.classList.add('is-unavailable');
        if (window.console && window.console.warn) window.console.warn('Word cloud unavailable', error);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
