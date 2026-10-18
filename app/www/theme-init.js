(function () {
  try {
    var saved = localStorage.getItem('anirss-theme') || localStorage.getItem('qbrss-theme');
    var theme = saved === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f7fb' : '#070b11');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
