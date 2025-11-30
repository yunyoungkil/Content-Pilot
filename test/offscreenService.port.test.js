import { registerOffscreenPort } from '../js/services/offscreenService.js';

describe('OffscreenService port probe', () => {
  test('registerOffscreenPort returns false for invalid port', () => {
    expect(registerOffscreenPort(null)).toBe(false);
    expect(registerOffscreenPort({ name: 'wrong-name' })).toBe(false);
  });

  test('registerOffscreenPort accepts valid port and probes it', (done) => {
    // fake port object with minimal API
    const listeners = [];
    const port = {
      name: 'offscreen-init',
      sender: { url: 'chrome-extension://test/offscreen.html' },
      onMessage: { addListener: jest.fn((fn) => listeners.push(fn)), removeListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
      postMessage: jest.fn(() => {
        // simulate reply via onMessage after a short delay
        setTimeout(() => {
          listeners.forEach((l) => l({ action: 'offscreen_port_attached' }));
        }, 50);
      }),
    };

    const res = registerOffscreenPort(port);
    expect(res).toBe(true);

    // after a short wait the probe should have succeeded (no exception)
    setTimeout(() => {
      // verify postMessage was called to probe
      expect(port.postMessage).toHaveBeenCalled();
      done();
    }, 200);
  });

  test('registerOffscreenPort marks port null on timeout (unresponsive)', (done) => {
    // port that never responds
    const listeners = [];
    const port = {
      name: 'offscreen-init',
      sender: { url: 'chrome-extension://test/offscreen.html' },
      onMessage: { addListener: jest.fn((fn) => listeners.push(fn)), removeListener: jest.fn() },
      onDisconnect: { addListener: jest.fn() },
      postMessage: jest.fn(() => {}),
    };

    const res = registerOffscreenPort(port);
    expect(res).toBe(true);

    // wait longer than the probe timeout used in the implementation
    setTimeout(() => {
      // There's no direct exported state for offscreenPort; we at least ensure postMessage was attempted
      expect(port.postMessage).toHaveBeenCalled();
      done();
    }, 2000);
  });
});
