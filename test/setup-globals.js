// test/setup-globals.js - Early setup for Jest to create global mocks
// This file is executed before test modules load so top-level imports
// see the mocked globals (chrome, firebase, fetch, etc.).

// NOTE: keep this file minimal and avoid using Jest lifecycle helpers
// (beforeEach/afterEach) because setupFiles run before the test runner
// sets up those globals.

// Global variable mocks
global.chrome = {
  runtime: {
    getURL: jest.fn((path) => `chrome-extension://test-id/${path}`),
    connect: jest.fn(() => ({
      onDisconnect: { addListener: jest.fn() },
      onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
      disconnect: jest.fn(),
    })),
    sendMessage: jest.fn(),
    onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
    onConnect: { addListener: jest.fn(), removeListener: jest.fn() },
    onInstalled: { addListener: jest.fn() },
    onStartup: { addListener: jest.fn() },
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
  action: {
    setBadgeText: jest.fn(),
  },
  alarms: {
    create: jest.fn(),
    clear: jest.fn(),
    onAlarm: { addListener: jest.fn(), removeListener: jest.fn() },
  },
  offscreen: {
    createDocument: jest.fn(() => Promise.resolve()),
    closeDocument: jest.fn(() => Promise.resolve()),
    hasDocument: jest.fn(() => Promise.resolve(false)),
  },
};

// Fetch API mock
global.fetch = jest.fn();

// Response class mock
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

// Marked library mock
jest.mock("marked", () => ({
  marked: {
    parse: jest.fn((text) => `<p>${text}</p>`),
  },
}));

// Firebase mock (expose both app() and top-level database())
global.firebase = {
  initializeApp: jest.fn(),
  app: jest.fn(() => ({
    database: jest.fn(() => ({
      ref: jest.fn(() => ({
        set: jest.fn(),
        get: jest.fn(),
        once: jest.fn((ev, cb) => {
          if (typeof cb === 'function') {
            cb({ val: () => null, exists: () => false, key: 'test-key' });
            return Promise.resolve();
          }
          return Promise.resolve({ val: () => null, exists: () => false, key: 'test-key' });
        }),
        update: jest.fn(),
        remove: jest.fn(),
        push: jest.fn(),
        onValue: jest.fn(),
        off: jest.fn(),
      })),
    })),
  })),
  // Provide direct firebase.database() for older callsites
  database: jest.fn(() => global.firebase.app().database()),
};

// DOM compatibility helpers
Object.defineProperty(window, "self", { value: window, writable: false });
global.ServiceWorkerGlobalScope = class {};

// Export nothing — this file intentionally only sets globals
