// test/utils.test.js

import { shortenLink, showToast } from "../js/utils.js";

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
});