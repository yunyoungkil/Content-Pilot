// test/utils.test.js

import { shortenLink, showToast, showConfirmationToast } from "../js/utils.js";

/**
 * 유틸리티 함수들 테스트
 */
describe("Utility Functions", () => {
  describe("shortenLink", () => {
    test("should return original URL if shorter than maxLength", () => {
      const url = "https://example.com";
      expect(shortenLink(url, 40)).toBe(url);
    });

    test("should shorten long URLs", () => {
      const longUrl = "https://www.example.com/very/long/path/that/exceeds/max/length/limit";
      const shortened = shortenLink(longUrl, 40);
      expect(shortened.length).toBeLessThanOrEqual(40);
      expect(shortened).toContain("...");
      expect(shortened).toContain("example.com");
    });

    test("should handle URLs without protocol", () => {
      const url = "example.com/very/long/path";
      const shortened = shortenLink(url, 25);
      expect(shortened).toContain("...");
    });

    test("should return empty string for null/undefined", () => {
      expect(shortenLink(null)).toBe("");
      expect(shortenLink(undefined)).toBe("");
    });
  });

  describe("showToast", () => {
    beforeEach(() => {
      // jsdom의 document 메서드들을 spy로 모킹
      jest.spyOn(document, 'createElement').mockReturnValue({
        id: "",
        textContent: "",
        style: {},
        appendChild: jest.fn(),
        remove: jest.fn()
      });
      jest.spyOn(document, 'getElementById').mockReturnValue(null);
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});

      jest.useFakeTimers();
    });

    afterEach(() => {
      // spy 복원
      jest.restoreAllMocks();
      jest.useRealTimers();
      jest.clearAllTimers();
    });

    test("should create and show toast", () => {
      showToast("Test message");

      expect(document.createElement).toHaveBeenCalledWith("div");
      expect(document.body.appendChild).toHaveBeenCalled();

      // 타이머 진행
      jest.advanceTimersByTime(10);
      jest.advanceTimersByTime(1200);
      jest.advanceTimersByTime(350);
    });

    test("should remove existing toast before creating new one", () => {
      const existingToast = { remove: jest.fn() };
      document.getElementById.mockReturnValue(existingToast);

      showToast("New message");

      expect(existingToast.remove).toHaveBeenCalled();
    });
  });

  describe("showConfirmationToast", () => {
    beforeEach(() => {
      // jsdom의 document 메서드들을 spy로 모킹
      const mockElement = {
        id: "",
        textContent: "",
        style: {},
        innerHTML: "",
        appendChild: jest.fn(),
        remove: jest.fn(),
        addEventListener: jest.fn(),
        querySelector: jest.fn((selector) => {
          if (selector === '#cp-confirm-yes') {
            return { onclick: null };
          }
          if (selector === '#cp-confirm-no') {
            return { onclick: null };
          }
          return null;
        })
      };
      
      jest.spyOn(document, 'createElement').mockReturnValue(mockElement);
      jest.spyOn(document, 'getElementById').mockReturnValue(null);
      jest.spyOn(document.body, 'appendChild').mockImplementation(() => {});

      jest.useFakeTimers();
    });

    afterEach(() => {
      // spy 복원
      jest.restoreAllMocks();
      jest.useRealTimers();
      jest.clearAllTimers();
    });

    test("should create confirmation toast with confirm and cancel buttons", () => {
      const mockConfirm = jest.fn();
      showConfirmationToast("Test confirmation", mockConfirm);

      expect(document.createElement).toHaveBeenCalledWith("div");
      expect(document.body.appendChild).toHaveBeenCalled();
    });

    test("should create simple notification toast without confirm button", () => {
      showConfirmationToast("Simple message");

      expect(document.createElement).toHaveBeenCalledWith("div");
      expect(document.body.appendChild).toHaveBeenCalled();
    });

    test("should call onConfirm when confirm button is clicked", () => {
      const mockConfirm = jest.fn();
      const mockConfirmBtn = { onclick: null };
      
      const mockElement = {
        id: "",
        textContent: "",
        style: {},
        innerHTML: "",
        appendChild: jest.fn(),
        remove: jest.fn(),
        addEventListener: jest.fn(),
        querySelector: jest.fn((selector) => {
          if (selector === '#cp-confirm-yes') {
            return mockConfirmBtn;
          }
          if (selector === '#cp-confirm-no') {
            return { onclick: null };
          }
          return null;
        })
      };
      
      document.createElement.mockReturnValue(mockElement);

      showConfirmationToast("Confirm this", mockConfirm);

      // confirm 버튼의 onclick이 설정되었는지 확인
      expect(mockConfirmBtn.onclick).toBeDefined();
      
      // onclick 실행
      mockConfirmBtn.onclick();
      expect(mockConfirm).toHaveBeenCalled();
    });

    test("should remove existing toast when creating new one", () => {
      const existingToast = { remove: jest.fn() };
      document.getElementById.mockReturnValue(existingToast);

      showConfirmationToast("New toast");

      expect(existingToast.remove).toHaveBeenCalled();
    });

    test("should animate toast appearance and disappearance", () => {
      const mockElement = {
        id: "",
        textContent: "",
        style: {
          cssText: "",
          transform: "",
          opacity: ""
        },
        innerHTML: "",
        appendChild: jest.fn(),
        remove: jest.fn(),
        addEventListener: jest.fn(),
        querySelector: jest.fn((selector) => {
          if (selector === '#cp-confirm-yes') {
            return { onclick: null };
          }
          if (selector === '#cp-confirm-no') {
            return { onclick: null };
          }
          return null;
        })
      };
      
      // cssText setter 모킹
      Object.defineProperty(mockElement.style, 'cssText', {
        set: function(value) {
          this._cssText = value;
          // cssText에서 개별 속성 추출
          const transformMatch = value.match(/transform:\s*([^;]+)/);
          if (transformMatch) this.transform = transformMatch[1];
          const opacityMatch = value.match(/opacity:\s*([^;]+)/);
          if (opacityMatch) this.opacity = opacityMatch[1];
        },
        get: function() {
          return this._cssText || "";
        }
      });
      
      document.createElement.mockReturnValue(mockElement);

      showConfirmationToast("Animated toast");

      // 초기 상태 확인 (아래에서 시작)
      expect(mockElement.style.cssText).toContain("translateY(100px)");
      expect(mockElement.style.opacity).toBe("0");

      // 애니메이션 진행
      jest.advanceTimersByTime(100);
      expect(mockElement.style.transform).toContain("translateY(0)");
      expect(mockElement.style.opacity).toBe("1");
    });
  });
});