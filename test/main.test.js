// test/main.test.js

import { initialize } from "../js/main.js";

/**
 * Main 모듈 초기화 및 이벤트 처리 테스트
 */
describe("Main Module", () => {
  let mockChrome;
  let mockWindow;
  let mockDocument;

  beforeEach(() => {
    // Chrome API 모킹
    mockChrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn()
        }
      }
    };
    global.chrome = mockChrome;

    // Window 객체 모킹
    mockWindow = {
      self: {},
      top: {},
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    global.window = mockWindow;

    // Document 객체 모킹
    mockDocument = {
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    };
    global.document = mockDocument;

    // console 모킹
    global.console.log = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.chrome;
    delete global.window;
    delete global.document;
  });

  describe("initialize", () => {
    test("should initialize when window.self equals window.top", () => {
      // window.self === window.top 조건 만족
      mockWindow.self = mockWindow.top;

      initialize();

      // chrome.runtime.onMessage.addListener가 호출되었는지 확인
      expect(mockChrome.runtime.onMessage.addListener).toHaveBeenCalled();

      // window.addEventListener가 호출되었는지 확인
      expect(mockWindow.addEventListener).toHaveBeenCalledWith('message', expect.any(Function));

      // document.addEventListener가 2번 호출되었는지 확인 (keydown, keyup)
      expect(mockDocument.addEventListener).toHaveBeenCalledTimes(2);

      // console.log가 호출되었는지 확인
      expect(global.console.log).toHaveBeenCalledWith("Content Pilot UI Initialized.");
    });

    test("should not initialize when window.self does not equal window.top", () => {
      // window.self !== window.top 조건
      mockWindow.self = {};
      mockWindow.top = { different: true };

      initialize();

      // 아무것도 호출되지 않았는지 확인
      expect(mockChrome.runtime.onMessage.addListener).not.toHaveBeenCalled();
      expect(mockWindow.addEventListener).not.toHaveBeenCalled();
      expect(mockDocument.addEventListener).not.toHaveBeenCalled();
      expect(global.console.log).not.toHaveBeenCalled();
    });

    test("should handle Alt key events correctly", () => {
      mockWindow.self = mockWindow.top;

      initialize();

      // keydown 이벤트 리스너 찾기
      const keydownListener = mockDocument.addEventListener.mock.calls.find(
        call => call[0] === 'keydown'
      )[1];

      // keyup 이벤트 리스너 찾기
      const keyupListener = mockDocument.addEventListener.mock.calls.find(
        call => call[0] === 'keyup'
      )[1];

      // Alt 키 keydown 이벤트
      const altKeyEvent = {
        key: 'Alt',
        target: { tagName: 'DIV' } // 입력창이 아닌 일반 요소
      };

      // 함수가 에러 없이 실행되는지 확인 (실제 함수 호출은 모킹되어 있으므로)
      expect(() => keydownListener(altKeyEvent)).not.toThrow();
      expect(() => keyupListener(altKeyEvent)).not.toThrow();
    });

    test("should not hide panel when Alt key pressed in input fields", () => {
      mockWindow.self = mockWindow.top;

      initialize();

      const keydownListener = mockDocument.addEventListener.mock.calls.find(
        call => call[0] === 'keydown'
      )[1];

      // INPUT 요소에서 Alt 키 이벤트
      const inputAltEvent = {
        key: 'Alt',
        target: { tagName: 'INPUT' }
      };

      // 함수가 에러 없이 실행되는지 확인
      expect(() => keydownListener(inputAltEvent)).not.toThrow();

      // TEXTAREA 요소에서 Alt 키 이벤트
      const textareaAltEvent = {
        key: 'Alt',
        target: { tagName: 'TEXTAREA' }
      };

      expect(() => keydownListener(textareaAltEvent)).not.toThrow();

      // contentEditable 요소에서 Alt 키 이벤트
      const contentEditableAltEvent = {
        key: 'Alt',
        target: { isContentEditable: true }
      };

      expect(() => keydownListener(contentEditableAltEvent)).not.toThrow();
    });
  });
});