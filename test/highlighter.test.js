// test/highlighter.test.js

import { setupHighlighter, resetHighlighterForTests } from '../js/core/highlighter.js';

describe('highlighter.setupHighlighter', () => {
  beforeEach(() => {
    // ensure no leftover listeners from previous tests
    try {
      resetHighlighterForTests();
    } catch (e) {}
    // Ensure fresh environment
    delete window.__pilotHighlightInitialized;
    document.body.innerHTML = '';

    // chrome.storage mocks
    global.chrome.storage.local.get.mockImplementation((keys, cb) => {
      // initial get for config
      if (Array.isArray(keys)) return cb({ isScrapingActive: true, highlightToggleState: true });
      // fallback
      return cb({});
    });

    // onChanged mock
    chrome.storage.onChanged = { addListener: jest.fn() };

    // runtime sendMessage stub
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') {
        return cb({ success: true, data: { myChannels: { blogs: [{ id: 'id1', inputUrl: 'blog1' }] } } });
      }
      if (cb) cb({ success: true });
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('is idempotent and sets initialization flag', () => {
    expect(window.__pilotHighlightInitialized).toBeUndefined();
    setupHighlighter();
    expect(window.__pilotHighlightInitialized).toBe(true);
    // calling again does not throw and keeps flag true
    expect(() => setupHighlighter()).not.toThrow();
    expect(window.__pilotHighlightInitialized).toBe(true);
  });

  test('mouseover adds highlight and mouseout clears it', () => {
    setupHighlighter();

    const el = document.createElement('div');
    document.body.appendChild(el);

    // mouseover should add pilot-highlight
    const over = new MouseEvent('mouseover', { bubbles: true });
    el.dispatchEvent(over);
    expect(el.classList.contains('pilot-highlight')).toBe(true);

    // mouseout with relatedTarget null should clear
    const out = new MouseEvent('mouseout', { bubbles: true, relatedTarget: null });
    el.dispatchEvent(out);
    expect(el.classList.contains('pilot-highlight')).toBe(false);
  });

  test('registers storage.onChanged listener', () => {
    setupHighlighter();
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
    const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];
    expect(typeof listener).toBe('function');
  });

  test('storage.onChanged effect: toggling isScrapingActive via listener disables highlight', () => {
    // initial state: active
    setupHighlighter();

    // ensure listener was registered
    expect(chrome.storage.onChanged.addListener).toHaveBeenCalled();
    const listener = chrome.storage.onChanged.addListener.mock.calls[0][0];
    expect(typeof listener).toBe('function');

    // simulate storage change: isScrapingActive -> false
    listener({ isScrapingActive: { newValue: false } }, 'local');

    // element should NOT get highlighted now
    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    el2.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(el2.classList.contains('pilot-highlight')).toBe(false);
  });

  test('respects initial storage settings (isScrapingActive=false) and does not highlight', () => {
    // ensure clean environment
    resetHighlighterForTests();

    // initial storage returns false
    chrome.storage.local.get.mockImplementation((keys, cb) => {
      if (Array.isArray(keys)) return cb({ isScrapingActive: false, highlightToggleState: true });
      return cb({});
    });

    setupHighlighter();

    const el2 = document.createElement('div');
    document.body.appendChild(el2);
    el2.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(el2.classList.contains('pilot-highlight')).toBe(false);
  });

  test('click on highlighted element triggers modal creation', (done) => {
    // make sure active channel exists and scraping active
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (key === 'activeChannelId') return cb({ activeChannelId: 'id1' });
      if (Array.isArray(key)) return cb({ isScrapingActive: true, highlightToggleState: true });
      return cb({});
    });

    setupHighlighter();

    // create an element and simulate highlight
    const el = document.createElement('div');
    el.innerHTML = '<p>테스트 문장</p><img src="/img.png">';
    document.body.appendChild(el);

    // highlight via mouseover
    el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(el.classList.contains('pilot-highlight')).toBe(true);

    // Now click; since callbacks in our mock are synchronous, modal should be created
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // Allow microtasks to settle
    setTimeout(() => {
      const modal = document.getElementById('scrap-save-modal');
      expect(modal).toBeTruthy();
      if (modal) modal.remove();
      done();
    }, 0);
  });
});
