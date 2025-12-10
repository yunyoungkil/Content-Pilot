import { registerOffscreenPort, fetchUrlInOffscreen } from '../js/services/offscreenService.js';

describe('OffscreenService fetch URL wrapper', () => {
  let runtime;
  beforeEach(() => {
    jest.resetModules();
    // ensure no real offscreen port set
  });
  beforeEach(() => {
    runtime = global.testHelpers.mockChromeRuntime();
    // Mock chrome.offscreen for tests
    if (!chrome.offscreen) chrome.offscreen = {};
    chrome.offscreen.createDocument = jest.fn().mockResolvedValue(true);
    chrome.offscreen.closeDocument = jest.fn().mockResolvedValue(true);
    chrome.offscreen.hasDocument = jest.fn().mockResolvedValue(true);
    // Ensure onConnect exists for runtime
    if (!chrome.runtime.onConnect)
      chrome.runtime.onConnect = { addListener: jest.fn(), removeListener: jest.fn() };
    if (!chrome.runtime.onMessage.removeListener)
      chrome.runtime.onMessage.removeListener = jest.fn();
    wirePingResponse(runtime);
  });
  // helper to wire ping responses during tests so ensureOffscreenDocument's ping verifies
  // wirePingResponse(runtime, responseMap?)
  // responseMap: { actionName: function(message) => responseObj }
  function wirePingResponse(runtime, responseMap = {}) {
    const originalSend = chrome.runtime.sendMessage;
    // override to intercept ping messages and reply on the onMessage channel
    chrome.runtime.sendMessage = jest.fn((message, callback) => {
      // If sender is a ping, schedule a response
      if (message && message.action === 'offscreen_ping') {
        setTimeout(() => {
          runtime.triggerMessage({ action: 'offscreen_ping_response' });
        }, 10);
      }
      // If a specific response was registered, schedule it
      if (message && responseMap && typeof responseMap[message.action] === 'function') {
        const resp = responseMap[message.action](message);
        setTimeout(() => {
          runtime.triggerMessage(resp);
        }, 20);
      }
      // call original behavior for other messages
      return originalSend(message, callback);
    });
  }

  test('fetchUrlInOffscreen resolves when offscreen responds with HTML', async () => {
    const listeners = [];
    const port = {
      name: 'offscreen-init',
      sender: { url: 'chrome-extension://test/offscreen.html' },
      onMessage: { addListener: jest.fn((fn) => listeners.push(fn)), removeListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
      postMessage: jest.fn((msg) => {
        // echo a success response for fetch_url_in_offscreen; also provide onConnect callback so ensureOffscreenDocument can pick up the port
        setTimeout(() => {
          listeners.forEach((l) =>
            l({
              action: 'fetch_url_in_offscreen_response',
              success: true,
              html: '<html>OK</html>',
              requestId: msg.requestId,
            })
          );
        }, 10);
      }),
    };
    // Mock runtime.onConnect to immediately call handler with our port so ensureOffscreenDocument's onConnect picks it up
    chrome.runtime.onConnect.addListener.mockImplementation((fn) => fn(port));

    expect(registerOffscreenPort(port)).toBe(true);
    // ensure sendMessage interceptor responds to fetch_url requests
    wirePingResponse(runtime, {
      fetch_url_in_offscreen: (msg) => ({
        action: 'fetch_url_in_offscreen_response',
        success: true,
        html: '<html>OK</html>',
        requestId: msg.requestId,
      }),
    });
    const result = await fetchUrlInOffscreen('https://example.test/path');
    expect(result).toBe('<html>OK</html>');
  });

  test('fetchUrlInOffscreen rejects with rich error when offscreen returns error', async () => {
    const listeners = [];
    const port = {
      name: 'offscreen-init',
      sender: { url: 'chrome-extension://test/offscreen.html' },
      onMessage: { addListener: jest.fn((fn) => listeners.push(fn)), removeListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
      postMessage: jest.fn((msg) => {
        // reply with structured error fields; also ensure port is used by ensureOffscreenDocument
        setTimeout(() => {
          listeners.forEach((l) =>
            l({
              action: 'fetch_url_in_offscreen_response',
              success: false,
              error: 'Failed to fetch',
              errorName: 'TypeError',
              errorStack: 'stacktrace',
              requestId: msg.requestId,
            })
          );
        }, 10);
      }),
    };
    chrome.runtime.onConnect.addListener.mockImplementation((fn) => fn(port));

    expect(registerOffscreenPort(port)).toBe(true);
    wirePingResponse(runtime, {
      fetch_url_in_offscreen: (msg) => ({
        action: 'fetch_url_in_offscreen_response',
        success: false,
        error: 'Failed to fetch',
        errorName: 'TypeError',
        errorStack: 'stacktrace',
        requestId: msg.requestId,
      }),
    });
    await expect(fetchUrlInOffscreen('https://example.test/bad')).rejects.toMatchObject({
      message: 'Failed to fetch',
      name: 'TypeError',
    });
  });
});
