// offscreen-beacon.js
// Small external script loaded by offscreen.html (avoids CSP block on inline scripts)
(() => {
  // Wait for offscreen handlers to be installed before sending the beacon.
  // Many race conditions happen because the beacon runs before the main
  // bundle has registered message handlers. The bundle sets
  // window.__offscreen_handlers_installed = true when ready; poll for it.
  const maxWait = 30000; // 30s total - give bundle more time to register handlers
  const interval = 200; // check every 200ms
  let waited = 0;
  const trySend = () => {
    try {
      // Prefer sendMessage, but also attempt a short-lived port connection
      // if runtime.connect is available. Port-based beacons are more
      // robust against race conditions where runtime.sendMessage may
      // be missed due to listener installation timing.
      // Keep the beacon lightweight: do not open a port here. Opening
      // a short-lived port can cause the background to treat the port as
      // a readiness signal (race). Use runtime.sendMessage only.
      // best-effort send — swallow any rejection to avoid an
      // Uncaught(in promise) error when other listeners mis-handle
      // the message channel (we don't require a response here)
      try {
        chrome.runtime
          .sendMessage({ action: 'offscreen_ready_beacon', immediate: true })
          .catch(() => {});
      } catch (e) {}
      console.debug('[Offscreen-Beacon] sent offscreen_ready_beacon via sendMessage');
      return true;
    } catch (e) {
      console.debug('[Offscreen-Beacon] sendMessage failed', e);
      return false;
    }
  };

  const poll = setInterval(() => {
    try {
      // prefer to wait for handlers flag
      if (window.__offscreen_handlers_installed) {
        clearInterval(poll);
        trySend();
        return;
      }
    } catch (e) {}

    waited += interval;
    if (waited >= maxWait) {
      clearInterval(poll);
      // fallback: still try to send the message (best-effort)
      console.debug(
        '[Offscreen-Beacon] handlers not observed within wait window, sending fallback beacon'
      );
      trySend();
    }
  }, interval);

  // Avoid creating a second port here. Offscreen bundle (offscreen.js)
  // already creates a persistent port and registers onMessage handlers.
  // Creating another port from the beacon can overwrite the background's
  // stored port and cause messages to be sent to a listener-less port.
  // So we only send a runtime message here as a lightweight beacon.
})();
