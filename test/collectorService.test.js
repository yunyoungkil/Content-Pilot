// test/collectorService.test.js

import { normalizeUrlForComparison, encodeUrlForFirebaseKey } from "../js/services/collectorService.js";
import * as authService from "../js/services/authService.js";
import { fetchAllChannelData } from "../js/services/collectorService.js";

/**
 * Collector Service 유틸리티 함수들 테스트
 */
describe("Collector Service Utilities", () => {
  describe("normalizeUrlForComparison", () => {
    test("should normalize URLs by removing trailing slashes", () => {
      expect(normalizeUrlForComparison("https://example.com/path/")).toBe("example.com/path");
      expect(normalizeUrlForComparison("https://example.com/path")).toBe("example.com/path");
    });

    test("should extract hostname and pathname", () => {
      expect(normalizeUrlForComparison("https://example.com/path/to/page")).toBe("example.com/path/to/page");
      expect(normalizeUrlForComparison("http://sub.example.com/path")).toBe("sub.example.com/path");
    });

    test("should handle URLs with query parameters", () => {
      expect(normalizeUrlForComparison("https://example.com/path?query=value")).toBe("example.com/path");
    });

    test("should handle URLs with fragments", () => {
      expect(normalizeUrlForComparison("https://example.com/path#fragment")).toBe("example.com/path");
    });

    test("should handle invalid URLs gracefully", () => {
      expect(normalizeUrlForComparison("not-a-url")).toBe("not-a-url");
      expect(normalizeUrlForComparison("")).toBe("");
      expect(normalizeUrlForComparison(null)).toBe("");
      expect(normalizeUrlForComparison(undefined)).toBe("");
    });

    test("should trim whitespace", () => {
      expect(normalizeUrlForComparison("  https://example.com/path  ")).toBe("example.com/path");
    });
  });

  describe("encodeUrlForFirebaseKey", () => {
    test("should encode dots to _DOT_", () => {
      expect(encodeUrlForFirebaseKey("example.com")).toBe("example_DOT_com");
    });

    test("should encode slashes to _SLASH_", () => {
      expect(encodeUrlForFirebaseKey("path/to/file")).toBe("path_SLASH_to_SLASH_file");
    });

    test("should encode hashes to _HASH_", () => {
      expect(encodeUrlForFirebaseKey("url#fragment")).toBe("url_HASH_fragment");
    });

    test("should encode dollar signs to _DOLLAR_", () => {
      expect(encodeUrlForFirebaseKey("path$with$dollar")).toBe("path_DOLLAR_with_DOLLAR_dollar");
    });

    test("should encode square brackets", () => {
      expect(encodeUrlForFirebaseKey("array[0][1]")).toBe("array_LBRACKET_0_RBRACKET__LBRACKET_1_RBRACKET_");
    });

    test("should handle complex URLs", () => {
      const complexUrl = "https://sub.example.com/path/to/file.html?query=value#fragment";
      const expected = "https:_SLASH__SLASH_sub_DOT_example_DOT_com_SLASH_path_SLASH_to_SLASH_file_DOT_html?query=value_HASH_fragment";
      expect(encodeUrlForFirebaseKey(complexUrl)).toBe(expected);
    });

    test("should handle empty strings", () => {
      expect(encodeUrlForFirebaseKey("")).toBe("");
    });
  });

  describe("fetchAllChannelData - auth check", () => {
    test("should return early when getValidToken returns null", async () => {
      jest.spyOn(authService, 'getValidToken').mockResolvedValue(null);
      const result = await fetchAllChannelData();
      expect(result).toBeUndefined();
      authService.getValidToken.mockRestore();
    });
  });
});