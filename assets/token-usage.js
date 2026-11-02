/* OuroNex account — token usage board.
 * Pure data helpers are exported for the throwaway Node harness; DOM wiring only
 * boots when a document with #token-usage-board is present. */
(function (global, factory) {
  'use strict';

  var api = factory();

  if (typeof module === 'object' && module.exports) module.exports = api;
  if (global) global.OuroNexTokenUsage = api;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', api.boot);
    else api.boot();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var API_URL = '/api/v1/usage/';
  var DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  var DEMO_SOURCE = 'demo';

  var METRICS = Object.freeze([
    Object.freeze({ key: 'input', label: 'Input', cssVar: '--tu-chart-input' }),
    Object.freeze({ key: 'output', label: 'Output', cssVar: '--tu-chart-output' }),
    Object.freeze({ key: 'cacheWrite', label: 'Cache write', cssVar: '--tu-chart-cachewrite' }),
    Object.freeze({ key: 'cacheRead', label: 'Cache read', cssVar: '--tu-chart-cacheread' })
  ]);

  var METRIC_KEYS = METRICS.map(function (metric) { return metric.key; });
  var RANGE_DAYS = Object.freeze({ today: 1, '7d': 7, '30d': 30 });
  var TAB_KEYS = ['day', 'model', 'session'];
  var numberFormatter = new Intl.NumberFormat('en-US');

  /* ------------------------------------------------------------------ */
  /* Pure helpers                                                        */
  /* ------------------------------------------------------------------ */

  function localDayKey(date) {
    var value = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
    return value.getFullYear() + '-' +
      String(value.getMonth() + 1).padStart(2, '0') + '-' +
      String(value.getDate()).padStart(2, '0');
  }

  function rangeCutoff(range, now) {
    if (range === 'all') return null;
    var days = RANGE_DAYS[range] || RANGE_DAYS['7d'];
    var base = now instanceof Date && !isNaN(now.getTime()) ? now : new Date();
    var start = new Date(base.getFullYear(), base.getMonth(), base.getDate());
    start.setDate(start.getDate() - (days - 1));
    return localDayKey(start);
  }

  function trimTo(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength);
  }

  function counter(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.floor(number);
  }

  function sanitizeRecord(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var day = typeof raw.day === 'string' ? raw.day.trim() : '';
    if (!DAY_PATTERN.test(day)) return null;
    var model = trimTo(raw.model, 120);
    var sessionId = trimTo(raw.sessionId, 200);
    if (!model || !sessionId) return null;
    return {
      day: day,
      model: model,
      sessionId: sessionId,
      title: trimTo(raw.title, 255),
      calls: counter(raw.calls),
      input: counter(raw.input),
      output: counter(raw.output),
      cacheWrite: counter(raw.cacheWrite),
      cacheRead: counter(raw.cacheRead),
      source: trimTo(raw.source, 80) || 'external'
    };
  }

  function normalizeRecords(list) {
    if (!Array.isArray(list)) return [];
    return list.map(sanitizeRecord).filter(Boolean);
  }

  function totalTokens(record) {
    if (!record) return 0;
    return (record.input || 0) + (record.output || 0) +
      (record.cacheWrite || 0) + (record.cacheRead || 0);
  }

  function filterRecords(records, filters) {
    var options = filters || {};
    var cutoff = rangeCutoff(options.range || '7d', options.now || new Date());
    var session = typeof options.session === 'string' ? options.session : '';
    return (Array.isArray(records) ? records : []).filter(function (record) {
      if (!record) return false;
      if (cutoff && record.day < cutoff) return false;
      // Model is report data only: a legacy model option is deliberately ignored.
      if (session && record.sessionId !== session) return false;
      return true;
    });
  }

  function sumRecords(records) {
    var sums = { calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 };
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (!record) return;
      sums.calls += record.calls || 0;
      sums.input += record.input || 0;
      sums.output += record.output || 0;
      sums.cacheWrite += record.cacheWrite || 0;
      sums.cacheRead += record.cacheRead || 0;
      sums.total += totalTokens(record);
    });
    return sums;
  }

  function groupRecords(records, keyFn) {
    var map = new Map();
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (!record) return;
      var key = keyFn(record);
      var group = map.get(key);
      if (!group) {
        group = {
          key: key,
          calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0,
          rows: [], models: 0, sessions: 0, days: 0
        };
        map.set(key, group);
      }
      group.calls += record.calls || 0;
      group.input += record.input || 0;
      group.output += record.output || 0;
      group.cacheWrite += record.cacheWrite || 0;
      group.cacheRead += record.cacheRead || 0;
      group.total += totalTokens(record);
      group.rows.push(record);
    });
    map.forEach(function (group) {
      var models = new Set();
      var sessions = new Set();
      var days = new Set();
      group.rows.forEach(function (record) {
        models.add(record.model);
        sessions.add(record.sessionId);
        days.add(record.day);
      });
      group.models = models.size;
      group.sessions = sessions.size;
      group.days = days.size;
    });
    return map;
  }

  function compareKeys(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  function byTotalThenKey(a, b) {
    if (b.total !== a.total) return b.total - a.total;
    return compareKeys(a.key, b.key);
  }

  function aggregateByDay(records) {
    return Array.from(groupRecords(records, function (record) { return record.day; }).values())
      .sort(function (a, b) { return compareKeys(a.key, b.key); });
  }

  function aggregateByModel(records) {
    return Array.from(groupRecords(records, function (record) { return record.model; }).values())
      .sort(byTotalThenKey);
  }

  function aggregateBySession(records) {
    return Array.from(groupRecords(records, function (record) { return record.sessionId; }).values())
      .sort(byTotalThenKey);
  }

  function sharePercent(part, total) {
    var value = Number(part);
    var whole = Number(total);
    if (!Number.isFinite(value) || !Number.isFinite(whole) || whole <= 0) return '\u2014';
    return ((value / whole) * 100).toFixed(1) + '%';
  }

  function formatCompact(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '0';
    if (number >= 1e9) return (number / 1e9).toFixed(number >= 1e10 ? 1 : 2) + 'B';
    if (number >= 1e6) return (number / 1e6).toFixed(number >= 1e7 ? 1 : 2) + 'M';
    if (number >= 1e3) return (number / 1e3).toFixed(number >= 1e4 ? 1 : 2) + 'K';
    return String(number);
  }

  function formatNumber(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = 0;
    return numberFormatter.format(Math.round(number));
  }

  function isDemoOnly(records) {
    return Array.isArray(records) && records.length > 0 &&
      records.every(function (record) { return record && record.source === DEMO_SOURCE; });
  }

  function resolveSessionCount(count, records) {
    if (Number.isInteger(count) && count >= 0) return count;
    var sessions = new Set();
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (record) sessions.add(record.sessionId);
    });
    return sessions.size;
  }

  function truncateLabel(text, maxLength) {
    var value = text === null || text === undefined ? '' : String(text);
    var limit = Number.isInteger(maxLength) && maxLength > 0 ? maxLength : 36;
    return value.length > limit ? value.slice(0, limit) + '\u2026' : value;
  }

  function toggleMetricSelection(selected, key) {
    var next = new Set(selected || []);
    if (next.has(key)) {
      if (next.size <= 1) return next;
      next.delete(key);
    } else {
      next.add(key);
    }
    return next;
  }

  function formatGeneratedAt(generatedAt, locale) {
    if (!generatedAt) return '';
    var date = new Date(generatedAt);
    if (isNaN(date.getTime())) return '';
    try {
      return new Intl.DateTimeFormat(locale || 'en-US', {
        hour: '2-digit',
        minute: '2-digit'
      }).format(date);
    } catch (error) {
      return '';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Board wiring                                                        */
  /* ------------------------------------------------------------------ */

  var booted = false;

  function boot() {
    if (booted) return;
    var board = document.getElementById('token-usage-board');
    if (!board) return;
    booted = true;
    initBoard(board);
  }

  function initBoard(board) {
    var state = {
      records: [],
      generatedAt: null,
      sessionCount: 0,
      range: '7d',
      session: '',
      metricsOn: new Set(METRIC_KEYS),
      activeTab: 'day',
      loaded: false,
      error: null
    };

    var els = {
      status: document.getElementById('tu-status'),
      refresh: document.getElementById('tu-refresh'),
      error: document.getElementById('tu-error'),
      range: document.getElementById('tu-range'),
      session: document.getElementById('tu-session'),
      kpis: document.getElementById('tu-kpis'),
      metrics: document.getElementById('tu-metrics'),
      chart: document.getElementById('tu-chart'),
      tabs: {
        day: document.getElementById('tu-tab-day'),
        model: document.getElementById('tu-tab-model'),
        session: document.getElementById('tu-tab-session')
      },
      panels: {
        day: document.getElementById('tu-panel-day'),
        model: document.getElementById('tu-panel-model'),
        session: document.getElementById('tu-panel-session')
      }
    };

    var inFlight = false;

    /* ---- small DOM helpers ------------------------------------------ */

    function make(tag, className, text) {
      var node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = String(text);
      return node;
    }

    function makeLabel(text, className) {
      var node = make('span', className, text);
      node.dataset.i18nDynamic = '';
      return node;
    }

    function makeData(text, className) {
      var node = make('span', className, text);
      node.dataset.userInput = '';
      return node;
    }

    function makeDot(key) {
      return make('span', 'tu-dot tu-dot--' + key);
    }

    function setBoardState(name) {
      board.dataset.state = name;
    }

    function stateBlock(message, kind) {
      var wrap = make('div', 'tu-state' + (kind ? ' tu-state--' + kind : ''));
      if (kind === 'loading') {
        var spinner = make('span', 'tu-spinner');
        spinner.setAttribute('aria-hidden', 'true');
        wrap.appendChild(spinner);
      }
      wrap.appendChild(makeLabel(message));
      return wrap;
    }

    /* ---- status line -------------------------------------------------- */

    function renderStatus() {
      var fragment = document.createDocumentFragment();
      var locale = document.documentElement.lang || 'en';
      var time = formatGeneratedAt(state.generatedAt, locale);
      if (time) {
        fragment.appendChild(makeLabel('Updated'));
        fragment.appendChild(document.createTextNode(' '));
        fragment.appendChild(makeData(time, 'tu-status-value'));
        fragment.appendChild(document.createTextNode(' \u00b7 '));
      }
      fragment.appendChild(makeData(formatNumber(state.sessionCount), 'tu-status-value'));
      fragment.appendChild(document.createTextNode(' '));
      fragment.appendChild(makeLabel(state.sessionCount === 1 ? 'session' : 'sessions'));
      if (isDemoOnly(state.records)) {
        fragment.appendChild(document.createTextNode(' \u00b7 '));
        fragment.appendChild(makeLabel('Demo data', 'tu-demo'));
      }
      els.status.replaceChildren(fragment);
    }

    function renderStatusLoading() {
      els.status.replaceChildren(makeLabel('Loading usage data\u2026'));
    }

    function renderStatusFailed() {
      els.status.replaceChildren(makeLabel('Load failed'));
    }

    /* ---- loading / failure states ------------------------------------ */

    function renderKpiSkeleton() {
      var fragment = document.createDocumentFragment();
      for (var index = 0; index < 5; index += 1) {
        var card = make('article', 'tu-kpi is-skeleton');
        card.setAttribute('aria-hidden', 'true');
        card.appendChild(make('span', 'tu-skeleton tu-skeleton-label'));
        card.appendChild(make('span', 'tu-skeleton tu-skeleton-value'));
        card.appendChild(make('span', 'tu-skeleton tu-skeleton-sub'));
        fragment.appendChild(card);
      }
      els.kpis.replaceChildren(fragment);
    }

    function renderLoading() {
      setBoardState('loading');
      board.setAttribute('aria-busy', 'true');
      renderStatusLoading();
      renderKpiSkeleton();
      els.chart.replaceChildren(stateBlock('Loading usage data\u2026', 'loading'));
      TAB_KEYS.forEach(function (key) {
        els.panels[key].replaceChildren(stateBlock('Loading usage data\u2026', 'loading'));
      });
    }

    function renderFailure() {
      setBoardState('error');
      els.kpis.replaceChildren(stateBlock('Usage data is unavailable right now.', 'error tu-state--wide'));
      els.chart.replaceChildren(stateBlock('Usage data is unavailable right now.', 'error'));
      TAB_KEYS.forEach(function (key) {
        els.panels[key].replaceChildren(stateBlock('Usage data is unavailable right now.', 'error'));
      });
    }

    /* ---- KPI cards ---------------------------------------------------- */

    function renderKpis(records) {
      var sums = sumRecords(records);
      var cards = [{
        label: 'Total tokens',
        value: sums.total,
        dotKey: null,
        sub: function (body) {
          body.appendChild(makeLabel('Calls'));
          body.appendChild(document.createTextNode(' '));
          body.appendChild(makeData(formatNumber(sums.calls)));
        }
      }];

      METRICS.forEach(function (metric) {
        cards.push({
          label: metric.label + ' tokens',
          value: sums[metric.key],
          dotKey: metric.key,
          sub: function (body) {
            body.appendChild(makeData(sharePercent(sums[metric.key], sums.total)));
          }
        });
      });

      var fragment = document.createDocumentFragment();
      cards.forEach(function (card) {
        var node = make('article', 'tu-kpi');
        var label = make('h3', 'tu-kpi-label');
        if (card.dotKey) label.appendChild(makeDot(card.dotKey));
        label.appendChild(makeLabel(card.label));

        var value = make('div', 'tu-kpi-value', formatCompact(card.value));
        value.title = formatNumber(card.value);

        var sub = make('div', 'tu-kpi-sub');
        card.sub(sub);

        node.appendChild(label);
        node.appendChild(value);
        node.appendChild(sub);
        fragment.appendChild(node);
      });
      els.kpis.replaceChildren(fragment);
    }

    /* ---- metric toggles ---------------------------------------------- */

    function renderMetricToggles() {
      var fragment = document.createDocumentFragment();
      METRICS.forEach(function (metric) {
        var button = make('button', 'tu-metric');
        button.type = 'button';
        button.dataset.metric = metric.key;
        button.setAttribute('aria-pressed', String(state.metricsOn.has(metric.key)));
        button.appendChild(makeDot(metric.key));
        button.appendChild(makeLabel(metric.label));
        button.addEventListener('click', function () {
          var next = toggleMetricSelection(state.metricsOn, metric.key);
          if (next.size === state.metricsOn.size && next.has(metric.key) === state.metricsOn.has(metric.key)) {
            return;
          }
          state.metricsOn = next;
          button.setAttribute('aria-pressed', String(state.metricsOn.has(metric.key)));
          renderChart(filtered());
        });
        fragment.appendChild(button);
      });
      els.metrics.replaceChildren(fragment);
    }

    /* ---- stacked bar chart ------------------------------------------- */

    var SVG_NS = 'http://www.w3.org/2000/svg';

    function svgNode(tag) {
      return document.createElementNS(SVG_NS, tag);
    }

    function applyLanguage(node) {
      if (typeof window === 'undefined' || !window.OuroNexLanguage) return;
      if (typeof window.OuroNexLanguage.apply !== 'function') return;
      try {
        window.OuroNexLanguage.apply(node);
      } catch (error) {
        /* keep the English source label if the dictionary is unavailable */
      }
    }

    function currentMetricLabels() {
      applyLanguage(els.metrics);
      var labels = {};
      Array.prototype.forEach.call(els.metrics.querySelectorAll('.tu-metric'), function (button) {
        var text = button.querySelector('[data-i18n-dynamic]');
        labels[button.dataset.metric] = text ? text.textContent : '';
      });
      return labels;
    }

    function currentTotalLabel() {
      applyLanguage(els.kpis);
      var text = els.kpis.querySelector('.tu-kpi-label [data-i18n-dynamic]');
      return text ? text.textContent : 'Total tokens';
    }

    function renderChart(records) {
      var groups = aggregateByDay(records);
      if (groups.length === 0) {
        els.chart.replaceChildren(stateBlock('No usage data for the current filters', 'empty'));
        return;
      }

      var active = METRICS.filter(function (metric) {
        return state.metricsOn.has(metric.key);
      });
      var metricLabels = currentMetricLabels();
      var totalLabel = currentTotalLabel();
      var padLeft = 48, padRight = 8, padTop = 10, padBottom = 30, chartHeight = 220;
      var availableWidth = Math.max(els.chart.clientWidth || 0, 280);
      var width = Math.max(availableWidth, padLeft + padRight + groups.length * 34);
      var slot = (width - padLeft - padRight) / groups.length;
      var barWidth = Math.max(24, Math.min(64, slot * .48));
      var gap = slot - barWidth;
      var height = chartHeight + padTop + padBottom;
      var dayTotals = groups.map(function (group) {
        return active.reduce(function (sum, metric) { return sum + (group[metric.key] || 0); }, 0);
      });
      var maxTotal = Math.max.apply(null, dayTotals.concat([1]));

      function yPosition(value) {
        return padTop + chartHeight - (value / maxTotal) * chartHeight;
      }

      var svg = svgNode('svg');
      svg.setAttribute('role', 'img');
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      svg.setAttribute('focusable', 'false');
      svg.setAttribute('aria-label', 'Daily token usage stacked bar chart, ' + groups.length +
        ' days, metrics: ' + active.map(function (metric) { return metricLabels[metric.key] || metric.label; }).join(', ') + '.');

      for (var step = 0; step <= 4; step += 1) {
        var value = (maxTotal / 4) * step;
        var y = yPosition(value);
        var line = svgNode('line');
        line.setAttribute('x1', String(padLeft));
        line.setAttribute('y1', String(y));
        line.setAttribute('x2', String(width - padRight));
        line.setAttribute('y2', String(y));
        line.setAttribute('class', 'tu-grid-line');
        svg.appendChild(line);

        var tick = svgNode('text');
        tick.setAttribute('x', String(padLeft - 8));
        tick.setAttribute('y', String(y + 4));
        tick.setAttribute('text-anchor', 'end');
        tick.setAttribute('class', 'tu-axis-label');
        tick.textContent = formatCompact(Math.round(value));
        svg.appendChild(tick);
      }

      groups.forEach(function (group, index) {
        var x = padLeft + index * slot + gap / 2;
        var barGroup = svgNode('g');
        barGroup.setAttribute('class', 'tu-bar-group');

        var tooltip = svgNode('title');
        tooltip.textContent = group.key + '\n' +
          active.map(function (metric) {
            return (metricLabels[metric.key] || metric.label) + ': ' + formatNumber(group[metric.key]);
          }).join('\n') +
          '\n' + totalLabel + ': ' + formatNumber(dayTotals[index]);
        barGroup.appendChild(tooltip);

        var cursor = padTop + chartHeight;
        active.forEach(function (metric) {
          var value = group[metric.key] || 0;
          if (value <= 0) return;
          var segmentHeight = Math.max((value / maxTotal) * chartHeight, 1);
          cursor -= segmentHeight;
          var rect = svgNode('rect');
          rect.setAttribute('x', String(x));
          rect.setAttribute('y', String(cursor));
          rect.setAttribute('width', String(barWidth));
          rect.setAttribute('height', String(segmentHeight));
          rect.setAttribute('rx', '2');
          rect.setAttribute('class', 'tu-bar tu-bar--' + metric.key);
          barGroup.appendChild(rect);
        });

        var hit = svgNode('rect');
        hit.setAttribute('x', String(x - gap / 2));
        hit.setAttribute('y', String(padTop));
        hit.setAttribute('width', String(barWidth + gap));
        hit.setAttribute('height', String(chartHeight));
        hit.setAttribute('class', 'tu-bar-hit');
        barGroup.appendChild(hit);

        var dayLabel = svgNode('text');
        dayLabel.setAttribute('x', String(x + barWidth / 2));
        dayLabel.setAttribute('y', String(height - 10));
        dayLabel.setAttribute('text-anchor', 'middle');
        dayLabel.setAttribute('class', 'tu-axis-label');
        dayLabel.textContent = group.key.slice(5);
        barGroup.appendChild(dayLabel);

        svg.appendChild(barGroup);
      });

      els.chart.replaceChildren(svg);
    }

    /* ---- tables ------------------------------------------------------- */

    var NUMERIC_HEADERS = ['Calls', 'Input', 'Output', 'Cache write', 'Cache read', 'Total'];

    function numberCells(group) {
      var cells = [];
      cells.push(make('td', null, formatNumber(group.calls)));

      ['input', 'output', 'cacheWrite', 'cacheRead'].forEach(function (key) {
        var cell = make('td', null, formatCompact(group[key]));
        cell.title = formatNumber(group[key]);
        cells.push(cell);
      });

      var total = make('td', 'tu-total', formatCompact(group.total));
      total.title = formatNumber(group.total);
      cells.push(total);
      return cells;
    }

    function buildTable(captionId, captionText, firstHeader, rows) {
      if (!rows.length) return stateBlock('No usage data for the current filters', 'empty');

      var wrap = make('div', 'tu-table-wrap');
      wrap.tabIndex = 0;
      wrap.setAttribute('aria-labelledby', captionId);

      var table = make('table');
      var caption = make('caption', 'tu-visually-hidden', captionText);
      caption.id = captionId;
      caption.dataset.i18nDynamic = '';
      table.appendChild(caption);

      var head = make('thead');
      var headRow = make('tr');
      var first = make('th');
      first.scope = 'col';
      first.appendChild(makeLabel(firstHeader));
      headRow.appendChild(first);

      NUMERIC_HEADERS.forEach(function (header) {
        var cell = make('th');
        cell.scope = 'col';
        cell.appendChild(makeLabel(header));
        headRow.appendChild(cell);
      });

      head.appendChild(headRow);
      table.appendChild(head);

      var body = make('tbody');
      rows.forEach(function (row) { body.appendChild(row); });
      table.appendChild(body);
      wrap.appendChild(table);
      return wrap;
    }

    function appendNumericCells(row, group) {
      numberCells(group).forEach(function (cell) { row.appendChild(cell); });
    }

    function renderDayTable(records) {
      var groups = aggregateByDay(records).slice().reverse();
      var rows = groups.map(function (group) {
        var row = make('tr');
        var cell = make('td');
        cell.appendChild(makeData(group.key, 'tu-date'));

        var sub = make('span', 'tu-cell-sub');
        sub.appendChild(document.createTextNode(' \u00b7 '));
        sub.appendChild(makeData(formatNumber(group.models)));
        sub.appendChild(document.createTextNode(' '));
        sub.appendChild(makeLabel(group.models === 1 ? 'model' : 'models'));
        sub.appendChild(document.createTextNode(' \u00b7 '));
        sub.appendChild(makeData(formatNumber(group.sessions)));
        sub.appendChild(document.createTextNode(' '));
        sub.appendChild(makeLabel(group.sessions === 1 ? 'session' : 'sessions'));
        cell.appendChild(sub);

        row.appendChild(cell);
        appendNumericCells(row, group);
        return row;
      });
      els.panels.day.replaceChildren(buildTable(
        'tu-caption-day', 'Daily token usage details', 'Date', rows
      ));
    }

    function renderModelTable(records) {
      var grandTotal = sumRecords(records).total;
      var groups = aggregateByModel(records);
      var rows = groups.map(function (group) {
        var row = make('tr');
        var cell = make('td');

        var model = make('span', 'tu-mono', group.key);
        model.dataset.userInput = '';
        cell.appendChild(model);

        var sub = make('span', 'tu-cell-sub');
        sub.appendChild(document.createTextNode(' \u00b7 '));
        sub.appendChild(makeLabel('Share'));
        sub.appendChild(document.createTextNode(' '));
        sub.appendChild(makeData(sharePercent(group.total, grandTotal)));
        cell.appendChild(sub);

        row.appendChild(cell);
        appendNumericCells(row, group);
        return row;
      });
      els.panels.model.replaceChildren(buildTable(
        'tu-caption-model', 'Token usage by model', 'Model', rows
      ));
    }

    function renderSessionTable(records) {
      var groups = aggregateBySession(records);
      var rows = groups.map(function (group) {
        var row = make('tr');
        var cell = make('td');
        var title = group.rows[0].title || group.key;

        var titleNode = make('div', 'tu-cell-title', title);
        titleNode.dataset.userInput = '';
        titleNode.title = title;
        cell.appendChild(titleNode);

        var session = make('div', 'tu-cell-sub tu-mono', group.key);
        session.dataset.userInput = '';
        cell.appendChild(session);

        var meta = make('div', 'tu-cell-sub');
        var models = Array.from(new Set(group.rows.map(function (record) { return record.model; }))).sort();
        meta.appendChild(makeData(models.join(', ')));
        meta.appendChild(document.createTextNode(' \u00b7 '));
        meta.appendChild(makeLabel('Active over'));
        meta.appendChild(document.createTextNode(' '));
        meta.appendChild(makeData(formatNumber(group.days)));
        meta.appendChild(document.createTextNode(' '));
        meta.appendChild(makeLabel(group.days === 1 ? 'day' : 'days'));
        cell.appendChild(meta);

        row.appendChild(cell);
        appendNumericCells(row, group);
        return row;
      });
      els.panels.session.replaceChildren(buildTable(
        'tu-caption-session', 'Token usage by session', 'Session', rows
      ));
    }

    /* ---- filters and tabs --------------------------------------------- */

    function refreshFilterOptions() {
      var sessions = aggregateBySession(state.records);
      var sessionKeys = sessions.map(function (group) { return group.key; });
      if (state.session && sessionKeys.indexOf(state.session) === -1) state.session = '';

      var sessionFragment = document.createDocumentFragment();
      var allSessions = make('option', null, 'All sessions');
      allSessions.value = '';
      allSessions.dataset.i18nDynamic = '';
      sessionFragment.appendChild(allSessions);
      sessions.forEach(function (group) {
        var title = group.rows[0].title || group.key;
        var option = make('option', null, truncateLabel(title, 36));
        option.value = group.key;
        option.title = title;
        option.dataset.userInput = '';
        sessionFragment.appendChild(option);
      });
      els.session.replaceChildren(sessionFragment);
      els.session.value = state.session;
    }

    function filtered() {
      return filterRecords(state.records, {
        range: state.range,
        session: state.session,
        now: new Date()
      });
    }

    function renderAll() {
      var records = filtered();
      renderKpis(records);
      renderChart(records);
      renderDayTable(records);
      renderModelTable(records);
      renderSessionTable(records);
      board.setAttribute('aria-busy', 'false');
      setBoardState('ready');
    }

    function selectTab(key) {
      state.activeTab = key;
      TAB_KEYS.forEach(function (name) {
        var selected = name === key;
        var tab = els.tabs[name];
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        els.panels[name].classList.toggle('is-hidden', !selected);
      });
    }

    els.range.addEventListener('click', function (event) {
      var button = event.target.closest('button[data-range]');
      if (!button) return;
      state.range = button.dataset.range;
      Array.prototype.forEach.call(els.range.querySelectorAll('button'), function (item) {
        item.setAttribute('aria-pressed', String(item === button));
      });
      renderAll();
    });

    els.session.addEventListener('change', function (event) {
      state.session = event.target.value;
      renderAll();
    });

    TAB_KEYS.forEach(function (key) {
      els.tabs[key].addEventListener('click', function () { selectTab(key); });
      els.tabs[key].addEventListener('keydown', function (event) {
        var index = TAB_KEYS.indexOf(state.activeTab);
        var next = null;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = TAB_KEYS[(index + 1) % TAB_KEYS.length];
        else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = TAB_KEYS[(index + TAB_KEYS.length - 1) % TAB_KEYS.length];
        else if (event.key === 'Home') next = TAB_KEYS[0];
        else if (event.key === 'End') next = TAB_KEYS[TAB_KEYS.length - 1];
        if (!next) return;
        event.preventDefault();
        selectTab(next);
        els.tabs[next].focus();
      });
    });

    /* ---- error handling ----------------------------------------------- */

    function requestError(code, detail, status) {
      var error = new Error(code || 'request_failed');
      error.code = code || 'request_failed';
      error.detail = detail || '';
      error.status = status || 0;
      return error;
    }

    function errorMessage(error) {
      var code = error && error.code ? String(error.code) : '';
      if (code === 'invalid_token' || code === 'unauthorized' || code === 'http_401') {
        return 'Your session has expired. Reload the page to sign in again.';
      }
      if (code === 'network' || code === 'invalid_response' || code === 'http_0') {
        return 'Network or service error. Use Refresh to try again.';
      }
      return 'The usage service is temporarily unavailable. Try Refresh again.';
    }

    function showError(error) {
      els.error.replaceChildren(makeLabel(errorMessage(error)));
      if (error && error.detail) {
        var detail = make('div', 'tu-alert-detail', error.detail);
        detail.dataset.userInput = '';
        els.error.appendChild(detail);
      }
      els.error.classList.remove('is-hidden');
    }

    function hideError() {
      els.error.classList.add('is-hidden');
      els.error.replaceChildren();
    }

    /* ---- data loading -------------------------------------------------- */

    function loadData(silent) {
      if (inFlight) return Promise.resolve();
      inFlight = true;

      els.refresh.setAttribute('aria-busy', 'true');
      if (!silent) {
        setBoardState('loading');
        renderStatusLoading();
        if (!state.loaded) renderLoading();
      }

      return fetch(API_URL, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(function (response) {
        return response.json().catch(function () { return null; }).then(function (body) {
          if (!response.ok) {
            var errorCode = body && body.error && typeof body.error === 'object' ? body.error.code : '';
            var errorDetail = body && body.error && typeof body.error === 'object' ? body.error.message : '';
            throw requestError(errorCode || 'http_' + response.status, errorDetail, response.status);
          }
          if (!body || !Array.isArray(body.records)) {
            throw requestError('invalid_response', '', response.status);
          }
          return body;
        });
      }).then(function (body) {
        var records = normalizeRecords(body.records);
        state.records = records;
        state.generatedAt = typeof body.generatedAt === 'string' ? body.generatedAt : null;
        state.sessionCount = resolveSessionCount(body.sessionCount, records);
        state.loaded = true;
        state.error = null;

        hideError();
        refreshFilterOptions();
        renderAll();
        renderStatus();
      }).catch(function (error) {
        var normalized = error && error.code ? error : requestError('network', '', 0);
        state.error = normalized;
        setBoardState('error');
        showError(normalized);
        if (!state.loaded) {
          renderStatusFailed();
          renderFailure();
        } else {
          renderStatus();
        }
      }).then(function () {
        els.refresh.setAttribute('aria-busy', 'false');
        board.setAttribute('aria-busy', 'false');
        inFlight = false;
      });
    }

    var resizeFrame = null;
    window.addEventListener('resize', function () {
      if (!state.loaded) return;
      if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(function () {
        resizeFrame = null;
        renderChart(filtered());
      });
    });

    els.refresh.addEventListener('click', function () { loadData(false); });

    document.addEventListener('ouronex:languagechange', function () {
      if (!state.loaded) return;
      renderStatus();
      renderChart(filtered());
    });

    renderMetricToggles();
    refreshFilterOptions();
    loadData(false);

    window.setInterval(function () { loadData(true); }, 60000);
  }

  return Object.freeze({
    API_URL: API_URL,
    METRICS: METRICS,
    METRIC_KEYS: METRIC_KEYS,
    RANGE_DAYS: RANGE_DAYS,
    TAB_KEYS: TAB_KEYS,
    localDayKey: localDayKey,
    rangeCutoff: rangeCutoff,
    sanitizeRecord: sanitizeRecord,
    normalizeRecords: normalizeRecords,
    filterRecords: filterRecords,
    sumRecords: sumRecords,
    totalTokens: totalTokens,
    groupRecords: groupRecords,
    aggregateByDay: aggregateByDay,
    aggregateByModel: aggregateByModel,
    aggregateBySession: aggregateBySession,
    sharePercent: sharePercent,
    formatCompact: formatCompact,
    formatNumber: formatNumber,
    isDemoOnly: isDemoOnly,
    resolveSessionCount: resolveSessionCount,
    truncateLabel: truncateLabel,
    toggleMetricSelection: toggleMetricSelection,
    formatGeneratedAt: formatGeneratedAt,
    boot: boot
  });
});