(function (root) {
  const pending = [];
  const states = new WeakMap();
  let active = 0;
  function drain() {
    while (active < 4 && pending.length) {
      const { run, resolve } = pending.shift();
      active++;
      Promise.resolve().then(run).catch(() => false).then(resolve).finally(() => { active--; drain(); });
    }
  }

  // The image node survives all failures. A late primary response must not be lost
  // just because the metadata image failed first (or was absent entirely).
  function load(img, { primary, fallback, timeoutMs = 12000 }) {
    const state = {};
    states.set(img, state);
    const current = () => img.isConnected && states.get(img) === state;
    const mark = value => { if (current()) img.parentElement.dataset.posterState = value; };
    img.hidden = true;
    mark('loading');
    function tryImage(source, kind) {
      if (!current()) return Promise.resolve(false);
      return new Promise(resolve => {
        let timer;
        const finish = success => {
          clearTimeout(timer);
          img.removeEventListener('load', loaded);
          img.removeEventListener('error', failed);
          if (success && current()) {
            img.hidden = false;
            img.dataset.posterSource = kind;
            mark('loaded');
          }
          resolve(success && current());
        };
        const loaded = () => finish(true);
        const failed = () => finish(false);
        img.addEventListener('load', loaded);
        img.addEventListener('error', failed);
        timer = setTimeout(failed, timeoutMs);
        // Visibility is scheduled by the caller. Once selected, do not let a
        // browser's second lazy-load gate stall the fallback queue.
        img.loading = 'eager';
        img.decoding = 'async';
        img.src = source;
      });
    }
    return new Promise(resolve => {
      pending.push({ resolve, run: async () => {
        if (!current()) return false;
        let preferred;
        try { preferred = await primary?.(); } catch { /* Continue to public metadata artwork. */ }
        if (!current()) return false;
        if (preferred && await tryImage(preferred, 'primary')) return true;
        const alternatives = [...new Set([fallback].flat().filter(source => typeof source === 'string' && source && source !== preferred))];
        for (const source of alternatives) if (await tryImage(source, 'fallback')) return true;
        if (current()) { img.hidden = true; img.removeAttribute('src'); mark('unavailable'); }
        return false;
      } });
      drain();
    });
  }

  function fallback(id, supplied) {
    return supplied || (/^tt\d+$/.test(id) ? `https://images.metahub.space/poster/medium/${id}/img` : null);
  }
  root.VideoStorePosters = { load, fallback };
})(globalThis);
