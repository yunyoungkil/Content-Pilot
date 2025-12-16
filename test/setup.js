// test/setup.js - Jest 테스트 설정 및 공통 유틸리티

// 전역 변수 모킹
global.chrome = {
  runtime: {
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    connect: jest.fn(() => ({
      onDisconnect: { addListener: jest.fn() },
      disconnect: jest.fn(),
    })),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn() },
  },
  storage: {
    local: {
      get: jest.fn(),
      set: jest.fn(),
    },
  },
  tabs: {
    query: jest.fn(),
    create: jest.fn(),
  },
  windows: {
    create: jest.fn(),
  },
  identity: {
    getAuthToken: jest.fn(),
    removeCachedAuthToken: jest.fn(),
  },
};

// Ensure workspace globals are clean before each test to avoid initialization pollution
beforeEach(() => {
  try {
    window.__cp_workspace_idea_id = undefined;
    window.__cp_workspace_idea_data = undefined;
    window.__cp_force_save_title = undefined;
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    if (window.__cp_tui_shadow_listener_attached) window.__cp_tui_shadow_listener_attached = false;
  } catch (e) {}
});

// Global cleanup after each test to avoid order-dependent leakage
afterEach(() => {
  try {
    jest.useRealTimers();
  } catch (e) {
    // ignore if timers already real
  }

  // Clear DOM
  try { document.body.innerHTML = ''; } catch (e) {}

  // Reset workspace globals
  try {
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    if (window.__cp_tui_shadow_listener_attached) window.__cp_tui_shadow_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_workspace_idea_data = undefined;
    window.__cp_force_save_title = undefined;
  } catch (e) {
    // ignore
  }

  // Clear any window event listeners we tracked
  try { _clearTrackedWindowListeners(); } catch (e) {}

  // Reset chrome runtime/helpers to defaults to avoid mocks leaking between tests
  try {
    chrome.runtime.sendMessage = jest.fn();
    chrome.runtime.onMessage = { addListener: jest.fn() };
    // Reset storage helpers
    chrome.storage.local.get = jest.fn();
    chrome.storage.local.set = jest.fn();
    // Remove any helper trigger function that mockChromeRuntime may have attached
    try { delete chrome.runtime.triggerMessage; } catch (e) {}
  } catch (e) {}
});

// Fetch API 모킹
global.fetch = jest.fn();

// Response 객체 모킹 (Firebase에서 사용)
global.Response = class {
  constructor(body, options = {}) {
    this.body = body;
    this.status = options.status || 200;
    this.statusText = options.statusText || "";
    this.headers = options.headers || new Map();
  }

  json() {
    return Promise.resolve(JSON.parse(this.body));
  }

  text() {
    return Promise.resolve(this.body);
  }
};

// Marked 라이브러리 모킹
jest.mock("marked", () => ({
  marked: {
    parse: jest.fn((text) => `<p>${text}</p>`),
  },
}));

// Firebase 모킹
global.firebase = {
  initializeApp: jest.fn(),
  app: jest.fn(() => ({
    database: jest.fn(() => ({
      ref: jest.fn(() => ({
        set: jest.fn(),
        get: jest.fn(),
        update: jest.fn(),
        remove: jest.fn(),
        push: jest.fn(),
        onValue: jest.fn(),
        off: jest.fn(),
      })),
    })),
  })),
};

// DOM API 모킹 (jsdom에서 제공되지 않는 부분)
Object.defineProperty(window, "self", {
  value: window,
  writable: false,
});

// Track window event listeners to allow clean teardown between tests
(() => {
  const originalAdd = window.addEventListener.bind(window);
  const originalRemove = window.removeEventListener.bind(window);
  const tracked = new Map(); // eventType => Set<listener>

  window.addEventListener = (type, listener, opts) => {
    if (!tracked.has(type)) tracked.set(type, new Set());
    tracked.get(type).add(listener);
    return originalAdd(type, listener, opts);
  };

  window.removeEventListener = (type, listener, opts) => {
    if (tracked.has(type)) tracked.get(type).delete(listener);
    return originalRemove(type, listener, opts);
  };

  // Expose helper for tests to remove all tracked listeners
  Object.defineProperty(global, '_clearTrackedWindowListeners', {
    value: () => {
      for (const [type, set] of tracked.entries()) {
        for (const listener of Array.from(set)) {
          try {
            originalRemove(type, listener);
          } catch (e) {
            /* ignore */
          }
        }
      }
      tracked.clear();
    },
    writable: false,
  });
})();

// Service Worker 환경 모킹
global.ServiceWorkerGlobalScope = class {};

// 공통 테스트 헬퍼 함수들
global.testHelpers = {
  // Firebase 모킹 헬퍼
  mockFirebaseResponse: (data) => ({
    val: () => data,
    exists: () => !!data,
    key: "test-key",
  }),

  mockFirebaseRef: (initialData = {}) => {
    const data = { ...initialData };
    return {
      set: jest.fn((newData) => {
        Object.assign(data, newData);
        return Promise.resolve();
      }),
      get: jest.fn(() =>
        Promise.resolve({
          val: () => data,
          exists: () => !!data,
          key: "test-key",
        })
      ),
      update: jest.fn((updates) => {
        Object.assign(data, updates);
        return Promise.resolve();
      }),
      remove: jest.fn(() => {
        Object.keys(data).forEach((key) => delete data[key]);
        return Promise.resolve();
      }),
      push: jest.fn((newData) => {
        const newKey = `test-key-${Date.now()}`;
        data[newKey] = newData;
        return {
          key: newKey,
          set: jest.fn(() => Promise.resolve()),
        };
      }),
      onValue: jest.fn(),
      off: jest.fn(),
    };
  },

  // Chrome API 모킹 헬퍼
  mockChromeStorage: (initialData = {}) => {
    const storage = {};
    Object.assign(storage, initialData);

    chrome.storage.local.get.mockImplementation((keys, callback) => {
      if (typeof keys === "string") {
        callback({ [keys]: storage[keys] });
      } else if (Array.isArray(keys)) {
        const result = {};
        keys.forEach((key) => {
          result[key] = storage[key];
        });
        callback(result);
      } else {
        callback(storage);
      }
    });

    chrome.storage.local.set.mockImplementation((data, callback) => {
      Object.assign(storage, data);
      if (callback) callback();
    });

    return storage;
  },

  // Chrome Runtime 모킹 헬퍼
  mockChromeRuntime: () => {
    const listeners = [];
    // Always reset sendMessage to a fresh mock so individual tests can
    // override it without leaking behavior across tests.
    chrome.runtime.sendMessage = jest.fn((message, callback) => {
      // For image fetch, do not notify listeners to avoid side effects; just return test data
      if (message && message.action === 'fetch_image_as_base64') {
        if (callback)
          callback({ success: true, dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA' });
        return;
      }
      // For other messages, broadcast to listeners
      listeners.forEach((listener) => {
        try {
          listener(message, {}, () => {});
        } catch (e) {
          // ignore
        }
      });
      if (callback) callback({ success: true });
    });

    // Reset onMessage listener registration helper
    chrome.runtime.onMessage = { addListener: jest.fn() };
    chrome.runtime.onMessage.addListener.mockImplementation((listener) => {
      listeners.push(listener);
    });

    // expose triggerMessage as a helper on chrome.runtime for tests that call it directly
    chrome.runtime.triggerMessage = (message) => {
      listeners.forEach((listener) => {
        try {
          listener(message, {}, () => {});
        } catch (e) {
          // ignore
        }
      });
    };

    return {
      listeners,
      sendMessage: chrome.runtime.sendMessage,
      triggerMessage: chrome.runtime.triggerMessage,
    };
  },

  // 비동기 작업 완료 대기
  waitForNextTick: () => new Promise((resolve) => setTimeout(resolve, 0)),

  waitForMs: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),

  // DOM 이벤트 시뮬레이션
  simulateEvent: (element, eventType, options = {}) => {
    const event = new Event(eventType, { bubbles: true, ...options });
    element.dispatchEvent(event);
  },

  simulateClick: (element) => {
    const event = new MouseEvent("click", { bubbles: true });
    element.dispatchEvent(event);
  },

  simulateInput: (element, value) => {
    element.value = value;
    const event = new Event("input", { bubbles: true });
    element.dispatchEvent(event);
  },

  // DOM 요소 생성 헬퍼
  createTestElement: (tag = "div", attributes = {}) => {
    const element = document.createElement(tag);
    Object.keys(attributes).forEach((attr) => {
      if (attr === "textContent") {
        element.textContent = attributes[attr];
      } else if (attr === "innerHTML") {
        element.innerHTML = attributes[attr];
      } else {
        element.setAttribute(attr, attributes[attr]);
      }
    });
    return element;
  },

  // 콘솔 출력 캡처 헬퍼
  captureConsole: () => {
    const originalConsole = { ...console };
    const logs = { log: [], warn: [], error: [] };

    ["log", "warn", "error"].forEach((method) => {
      console[method] = (...args) => {
        logs[method].push(args);
        originalConsole[method](...args);
      };
    });

    return {
      logs,
      restore: () => {
        Object.assign(console, originalConsole);
      },
    };
  },

  // API 응답 모킹 헬퍼
  mockApiResponse: (status = 200, data = {}, headers = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
    headers: {
      get: (name) => headers[name],
    },
  }),

  // 네트워크 에러 모킹
  mockNetworkError: (message = "Network Error") => {
    const error = new Error(message);
    error.name = "NetworkError";
    return error;
  },

  // 로컬 스토리지 모킹 헬퍼
  mockLocalStorage: (initialData = {}) => {
    const storage = { ...initialData };
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;
    const originalClear = Storage.prototype.clear;

    Storage.prototype.getItem = jest.fn((key) => storage[key] || null);
    Storage.prototype.setItem = jest.fn((key, value) => {
      storage[key] = value;
    });
    Storage.prototype.removeItem = jest.fn((key) => {
      delete storage[key];
    });
    Storage.prototype.clear = jest.fn(() => {
      Object.keys(storage).forEach((key) => delete storage[key]);
    });

    return {
      storage,
      restore: () => {
        Storage.prototype.getItem = originalGetItem;
        Storage.prototype.setItem = originalSetItem;
        Storage.prototype.removeItem = originalRemoveItem;
        Storage.prototype.clear = originalClear;
      },
    };
  },
};

// 테스트 전후 정리
beforeEach(() => {
  // Note: Do not call jest.resetModules() here; individual tests should
  // reset modules when required to avoid breaking shared mocks.
  // Clear mocks and timers between tests so mock calls and
  // timers are reset. Also ensure a safe default chrome.runtime
  // sendMessage implementation so UI tests have a consistent
  // base implementation to rely on.
  jest.clearAllMocks();
  jest.clearAllTimers();
  // Reset any global TUI/workspace flags to avoid cross-test leakage
  try {
    window.__cp_tui_global_listener_attached = false;
    window.__cp_tui_listener_attached = false;
    window.__cp_tui_shadow_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
  } catch (e) {
    // ignore in non-browser environments
  }
  // Ensure a fresh chrome.runtime mock per test to avoid leakage.
  // This provides a consistent default; individual tests may override it.
  try { testHelpers.mockChromeRuntime(); } catch (e) {}
  // NOTE: keep mock implementations in individual tests
  // (tests can call testHelpers.mockChromeRuntime() when
  // they need runtime listener behavior).

  // 각 테스트마다 로컬 스토리지 초기화
  Object.defineProperty(window, "localStorage", {
    value: {
      getItem: jest.fn(),
      setItem: jest.fn(),
      removeItem: jest.fn(),
      clear: jest.fn(),
    },
    writable: true,
  });
});

afterEach(() => {
  // Clear any window listeners that were registered during the test
  try {
    if (typeof global._clearTrackedWindowListeners === 'function') {
      global._clearTrackedWindowListeners();
    }
  } catch (e) {
    /* ignore */
  }
});

afterEach(() => {
  // 타이머 정리
  jest.clearAllTimers();
});
