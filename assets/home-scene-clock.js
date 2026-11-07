/* Atomic scene-part clock. The caller owns rendering and schedules every tick. */
(function (root, factory) {
  'use strict';

  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (root) root.OuroSceneClock = api;
})(typeof window !== 'undefined' ? window :
  (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  function duration(value, fallback, name) {
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError(name + ' must be a finite number.');
    }
    if (value < 0) throw new RangeError(name + ' must not be negative.');
    return value;
  }

  function time(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('Time must be a finite number of milliseconds.');
    }
    return value;
  }

  function create(options) {
    if (!options || typeof options !== 'object' || Array.isArray(options)) {
      throw new TypeError('Options with a count of 1, 2 or 3 are required.');
    }
    var count = options.count;
    if (count !== 1 && count !== 2 && count !== 3) throw new RangeError('count must be 1, 2 or 3.');
    var enterDuration = duration(options.enterDuration, 720, 'enterDuration');
    var exitDuration = duration(options.exitDuration, 480, 'exitDuration');
    var lead = duration(options.lead, 160, 'lead');
    var parts = [];
    var target = [];
    var job = null;
    var paused = false;
    var lastTime = null;

    for (var i = 0; i < count; i += 1) {
      parts.push({ enter: 0, exit: 0, phase: 'hidden' });
      target.push(false);
    }

    function copyTarget(values) {
      if (!Array.isArray(values) || values.length !== count) {
        throw new TypeError('Target must be a boolean array of length ' + count + '.');
      }
      var copy = [];
      for (var index = 0; index < count; index += 1) {
        if (typeof values[index] !== 'boolean') {
          throw new TypeError('Every target entry must be a boolean.');
        }
        copy.push(values[index]);
      }
      return copy;
    }

    /* Discard backward time rather than rewinding a committed atomic job. */
    function elapsedSinceLast(now) {
      time(now);
      var current = lastTime === null ? now : Math.max(lastTime, now);
      var elapsed = lastTime === null ? 0 : current - lastTime;
      lastTime = current;
      return elapsed;
    }

    function nextPart() {
      var index;
      for (index = count - 1; index >= 0; index -= 1) {
        if (parts[index].phase === 'visible' && !target[index]) return index;
      }
      for (index = 0; index < count; index += 1) {
        if (parts[index].phase === 'hidden' && target[index]) return index;
      }
      return -1;
    }

    function startNext() {
      var index = nextPart();
      if (index < 0) return;
      var entering = target[index];
      var allHidden = parts.every(function (part) { return part.phase === 'hidden'; });
      var part = parts[index];
      part.enter = entering ? 0 : 1;
      part.exit = 0;
      part.phase = entering ? 'entering' : 'exiting';
      job = {
        index: index,
        entering: entering,
        delay: entering && allHidden ? lead : 0,
        duration: entering ? enterDuration : exitDuration,
        elapsed: 0
      };
    }

    function advanceJob(elapsed) {
      if (!job) return;
      if (job.delay > 0) {
        var waiting = Math.min(job.delay, elapsed);
        job.delay -= waiting;
        elapsed -= waiting;
        if (job.delay > 0) return;
      }
      // Cap elapsed before division, including very large gaps between ticks.
      job.elapsed = Math.min(job.duration, job.elapsed + elapsed);
      var progress = job.duration === 0 ? 1 : job.elapsed / job.duration;
      var part = parts[job.index];
      if (job.entering) part.enter = progress;
      else part.exit = progress;
      if (progress === 1) {
        part.phase = job.entering ? 'visible' : 'hidden';
        job = null;
      }
    }

    function snapshot() {
      return {
        parts: parts.map(function (part) {
          return { enter: part.enter, exit: part.exit, phase: part.phase };
        }),
        // Pending targets need ticks too, but a paused clock needs none.
        running: !paused && (job !== null || nextPart() !== -1),
        activePart: job === null ? -1 : job.index
      };
    }

    function setTarget(values) {
      // The active job is immutable in direction; only the next choice changes.
      target = copyTarget(values);
    }

    function tick(now) {
      var elapsed = elapsedSinceLast(now);
      if (!paused) {
        advanceJob(elapsed);
        // Never give a newly started job leftover elapsed time from this tick.
        // Even zero-duration jobs complete on a later tick, one group at a time.
        if (!job) startNext();
      }
      return snapshot();
    }

    function settle(values) {
      var settled = copyTarget(values);
      target = settled;
      job = null;
      for (var index = 0; index < count; index += 1) {
        parts[index].enter = settled[index] ? 1 : 0;
        parts[index].exit = 0;
        parts[index].phase = settled[index] ? 'visible' : 'hidden';
      }
      // Settling is immediate, but does not implicitly resume a paused clock.
    }

    function pause(now) {
      var elapsed = elapsedSinceLast(now);
      if (paused) return;
      // Sample only the current job at the pause boundary; do not start another.
      advanceJob(elapsed);
      paused = true;
    }

    function resume(now) {
      time(now);
      if (!paused) return;
      // Consume the paused wall time without advancing the saved job elapsed.
      elapsedSinceLast(now);
      paused = false;
    }

    return {
      setTarget: setTarget,
      tick: tick,
      snapshot: snapshot,
      settle: settle,
      pause: pause,
      resume: resume
    };
  }

  return { create: create };
});
