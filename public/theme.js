// Sets the light or dark theme before the first paint. It is a file, not an inline script,
// so a strict Content-Security-Policy (script-src 'self') can be used on the web.
try {
  var t = localStorage.getItem('mr.theme') || 'system'
  var dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
} catch (e) {}
