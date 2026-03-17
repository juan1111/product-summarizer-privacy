(() => {
  if (window.__shopeeRatingsSnifferInstalled) return;
  window.__shopeeRatingsSnifferInstalled = true;

  const postPayload = (url, payload) => {
    try {
      if (!url || !String(url).includes('/item/get_ratings')) return;
      window.postMessage({ source: 'shopee-ratings-sniffer', url: String(url), payload }, '*');
    } catch {}
  };

  const originalFetch = window.fetch;
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);
    try {
      const input = args[0];
      const url = typeof input === 'string' ? input : input?.url;
      if (url && String(url).includes('/item/get_ratings')) {
        const clone = res.clone();
        clone
          .json()
          .then((json) => postPayload(url, json))
          .catch(() => {});
      }
    } catch {}
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ratingsUrl = url;
    return open.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener('load', function () {
      try {
        const url = this.__ratingsUrl;
        if (!url || !String(url).includes('/item/get_ratings')) return;
        const text = this.responseText;
        if (!text) return;
        postPayload(url, JSON.parse(text));
      } catch {}
    });
    return send.apply(this, args);
  };
})();

