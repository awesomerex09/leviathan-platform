// Shared preview/site data fetch policy.
//
// Keep hot pages on stable URLs so CDN/browser caches can work. If we need to
// adjust fetch behaviour later, change this file once instead of patching every
// page-specific inline script.
(() => {
  async function fetchJson(url, opts = {}) {
    const { optional = false } = opts;
    const response = await fetch(url, {
      cache: 'default',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      if (optional && response.status === 404) return null;
      throw new Error(`HTTP ${response.status}: ${url}`);
    }
    return response.json();
  }

  window.leviathanData = Object.freeze({
    fetchJson,
    fetchOptionalJson(url, opts = {}) {
      return fetchJson(url, { ...opts, optional: true });
    },
  });
})();
