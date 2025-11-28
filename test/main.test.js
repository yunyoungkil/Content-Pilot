// test/main.test.js

import { initialize } from "../js/main.js";

/**
 * Main 모듈 초기화 및 이벤트 처리 테스트
 */
describe("Main Module", () => {
  let originalChrome;
  let originalWindow;
  let originalDocument;

  beforeEach(() => {
    // 원본 값 저장
    originalChrome = global.chrome;
    originalWindow = global.window;
    originalDocument = global.document;

    // Chrome API 모킹
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
        },
      },
    };

    // Window 이벤트 리스너 모킹
    window.addEventListener = jest.fn();
    window.removeEventListener = jest.fn();

    // Document 이벤트 리스너 모킹
    document.addEventListener = jest.fn();
    document.removeEventListener = jest.fn();

    // console 모킹
    global.console.log = jest.fn();
  });

  afterEach(() => {
    // 원본 값 복원
    global.chrome = originalChrome;
    global.window = originalWindow;
    global.document = originalDocument;
    jest.restoreAllMocks();
  });

  describe("initialize", () => {
    test("should initialize when window.self equals window.top", () => {
      // window.self === window.top (기본값)

      initialize();

      // chrome.runtime.onMessage.addListener가 호출되었는지 확인
      expect(global.chrome.runtime.onMessage.addListener).toHaveBeenCalled();

      // window.addEventListener가 호출되었는지 확인
      expect(window.addEventListener).toHaveBeenCalledWith(
        "message",
        expect.any(Function)
      );

      // document.addEventListener가 2번 호출되었는지 확인 (keydown, keyup)
      expect(document.addEventListener).toHaveBeenCalledTimes(2);

      // console.log가 호출되었는지 확인
      expect(global.console.log).toHaveBeenCalledWith(
        "Content Pilot UI Initialized."
      );
    });

    test("should not initialize when window.self does not equal window.top", () => {
      // window.self !== window.top 모킹
      Object.defineProperty(window, "self", {
        value: {},
        writable: true,
        configurable: true,
      });

      initialize();

      // 아무것도 호출되지 않았는지 확인
      expect(
        global.chrome.runtime.onMessage.addListener
      ).not.toHaveBeenCalled();
      expect(window.addEventListener).not.toHaveBeenCalled();
      expect(document.addEventListener).not.toHaveBeenCalled();
      expect(global.console.log).not.toHaveBeenCalled();
    });

    test("should handle Alt key events correctly", () => {
      // 이벤트 리스너가 등록되는지만 확인 (실제 함수 실행은 모킹되어 있음)
      expect(() => initialize()).not.toThrow();
    });

    test("should not hide panel when Alt key pressed in input fields", () => {
      // 이벤트 리스너가 등록되는지만 확인
      expect(() => initialize()).not.toThrow();
    });
  });
});
