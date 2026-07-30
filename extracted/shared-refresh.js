// Auto-refresh tab when user returns after a while.
// Cron updates JSON throughout the day; tabs left open should not show
// stale data after the user comes back from another app.
//
// Strategy: on visibilitychange→visible, if >60s since last load, reload.
(() => {
  const STALE_MS = 60_000;
  const loadedAt = Date.now();

  // Skip on admin pages — no auto-reload during editing.
  if (location.pathname.startsWith('/admin')) return;

  function removeLegacyRefreshBadges() {
    for (const button of document.querySelectorAll('body > button')) {
      if (button.textContent?.trim().startsWith('資料 ')) button.remove();
    }
  }

  removeLegacyRefreshBadges();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', removeLegacyRefreshBadges, { once: true });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - loadedAt > STALE_MS) {
      removeLegacyRefreshBadges();
      location.reload();
    }
  });
})();

// Shared masthead traffic pulse. The JSON is generated server-side from
// Cloudflare Web Analytics so tokens never reach the browser.
(() => {
  if (location.pathname.startsWith('/admin')) return;

  const STAT_URL = '/preview/site-stats.json';
  const REFRESH_MS = 60_000;
  const INITIAL_FETCH_DELAY_MS = 1_500;
  const mobileQuery = window.matchMedia('(max-width: 640px)');
  const fetchJson = window.etfedgeData?.fetchJson || ((url) => fetch(url, {
    cache: 'default',
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  }).then((r) => (r.ok ? r.json() : null)));
  let lastPayload = null;

  function ensurePulseStyles() {
    if (document.getElementById('site-pulse-style')) return;
    const style = document.createElement('style');
    style.id = 'site-pulse-style';
    style.textContent = `
      .site-pulse{display:inline-flex;align-items:baseline;gap:8px;max-width:100%;white-space:nowrap}
      .site-pulse::before{content:"";width:1px;height:12px;align-self:center}
      .site-pulse-metric{display:inline-flex;align-items:baseline;gap:3px}
      .mast-r .site-pulse,.etf-mast-r .site-pulse{color:var(--fog,#96a2a4)}
      .mast-r .site-pulse::before,.etf-mast-r .site-pulse::before{background:rgba(255,255,255,.16)}
      .site-pulse-label{font-size:8px;letter-spacing:.08em;color:var(--fog,#96a2a4)}
      .site-pulse-value{font-size:10px;line-height:1;font-weight:700;letter-spacing:-.02em;color:#fff}
      .site-pulse-active{color:var(--up,#ef8e78)}
      .bar .site-pulse{margin-left:auto;color:var(--fog,#96a2a4)}
      .bar .site-pulse::before{background:var(--night-rule-strong,#5a6a6d)}
      .bar .site-pulse-label{color:var(--fog,#96a2a4)}
      .bar .site-pulse-value{color:#fff}
      @media (max-width:640px){
        .site-pulse{flex:0 1 auto;gap:4px;min-width:0}
        .site-pulse::before{display:none}
        .mast-r .site-pulse{margin-left:0}
        .etf-mast-r .site-pulse{flex:1 0 100%;margin-left:0}
        .bar .site-pulse{flex:1 0 100%;margin-left:0;justify-content:flex-start;padding-top:2px}
        .site-pulse-label{font-size:8px;letter-spacing:.02em}
        .site-pulse-value{font-size:10px}
      }
      @media (max-width:380px){.site-pulse-label{font-size:7px}.site-pulse-value{font-size:9px}}
    `;
    document.head.appendChild(style);
  }

  const compact = (n) => {
    if (n == null || Number.isNaN(Number(n))) return '—';
    const v = Number(n);
    if (v >= 10000) return `${(v / 10000).toFixed(v >= 100000 ? 0 : 1)}萬`;
    return Math.round(v).toLocaleString();
  };

  function createPulse() {
    const pulse = document.createElement('span');
    pulse.className = 'site-pulse';
    pulse.setAttribute('aria-live', 'polite');
    pulse.innerHTML = `
      <span class="site-pulse-metric site-pulse-primary">
        <span class="site-pulse-label" data-pulse-total-label>瀏覽人數</span>
        <span class="site-pulse-value site-pulse-active" data-pulse-total>—</span>
      </span>
    `;
    return pulse;
  }

  function render(pulse, d) {
    lastPayload = d;
    const totalLabel = pulse.querySelector('[data-pulse-total-label]');
    const totalEl = pulse.querySelector('[data-pulse-total]');
    if (totalLabel) totalLabel.textContent = mobileQuery.matches ? '瀏覽' : '瀏覽人數';
    if (!totalEl) return;

    if (!d?.ok) {
      totalEl.textContent = '—';
      return;
    }

    totalEl.textContent = compact(d.total?.visits ?? d.today?.visits);
  }

  function init() {
    const host = document.querySelector('.mast-r, .etf-mast-r, .bar');
    if (!host) return;

    ensurePulseStyles();
    const pulse = createPulse();
    const mount = () => {
      if (!host.contains(pulse)) host.appendChild(pulse);
    };
    const refresh = () => {
      fetchJson(STAT_URL)
        .then((d) => render(pulse, d))
        .catch(() => render(pulse, null));
    };
    const scheduleInitialRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      const run = () => window.setTimeout(refresh, INITIAL_FETCH_DELAY_MS);
      if (window.requestIdleCallback) {
        window.requestIdleCallback(run, { timeout: INITIAL_FETCH_DELAY_MS + 1_000 });
      } else {
        run();
      }
    };

    mount();
    new MutationObserver(mount).observe(host, { childList: true });
    scheduleInitialRefresh();
    setInterval(refresh, REFRESH_MS);
    const rerenderForViewport = () => render(pulse, lastPayload);
    if (mobileQuery.addEventListener) {
      mobileQuery.addEventListener('change', rerenderForViewport);
    } else if (mobileQuery.addListener) {
      mobileQuery.addListener(rerenderForViewport);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
