// TrailBuddy — app bootstrap and UI logic will live here.

(async () => {
  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    console.log(data);
  } catch (err) {
    console.error('Health check failed:', err);
  }
})();
