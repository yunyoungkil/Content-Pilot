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
    onChanged: {
      addListener: jest.fn(),
      removeListener: jest.fn(),
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
    getAuthToken: jest.fn((options, callback) => {
      // support both (callback) and (options, callback)
      if (typeof options === "function") {
        callback = options;
      }
      if (typeof callback === "function") callback("test-token");
      return;
    }),
    removeCachedAuthToken: jest.fn((details, cb) => {
      if (typeof details === "function") {
        cb = details;
      }
      if (typeof cb === "function") cb();
      return;
    }),
  },
};

// export named helper for tests that import { testHelpers } from './setup.js' (export declared after _testHelpers)

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

// Service Worker 환경 모킹
global.ServiceWorkerGlobalScope = class {};

// 공통 테스트 헬퍼 함수들
const _testHelpers = {
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
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      // 메시지 리스너들에게 브로드캐스트
      listeners.forEach((listener) => {
        try {
          listener(message, {}, () => {});
        } catch (e) {
          // 에러 무시
        }
      });
      if (callback) callback({ success: true });
    });

    chrome.runtime.onMessage.addListener.mockImplementation((listener) => {
      listeners.push(listener);
    });

    return {
      listeners,
      sendMessage: chrome.runtime.sendMessage,
      triggerMessage: (message) => {
        listeners.forEach((listener) => {
          listener(message, {}, () => {});
        });
      },
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
  jest.clearAllMocks();
  jest.clearAllTimers();

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
  // 타이머 정리
  jest.clearAllTimers();
});
