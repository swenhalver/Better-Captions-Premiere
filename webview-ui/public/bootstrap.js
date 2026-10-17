/* Runs before the bundled editor so local module/CSP failures are visible in UXP. */
(function () {
  var nextId = 0;
  function report(stage, message) {
    if (!window.uxpHost || typeof window.uxpHost.postMessage !== 'function') return;
    try {
      window.uxpHost.postMessage({ channel: 'better-captions', id: 'ui-bootstrap-' + Date.now().toString(36) + '-' + ++nextId, method: 'diagnostic', args: [{ stage: stage, message: String(message).slice(0, 2000) }] });
    } catch (_) { /* The native host may still be opening. */ }
  }
  window.addEventListener('error', function (event) {
    var resource = event.target && (event.target.src || event.target.href);
    report('error', event.message || (resource ? 'Could not load ' + resource : 'The editor script failed to load.'));
  }, true);
  window.addEventListener('unhandledrejection', function (event) {
    report('error', event.reason && event.reason.message || event.reason || 'The editor reported an unhandled error.');
  });
  window.addEventListener('securitypolicyviolation', function (event) {
    report('policy', 'Content security policy blocked ' + event.violatedDirective + ': ' + event.blockedURI);
  });
  report('bootstrap', 'Local editor bootstrap loaded.');
}());
