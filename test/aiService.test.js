// test/aiService.test.js

// Firebase SDK 모킹 (Node.js 환경에서 fetch 오류 방지)
jest.mock("firebase/app", () => ({
  initializeApp: jest.fn(),
}));

jest.mock("firebase/auth", () => ({
  getAuth: jest.fn(() => ({})),
  GoogleAuthProvider: jest.fn(),
  signInWithCredential: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));

// fetch API 모킹 - 더 간단한 방식
const mockFetchResponse = {
  ok: true,
  status: 200,
  json: jest.fn(),
};

global.fetch = jest.fn(() => Promise.resolve(mockFetchResponse));

import {
  callGeminiAPI,
  generateDraftFromIdea,
  generateIdeaBriefing,
  generateAiImage,
  analyzeKeywordGap,
  getEmergingTopics,
} from "../js/services/aiService.js";

/**
 * AI 서비스 테스트
 * Gemini API 호출 및 응답 처리 기능 검증
 */
describe("AI Service", () => {
  beforeEach(() => {
    // Chrome storage 모킹 초기화
    global.chrome.storage.local.get.mockResolvedValue({
      geminiApiKey: "test-api-key",
    });
    global.chrome.storage.local.set.mockResolvedValue();

    // fetch API 초기화
    global.fetch.mockClear();

    // Firebase 서비스 모킹
    jest.doMock("../js/services/firebaseService.js", () => ({
      getDb: jest.fn(() => "mock-db"),
      ref: jest.fn(() => "mock-ref"),
      update: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
      getCurrentUserId: jest.fn(() => "test-user-id"),
      cleanDataForFirebase: jest.fn((data) => data),
    }));

    // Analytics 서비스 모킹
    jest.doMock("../js/services/analyticsService.js", () => ({
      analyzePerformanceData: jest.fn(() => ({
        analysis: "테스트 분석",
        decayContent: ["콘텐츠1", "콘텐츠2"],
      })),
      getUserFeedbackPatterns: jest.fn(() => ({
        positive: ["좋아요"],
        negative: ["싫어요"],
      })),
    }));

    // Offscreen 서비스 모킹
    jest.doMock("../js/services/offscreenService.js", () => ({
      sanitizeHtmlInOffscreen: jest.fn((html) => Promise.resolve(html)),
      cropImageInOffscreen: jest.fn(() => Promise.resolve("cropped-image")),
      composeThumbnailInOffscreen: jest.fn(() => Promise.resolve("thumbnail")),
    }));

    // Prompt 서비스 모킹
    jest.doMock("../js/services/promptService.js", () => ({
      PromptBuilder: jest.fn().mockImplementation(() => ({
        detectPersona: jest.fn(() => "blogger"),
        setTone: jest.fn().mockReturnThis(),
        addSkill: jest.fn().mockReturnThis(),
        setTrendContext: jest.fn().mockReturnThis(),
        buildSystemPrompt: jest.fn(() => "시스템 프롬프트"),
        build: jest.fn(() => "최종 프롬프트"),
      })),
      detectPersona: jest.fn(() => "blogger"),
      PROMPT_CONFIG: {
        personas: { blogger: {} },
        tones: { friendly: {} },
        skills: { writing: {} },
      },
    }));

    // 상수 모킹
    jest.doMock("../js/constants.js", () => ({
      AI_MODELS: {
        TEXT: "gemini-pro",
        VISION: "gemini-pro-vision",
      },
      COLLECTIONS: {
        KANBAN: "kanban",
        AFFILIATE_LINKS: "affiliate_links",
      },
    }));

    // Logger 모킹
    jest.doMock("../js/utils.js", () => ({
      Logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        biz: jest.fn(),
      },
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe("callGeminiAPI", () => {
    test("should successfully call Gemini API and return response", async () => {
      mockFetchResponse.json.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: "테스트 응답입니다." }],
            },
          },
        ],
      });

      const result = await callGeminiAPI("테스트 프롬프트");

      expect(result).toBe("테스트 응답입니다.");
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("generativelanguage.googleapis.com"),
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: expect.stringContaining("테스트 프롬프트"),
        })
      );
    });

    test("should throw error when API key is missing", async () => {
      global.chrome.storage.local.get.mockResolvedValueOnce({});

      await expect(callGeminiAPI("테스트 프롬프트")).rejects.toThrow(
        "Gemini API 키가 없습니다"
      );
    });

    test("should handle API error responses", async () => {
      mockFetchResponse.ok = false;
      mockFetchResponse.status = 400;
      mockFetchResponse.json.mockResolvedValue({
        error: { message: "Bad Request" },
      });

      await expect(callGeminiAPI("테스트 프롬프트")).rejects.toThrow(
        "Bad Request"
      );

      // 복원
      mockFetchResponse.ok = true;
      mockFetchResponse.status = 200;
    });

    test("should handle network errors", async () => {
      global.fetch.mockRejectedValueOnce(new Error("Network Error"));

      await expect(callGeminiAPI("테스트 프롬프트")).rejects.toThrow(
        "Network Error"
      );
    });

    test("should handle malformed API response", async () => {
      // 정상 응답이지만 내용이 malformed인 경우
      mockFetchResponse.json.mockResolvedValue({
        candidates: [],
      });

      const result = await callGeminiAPI("테스트 프롬프트");
      expect(result).toBe("");
    });
  });

  describe("generateDraftFromIdea", () => {
    test("should succeed with draft and fallback thumbnails when crops fail", async () => {
      jest.resetModules();

      // mocks for dependencies
      jest.doMock("../js/services/firebaseService.js", () => ({
        getDb: jest.fn(() => "mock-db"),
        ref: jest.fn(() => "mock-ref"),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => "test-user-id"),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) => Promise.resolve(`https://storage.test/${Date.now()}.png`)),
      }));

      jest.doMock("../js/services/offscreenService.js", () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) => Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)),
        cropImageInOffscreen: jest.fn(() => Promise.reject(new Error('crop timeout'))),
        composeThumbnailInOffscreen: jest.fn(() => Promise.resolve('data:image/png;base64,COMPOSED')),
      }));

      jest.doMock("../js/services/promptService.js", () => ({
        PromptBuilder: jest.fn().mockImplementation(() => ({
          setTone: jest.fn().mockReturnThis(),
          addSkill: jest.fn().mockReturnThis(),
          setTrendContext: jest.fn().mockReturnThis(),
          buildSystemPrompt: jest.fn(() => 'SYS'),
          getPersonaName: jest.fn(() => 'Blogger'),
          getToneName: jest.fn(() => 'friendly'),
        })),
        detectPersona: jest.fn(() => 'blogger'),
        PROMPT_CONFIG: { personas: { blogger: {} }, tones: {}, skills: {} },
      }));

      jest.doMock("../js/constants.js", () => ({ AI_MODELS: { TEXT: 't', IMAGE: 'img-model' } }));
      jest.doMock("../js/utils.js", () => ({ Logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), biz: jest.fn() } }));

      // set storage and fetch mock
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // Import the module fresh
      const svc = require("../js/services/aiService.js");

      // Save original fetch and install a temporary fetch mock used by callGeminiAPI and generateAiImage
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        // Text model -> return markdown draft
        if (String(url).includes('models/t')) {
          return Promise.resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '# 제목\n\n간단한 본문' }] } }] }) });
        }
        // Image model -> return inlineData with base64
        if (String(url).includes('models/img-model')) {
          return Promise.resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }] } }] }) });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: { message: 'Not mocked' } }) });
      });

      const idea = { title: 'Test', description: 'desc', tags: ['a'], currentDraft: '' };

      const res = await svc.generateDraftFromIdea(idea, { generateDraft: true, generateThumbnail: true });
      // restore original fetch so we don't break other tests
      global.fetch = originalFetch;
      // debug
      console.log('generateDraftFromIdea test response =>', res);

      expect(res.success).toBe(true);
      // draft content may vary depending on sanitization — main assertion here is that draft succeeded
      // Because crop failed, we should have partialFailure flag set
      expect(res.thumbnailPartialFailure).toBe(true);
      // thumbnailUrls should still exist (uploaded URLs)
      expect(res.thumbnailUrls).toBeTruthy();
      expect(res.thumbnailUrls.url_16x9 || res.thumbnailUrls.url_1x1).toBeTruthy();
    });

    test("should fallback to source image when compose fails and still upload thumbnails", async () => {
      jest.resetModules();

      // mocks for dependencies
      jest.doMock("../js/services/firebaseService.js", () => ({
        getDb: jest.fn(() => "mock-db"),
        ref: jest.fn(() => "mock-ref"),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => "test-user-id"),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) => Promise.resolve(`https://storage.test/${Date.now()}.png`)),
      }));

      jest.doMock("../js/services/offscreenService.js", () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) => Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)),
        // compose fails to force fallback
        composeThumbnailInOffscreen: jest.fn(() => Promise.reject(new Error('compose timeout'))),
        // cropping still works when given a dataURL fallback
        cropImageInOffscreen: jest.fn(() => Promise.resolve('cropped-image-from-source')),
      }));

      jest.doMock("../js/services/promptService.js", () => ({
        PromptBuilder: jest.fn().mockImplementation(() => ({
          setTone: jest.fn().mockReturnThis(),
          addSkill: jest.fn().mockReturnThis(),
          setTrendContext: jest.fn().mockReturnThis(),
          buildSystemPrompt: jest.fn(() => 'SYS'),
          getPersonaName: jest.fn(() => 'Blogger'),
          getToneName: jest.fn(() => 'friendly'),
        })),
        detectPersona: jest.fn(() => 'blogger'),
        PROMPT_CONFIG: { personas: { blogger: {} }, tones: {}, skills: {} },
      }));

      jest.doMock("../js/constants.js", () => ({ AI_MODELS: { TEXT: 't', IMAGE: 'img-model' } }));
      jest.doMock("../js/utils.js", () => ({ Logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), biz: jest.fn() } }));

      // set storage and fetch mock
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // Import the module fresh
      const svc = require("../js/services/aiService.js");

      // Save original fetch and install a temporary fetch mock used by callGeminiAPI, generateAiImage and fetchImageAsBase64
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        // Text model -> return markdown draft
        if (String(url).includes('models/t')) {
          return Promise.resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '# 제목\n\n간단한 본문' }] } }] }) });
        }
        // Image model -> return inlineData with base64
        if (String(url).includes('models/img-model')) {
          return Promise.resolve({ ok: true, json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }] } }] }) });
        }
        // Image URL download -> return a blob
        if (String(url).includes('images.test')) {
          const blob = new Blob([Buffer.from('fake')], { type: 'image/png' });
          return Promise.resolve({ ok: true, blob: async () => blob });
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: { message: 'Not mocked' } }) });
      });

      const idea = { title: 'Test', description: 'desc', tags: ['a'], currentDraft: '' };

      const res = await svc.generateDraftFromIdea(idea, { generateDraft: true, generateThumbnail: true });
      // restore original fetch so we don't break other tests
      global.fetch = originalFetch;

      expect(res.success).toBe(true);
      // compose failed but fallback used -> should still report partial failure
      expect(res.thumbnailPartialFailure).toBe(true);
      expect(res.thumbnailUrls).toBeTruthy();
    });
    test.skip("should generate draft with affiliate links", async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip("should handle missing idea data gracefully", async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip("should include performance data in prompt when available", async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });
  });

  describe("generateIdeaBriefing", () => {
    test.skip("should generate briefing for idea", async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip("should handle JSON parsing errors", async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });
  });

  describe("generateAiImage", () => {
    test.skip("should generate AI images successfully", async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip("should handle API errors gracefully", async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip("should default to count = 1 when not specified", async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });
  });

  describe("analyzeKeywordGap", () => {
    test("should analyze keyword gap between content", async () => {
      const myContent = [
        { tags: ["#tag1", "#tag2"] },
        { tags: ["#tag2", "#tag3"] },
      ];
      const competitorContent = [
        { tags: ["#tag1", "#tag4"] },
        { tags: ["#tag4", "#tag5"] },
      ];

      const result = await analyzeKeywordGap(myContent, competitorContent);

      expect(result).toHaveProperty("gapKeywords");
      expect(result).toHaveProperty("gapCount");
      expect(Array.isArray(result.gapKeywords)).toBe(true);
      expect(result.gapKeywords).toContain("tag4");
      expect(result.gapKeywords).toContain("tag5");
    });
  });

  describe("getEmergingTopics", () => {
    test("should get emerging topics from channel context", async () => {
      mockFetchResponse.json.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: "신흥 주제 분석 결과" }],
            },
          },
        ],
      });

      const result = await getEmergingTopics("테스트 채널 맥락");

      expect(typeof result).toBe("string");
      expect(result).toContain("신흥 주제 분석 결과");
    });

    test("should return null for empty channel context", async () => {
      const result = await getEmergingTopics(null);

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("should handle API errors", async () => {
      const channelContext = "test context";

      mockFetchResponse.ok = false;
      mockFetchResponse.status = 400;
      mockFetchResponse.json.mockResolvedValue({
        error: { message: "Bad Request" },
      });

      await expect(getEmergingTopics(channelContext)).rejects.toThrow(
        "Bad Request"
      );

      // 복원
      mockFetchResponse.ok = true;
      mockFetchResponse.status = 200;
    });
  });

  describe("postProcessAffiliateHtml", () => {
    test("wraps existing affiliate anchors and styles them", () => {
      const html =
        '<p>테스트 문장 <a href="https://shop.example/aff1">구매하기</a> 끝</p>';
      const links = [
        {
          url: "https://shop.example/aff1",
          productName: "상품A",
          keywords: ["상품A"],
        },
      ];

      const result =
        require("../js/services/aiService.js").postProcessAffiliateHtml(
          html,
          links,
          { maxLinks: 3 }
        );

      expect(result).toContain('style="color: #2e7d32;');
      expect(result).toContain('href="https://shop.example/aff1"');
    });

    test("inserts affiliate link when keyword is present and no anchor exists", () => {
      const html =
        "<p>이 글은 최신 상품A 리뷰입니다. 많은 정보를 담았습니다.</p>";
      const links = [
        {
          url: "https://shop.example/aff1",
          productName: "상품A",
          keywords: ["상품A"],
        },
      ];

      const result =
        require("../js/services/aiService.js").postProcessAffiliateHtml(
          html,
          links,
          { maxLinks: 2 }
        );

      // Should have inserted an anchor for 상품A
      expect(result).toMatch(/<a [^>]*href="https:\/\/shop.example\/aff1"/);
      // Should contain CTA text (상품명 기반)
      expect(result).toContain("상품A 최저가 확인하기");
    });

    test("does not insert more than maxLinks", () => {
      const html = "<p>상품A와 상품B, 상품C 및 상품D가 소개됩니다.</p>";
      const links = [
        { url: "https://s/affA", productName: "상품A", keywords: ["상품A"] },
        { url: "https://s/affB", productName: "상품B", keywords: ["상품B"] },
        { url: "https://s/affC", productName: "상품C", keywords: ["상품C"] },
        { url: "https://s/affD", productName: "상품D", keywords: ["상품D"] },
      ];

      const result =
        require("../js/services/aiService.js").postProcessAffiliateHtml(
          html,
          links,
          { maxLinks: 3 }
        );

      // should include exactly 3 affiliate anchors
      const matches = result.match(/<a [^>]*href="https?:\/\/[^"]+"/g) || [];
      // allow other anchors, but ensure affiliate insertions <= 3 by counting our link urls
      const affCount = (result.match(/상품[A-D] 최저가 확인하기/g) || [])
        .length;
      expect(affCount).toBeLessThanOrEqual(3);
    });
  });
});
