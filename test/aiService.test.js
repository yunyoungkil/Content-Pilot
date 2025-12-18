// test/aiService.test.js

// Firebase SDK 모킹 (Node.js 환경에서 fetch 오류 방지)
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(),
}));

jest.mock('firebase/auth', () => ({
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
} from '../js/services/aiService.js';

/**
 * AI 서비스 테스트
 * Gemini API 호출 및 응답 처리 기능 검증
 */
describe('AI Service', () => {
  // some AI tests can involve slightly longer async operations (image processing, cropping, etc.)
  jest.setTimeout(20000);
  beforeEach(() => {
    // Chrome storage 모킹 초기화
    global.chrome.storage.local.get.mockResolvedValue({
      geminiApiKey: 'test-api-key',
    });
    global.chrome.storage.local.set.mockResolvedValue();

    // fetch API 초기화
    global.fetch.mockClear();

    // Ensure runtime message sendMessage won't hang in tests
    if (!global.chrome.runtime.sendMessage) {
      global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
        // Default: handle fetch_image_as_base64 action with a synthetic base64 payload
        if (msg && msg.action === 'fetch_image_as_base64') {
          if (typeof cb === 'function')
            cb({ success: true, data: 'R0FDRkE=', mimeType: 'image/png' });
          return;
        }
        if (typeof cb === 'function') cb({ success: false });
      });
    }

    // Firebase 서비스 모킹
    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb: jest.fn(() => 'mock-db'),
      ref: jest.fn(() => 'mock-ref'),
      update: jest.fn(() => Promise.resolve()),
      get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
      getCurrentUserId: jest.fn(() => 'test-user-id'),
      cleanDataForFirebase: jest.fn((data) => data),
    }));

    // Analytics 서비스 모킹
    jest.doMock('../js/services/analyticsService.js', () => ({
      analyzePerformanceData: jest.fn(() => ({
        analysis: '테스트 분석',
        decayContent: ['콘텐츠1', '콘텐츠2'],
      })),
      getUserFeedbackPatterns: jest.fn(() => ({
        positive: ['좋아요'],
        negative: ['싫어요'],
      })),
    }));

    // Offscreen 서비스 모킹
    jest.doMock('../js/services/offscreenService.js', () => ({
      sanitizeHtmlInOffscreen: jest.fn((html) => Promise.resolve(html)),
      cropImageInOffscreen: jest.fn(() => Promise.resolve('cropped-image')),
      composeThumbnailInOffscreen: jest.fn(() => Promise.resolve('thumbnail')),
    }));

    // Prompt 서비스 모킹
    jest.doMock('../js/services/promptService.js', () => ({
      PromptBuilder: jest.fn().mockImplementation(() => ({
        detectPersona: jest.fn(() => 'blogger'),
        setTone: jest.fn().mockReturnThis(),
        addSkill: jest.fn().mockReturnThis(),
        setTrendContext: jest.fn().mockReturnThis(),
        buildSystemPrompt: jest.fn(() => '시스템 프롬프트'),
        build: jest.fn(() => '최종 프롬프트'),
      })),
      detectPersona: jest.fn(() => 'blogger'),
      PROMPT_CONFIG: {
        personas: { blogger: {} },
        tones: { friendly: {} },
        skills: { writing: {} },
      },
    }));

    // 상수 모킹
    jest.doMock('../js/constants.js', () => ({
      AI_MODELS: {
        TEXT: 'gemini-pro',
        VISION: 'gemini-pro-vision',
      },
      COLLECTIONS: {
        KANBAN: 'kanban',
        AFFILIATE_LINKS: 'affiliate_links',
      },
    }));

    // Logger and helper functions 모킹
    jest.doMock('../js/utils.js', () => ({
      Logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn(),
        biz: jest.fn(),
      },
      normalizeSeoTitle: jest.fn((seoTitle, title) => seoTitle),
      // include other helpers if needed
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('callGeminiAPI', () => {
    test('should successfully call Gemini API and return response', async () => {
      mockFetchResponse.json.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: '테스트 응답입니다.' }],
            },
          },
        ],
      });

      const result = await callGeminiAPI('테스트 프롬프트');

      expect(result).toBe('테스트 응답입니다.');
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('generativelanguage.googleapis.com'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.stringContaining('"contents"'),
        })
      );
      // confirm API key appended to URL
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('key=test-api-key'),
        expect.any(Object)
      );

      // confirm payload has nested text field
      expect(global.fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('"text":"테스트 프롬프트"'),
        })
      );
    });

    test('should throw error when API key is missing', async () => {
      global.chrome.storage.local.get.mockResolvedValueOnce({});

      await expect(callGeminiAPI('테스트 프롬프트')).rejects.toThrow('Gemini API 키가 없습니다');
    });

    test('should handle API error responses', async () => {
      mockFetchResponse.ok = false;
      mockFetchResponse.status = 400;
      mockFetchResponse.json.mockResolvedValue({
        error: { message: 'Bad Request' },
      });

      await expect(callGeminiAPI('테스트 프롬프트')).rejects.toThrow('Bad Request');

      // 복원
      mockFetchResponse.ok = true;
      mockFetchResponse.status = 200;
    });

    test('should handle network errors', async () => {
      global.fetch.mockRejectedValueOnce(new Error('Network Error'));

      await expect(callGeminiAPI('테스트 프롬프트')).rejects.toThrow('Network Error');
    });

    test('should handle malformed API response', async () => {
      // 정상 응답이지만 내용이 malformed인 경우
      mockFetchResponse.json.mockResolvedValue({
        candidates: [],
      });

      const result = await callGeminiAPI('테스트 프롬프트');
      expect(result).toBe('');
    });

    test.skip('should try fallback models when model resource not found', async () => {
      // storage returns API key
      global.chrome.storage.local.get.mockResolvedValueOnce({ geminiApiKey: 'test' });

      // simulate first model not found (404) then fallback success
      const first = {
        ok: false,
        status: 404,
        json: async () => ({ error: { message: 'Requested entity was not found.' } }),
      };
      const second = {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'fallback response' }] } }],
        }),
      };

      global.fetch = jest.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);

      const result = await callGeminiAPI('some prompt', 'gemini-2.0-flash');

      expect(result).toBe('fallback response');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // first model should have failed and we succeed on fallback (2 calls)
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('getRelevantAffiliateLinks', () => {
    test('should prefer preferredAffiliateId and sort results by score', async () => {
      // isolate modules to ensure firebaseService mock is attached before requiring aiService
      jest.isolateModules(async () => {
        jest.resetModules();
        // mock firebaseService specifically for this test
        jest.doMock('../js/services/firebaseService.js', () => ({
          getDb: jest.fn(() => 'mock-db'),
          ref: jest.fn(() => 'mock-ref'),
          update: jest.fn(() => Promise.resolve()),
          get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
          getCurrentUserId: jest.fn(() => 'test-user-id'),
          cleanDataForFirebase: jest.fn((data) => data),
        }));

        const firebaseService = require('../js/services/firebaseService.js');
        const linksMap = {
          link_1: {
            id: 'link_1',
            keywords: ['vacuum', 'clean'],
            productName: 'Dyson V15',
            url: 'https://partner.example/link_1',
            createdAt: 1,
            cardData: { imageUrl: 'https://images.example/a.jpg' },
          },
          link_2: {
            id: 'link_2',
            keywords: ['vacuum'],
            productName: 'Generic Vacuum',
            url: 'https://partner.example/link_2',
            createdAt: 2,
            cardData: { imageUrl: 'https://images.example/b.jpg' },
          },
        };

        firebaseService.get.mockResolvedValueOnce({ val: () => linksMap });

        const { getRelevantAffiliateLinks } = require('../js/services/aiService.js');
        const result = await getRelevantAffiliateLinks('test-user-id', 'Dyson V15 vacuum review', {
          preferredAffiliateId: 'link_2',
        });
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        expect(result[0].id).toBe('link_2');
      });
    });
  });

  describe('callDraftAPI', () => {
    test('retries until a successful non-empty response', async () => {
      jest.resetModules();
      // rely on network/fetch behavior which callGeminiAPI uses internally
      const svc = require('../js/services/aiService.js');

      // Ensure storage returns API key
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // First attempt -> network error, second attempt -> successful response
      const originalFetch = global.fetch;
      global.fetch = jest
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ text: 'OK' }] } }] }),
        });

      const res = await svc.callDraftAPI('prompt', {
        maxRetries: 3,
        initialBackoffMs: 1,
        backoffMultiplier: 1,
      });
      expect(res).toBe('OK');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      global.fetch = originalFetch;
    });

    test('returns empty string when model returns empty responses', async () => {
      jest.resetModules();
      const svc = require('../js/services/aiService.js');
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      const originalFetch = global.fetch;
      global.fetch = jest
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) })
        .mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) });

      const res = await svc.callDraftAPI('prompt', {
        maxRetries: 2,
        initialBackoffMs: 1,
        backoffMultiplier: 1,
      });
      expect(res).toBe('');
      expect(global.fetch).toHaveBeenCalledTimes(2);
      global.fetch = originalFetch;
    });

    test('throws when final attempt errors', async () => {
      jest.resetModules();
      const svc = require('../js/services/aiService.js');
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });
      const originalFetch = global.fetch;
      global.fetch = jest.fn().mockRejectedValue(new Error('boom'));

      await expect(
        svc.callDraftAPI('prompt', { maxRetries: 1, initialBackoffMs: 1 })
      ).rejects.toThrow('boom');
      expect(global.fetch).toHaveBeenCalledTimes(1);
      global.fetch = originalFetch;
    });
  });

  describe('processDraftResponse', () => {
    test('cleans fences and extracts JSON-LD and thumbnail info', () => {
      const svc = require('../js/services/aiService.js');
      const raw =
        '```markdown\n# Title\n```\n<JSON-LD>{"headline":"H","datePublished":"2020-01-01"}</JSON-LD>\nContent here\n<썸네일정보>[{"type":"curiosity","thumbnailText":"txt"}]</썸네일정보>';
      const { cleanedDraft, jsonLdSchema, thumbnailCandidates } = svc.processDraftResponse(raw, {
        title: 'T',
      });

      expect(cleanedDraft).not.toContain('<JSON-LD>');
      expect(cleanedDraft).not.toContain('<썸네일정보>');
      expect(jsonLdSchema).toBeTruthy();
      expect(jsonLdSchema.headline).toBe('H');
      expect(Array.isArray(thumbnailCandidates)).toBe(true);
      expect(thumbnailCandidates[0].type).toBe('curiosity');
      });

      test('filters out example-only link outputs and falls back to placeholder', () => {
        const svc = require('../js/services/aiService.js');
        const rawExample = "[완벽 가이드] 쿠진아트 에어프라이어 그릴 오븐 청소 꿀팁 총정리!](https://costcatcher.k-posting.info/entry/abcdefg)";
        const { cleanedDraft } = svc.processDraftResponse(rawExample, { title: '샘플 제목' });

        // If the model returned only an example link line, we should not keep the raw link.
        expect(cleanedDraft).not.toContain('https://');
        // Should fallback to a helpful placeholder message
        expect(cleanedDraft).toMatch(/내용을 생성하는 중 오류/);
        // Should include the idea's title in the fallback
        expect(cleanedDraft).toContain('샘플 제목');
    });
  });

  describe('generateDraftFromIdea', () => {
    test('should succeed with draft and fallback thumbnails when crops fail', async () => {
      jest.resetModules();

      // mocks for dependencies
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) =>
          Promise.resolve(`https://storage.test/${Date.now()}.png`)
        ),
      }));

      jest.doMock('../js/services/offscreenService.js', () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) =>
          Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)
        ),
        cropImageInOffscreen: jest.fn(() => Promise.reject(new Error('crop timeout'))),
        composeThumbnailInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,COMPOSED')
        ),
      }));

      jest.doMock('../js/services/promptService.js', () => ({
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

      jest.doMock('../js/constants.js', () => ({
        AI_MODELS: { TEXT: 't', IMAGE: 'gemini-2.0-flash-exp' },
      }));
      jest.doMock('../js/utils.js', () => ({
        Logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          biz: jest.fn(),
        },
      }));

      // set storage and fetch mock
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // Import the module fresh
      const svc = require('../js/services/aiService.js');
      // Mock generateAiImage to control sourceImageUrl and avoid external Gemini calls
      jest.spyOn(svc, 'generateAiImage').mockResolvedValue(['https://images.test/generated.png']);
      // Mock generateAiImage directly to avoid slow external Gemini calls and speed up test
      if (!svc.generateAiImage) {
        throw new Error('generateAiImage not found on service');
      }
      jest.spyOn(svc, 'generateAiImage').mockResolvedValue(['https://images.test/generated.png']);

      // Save original fetch and install a temporary fetch mock used by callGeminiAPI and generateAiImage
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        // Text model -> return markdown draft
        if (String(url).includes('models/t')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: '# 제목\n\n간단한 본문' }] } }],
            }),
          });
        }
        // Image model -> return Gemini API response with inlineData
        if (String(url).includes('gemini-2.0-flash-exp:generateContent')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }],
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not mocked' } }),
        });
      });

      const idea = { title: 'Test', description: 'desc', tags: ['a'], currentDraft: '' };

      // Call the enhancement function directly to isolate thumbnail compose fallback behavior.
      const res = await svc.enhanceDraftWithFeatures({
        thumbnailCandidates: [
          {
            type: 'curiosity',
            thumbnailPromptEn: 'Test prompt',
            thumbnailText: 'Test',
            altText: 'Alt Text',
          },
        ],
        affiliateLinks: [],
        permalink: 'test-permalink',
        composeThumbnailText: true,
        seoTitle: 'Test SEO',
        ideaData: idea,
        formattedDraft: '<h1>Header</h1><p>Body</p>',
        jsonLdSchema: null,
      });
      // restore original fetch so we don't break other tests
      global.fetch = originalFetch;
      // debug
      // (removed noisy debug output)
      // draft content may vary depending on sanitization — main assertion here is that draft succeeded
      // Because crop failed, we should have partialFailure flag set
      expect(res.thumbnailGenerationPartialFailure).toBe(true);
      // thumbnailUrls should still exist (uploaded URLs)
      expect(res.thumbnailUrls).toBeTruthy();
      expect(res.thumbnailUrls.url_16x9 || res.thumbnailUrls.url_1x1).toBeTruthy();
    });

    test('curiosity template no longer contains question mark', async () => {
      const cfg = require('../js/services/aiServiceConfig.js').THUMBNAIL_CONFIG;
      expect(cfg.DEFAULT_CANDIDATES[0].thumbnailPromptEn).not.toMatch(/question mark/);
      expect(cfg.DEFAULT_CANDIDATES[0].thumbnailText).toBe('');
    });

    test('sanitizes punctuation-only thumbnailText into a fallback', async () => {
      const svc = require('../js/services/aiService.js');
      const sanitize = svc.sanitizeThumbnailText;
      const fallback = 'My Test';
      const result = sanitize('???', fallback);
      expect(result).toBeTruthy();
      expect(result).not.toMatch(/^[^\p{L}\p{N}]+$/u);
      expect(/[\p{L}\p{N}]/u.test(result)).toBe(true);
    });

    test('calls generateThumbnailTexts when generating thumbnails', async () => {
      const thumbnailSvc = require('../js/services/thumbnailService.js');
      jest.spyOn(thumbnailSvc, 'generateThumbnailTexts').mockResolvedValue({ success: true, slogans: ['슬로건D'] });
      const svc = require('../js/services/aiService.js');
      const idea = { title: 'Test', description: 'desc', tags: ['a'], currentDraft: '' };
      // Call generateDraftFromIdea with generateThumbnail true (and skip full draft generation)
      await svc.generateDraftFromIdea(idea, { generateDraft: false, generateThumbnail: true, composeThumbnailText: true });
      expect(thumbnailSvc.generateThumbnailTexts).toHaveBeenCalled();
    });

    test('should fallback to source image when compose fails and still upload thumbnails', async () => {
      jest.resetModules();

      // mocks for dependencies
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) =>
          Promise.resolve(`https://storage.test/${Date.now()}.png`)
        ),
      }));

      jest.doMock('../js/services/offscreenService.js', () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) =>
          Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)
        ),
        // compose fails to force fallback
        composeThumbnailInOffscreen: jest.fn(() => Promise.reject(new Error('compose timeout'))),
        // cropping still works when given a dataURL fallback
        cropImageInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,cropped-image-data')
        ),
      }));

      jest.doMock('../js/services/promptService.js', () => ({
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

      jest.doMock('../js/constants.js', () => ({
        AI_MODELS: { TEXT: 't', IMAGE: 'gemini-2.0-flash-exp' },
      }));
      jest.doMock('../js/utils.js', () => ({
        Logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          biz: jest.fn(),
        },
      }));

      // set storage and fetch mock
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // Import the module fresh
      const svc = require('../js/services/aiService.js');

      // Save original fetch and install a temporary fetch mock used by callGeminiAPI, generateAiImage and fetchImageAsBase64
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        // Text model -> return markdown draft
        if (String(url).includes('models/t')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: '# 제목\n\n간단한 본문' }] } }],
            }),
          });
        }
        // Image model -> return Gemini API response with inlineData
        if (String(url).includes('gemini-2.0-flash-exp:generateContent')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }],
                  },
                },
              ],
            }),
          });
        }
        // Image URL download -> return a blob
        if (String(url).includes('storage.test') || String(url).includes('images.test')) {
          const blob = new Blob([Buffer.from('fake')], { type: 'image/png' });
          return Promise.resolve({ ok: true, blob: async () => blob });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not mocked' } }),
        });
      });

      const idea = { title: 'Test', description: 'desc', tags: ['a'], currentDraft: '' };

      // Directly call the enhancement flow to focus on compose fallback behavior
      const res = await svc.enhanceDraftWithFeatures({
        thumbnailCandidates: [
          {
            type: 'curiosity',
            thumbnailPromptEn: 'Test prompt',
            thumbnailText: 'Test',
            altText: 'Alt Text',
          },
        ],
        affiliateLinks: [],
        permalink: 'test-permalink',
        composeThumbnailText: true,
        seoTitle: 'Test SEO',
        ideaData: idea,
        formattedDraft: '<h1>Header</h1><p>Body</p>',
        jsonLdSchema: null,
      });
      // restore original fetch so we don't break other tests
      global.fetch = originalFetch;

      // service returns partial flags & thumbnailUrls; ensure we have them
      expect(res).toBeTruthy();
      // compose failed but fallback used -> should still report partial failure
      expect(res.thumbnailGenerationPartialFailure).toBe(true);
      expect(res.thumbnailUrls).toBeTruthy();
    });

    test('should call onProgress during draft and thumbnail generation', async () => {
      jest.resetModules();

      // mock minimal dependencies similar to previous tests
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) =>
          Promise.resolve(`https://storage.test/${Date.now()}.png`)
        ),
      }));

      jest.doMock('../js/services/offscreenService.js', () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) =>
          Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)
        ),
        cropImageInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,cropped-image-data')
        ),
        composeThumbnailInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,COMPOSED')
        ),
      }));

      jest.doMock('../js/services/promptService.js', () => ({
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

      jest.doMock('../js/constants.js', () => ({
        AI_MODELS: { TEXT: 't', IMAGE: 'gemini-2.0-flash-exp' },
      }));
      jest.doMock('../js/utils.js', () => ({
        Logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          biz: jest.fn(),
        },
      }));

      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // fetch mock for text + image models
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        if (String(url).includes('models/t')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: '# Title\n\nBody' }] } }],
            }),
          });
        }
        if (String(url).includes('gemini-2.0-flash-exp:generateContent')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }],
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not mocked' } }),
        });
      });

      const svc = require('../js/services/aiService.js');
      const progressCb = jest.fn();
      const idea = { title: 'Progress Test', description: 'desc', tags: ['a'] };
      await svc.generateDraftFromIdea(idea, {
        generateDraft: true,
        generateThumbnail: true,
        composeThumbnailText: true,
        onProgress: progressCb,
      });
      global.fetch = originalFetch;

      expect(progressCb).toHaveBeenCalled();
      // ensure we got at least progress for draft and thumbnail generation
      const steps = progressCb.mock.calls.map((c) => c[0].step);
      expect(steps.includes('draft_generation') || steps.includes('thumbnail_generation')).toBe(
        true
      );
    });

    test('should fallback when compose operation times out', async () => {
      jest.resetModules();

      // minimal mocks
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) =>
          Promise.resolve(`https://storage.test/${Date.now()}.png`)
        ),
      }));

      jest.doMock('../js/services/offscreenService.js', () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) =>
          Promise.resolve(`<h1>Auto Title</h1><p>${html}</p>`)
        ),
        // compose never resolves -> simulate hang
        composeThumbnailInOffscreen: jest.fn(() => new Promise(() => {})),
        cropImageInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,cropped-image-data')
        ),
      }));

      jest.doMock('../js/services/promptService.js', () => ({
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

      jest.doMock('../js/constants.js', () => ({
        AI_MODELS: { TEXT: 't', IMAGE: 'gemini-2.0-flash-exp' },
      }));
      jest.doMock('../js/utils.js', () => ({
        Logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          biz: jest.fn(),
        },
      }));

      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // fetch mock for text + image models
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        if (String(url).includes('models/t')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [{ content: { parts: [{ text: '# Title\n\nBody' }] } }],
            }),
          });
        }
        if (String(url).includes('gemini-2.0-flash-exp:generateContent')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              candidates: [
                {
                  content: {
                    parts: [{ inlineData: { data: 'RkxBRElCQVNFMQ==', mimeType: 'image/png' } }],
                  },
                },
              ],
            }),
          });
        }
        return Promise.resolve({
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not mocked' } }),
        });
      });

      const svc = require('../js/services/aiService.js');
      const idea = { title: 'Timeout Test', description: 'desc', tags: ['a'] };
      const res = await svc.enhanceDraftWithFeatures({
        thumbnailCandidates: [
          {
            type: 'curiosity',
            thumbnailPromptEn: 'Test prompt',
            thumbnailText: 'Test',
            altText: 'Alt Text',
          },
        ],
        affiliateLinks: [],
        permalink: 'test-permalink',
        composeThumbnailText: true,
        seoTitle: 'Test SEO',
        ideaData: idea,
        formattedDraft: '<h1>Header</h1><p>Body</p>',
        jsonLdSchema: null,
      });
      global.fetch = originalFetch;

      expect(res).toBeTruthy();
      expect(res.thumbnailGenerationPartialFailure).toBe(true);
      expect(res.thumbnailUrls).toBeTruthy();
    });

    test('should create default JSON-LD and metaDescription when model returns none, and add altText for existing thumbnails', async () => {
      jest.resetModules();

      // mocks for firebase and offscreen
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn(() => Promise.resolve()),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((data) => data),
        uploadImageToFirebaseStorage: jest.fn((dataUrl) =>
          Promise.resolve(`https://storage.test/${Date.now()}.png`)
        ),
      }));

      jest.doMock('../js/services/offscreenService.js', () => ({
        sanitizeHtmlInOffscreen: jest.fn((html) =>
          Promise.resolve(
            `<h1>Generated Title</h1><p>This is the summary paragraph for the article that should become meta description.</p><p>More content here.</p>`
          )
        ),
        cropImageInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,cropped-image-data')
        ),
        composeThumbnailInOffscreen: jest.fn(() =>
          Promise.resolve('data:image/png;base64,COMPOSED')
        ),
      }));

      jest.doMock('../js/services/promptService.js', () => ({
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

      jest.doMock('../js/constants.js', () => ({
        AI_MODELS: { TEXT: 't', IMAGE: 'gemini-2.0-flash-exp' },
      }));
      jest.doMock('../js/utils.js', () => ({
        Logger: {
          debug: jest.fn(),
          info: jest.fn(),
          warn: jest.fn(),
          error: jest.fn(),
          biz: jest.fn(),
        },
      }));

      // ensure storage has API key
      global.chrome.storage.local.get.mockResolvedValue({ geminiApiKey: 'test' });

      // return a draft WITHOUT a <JSON-LD> section
      const originalFetch = global.fetch;
      global.fetch = jest.fn((url, opts) => {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: '# Generated Title\n\nThis is the summary paragraph for the article that should become meta description.\n\n## Subtitle\n\nBody content.',
                    },
                  ],
                },
              },
            ],
          }),
        });
      });

      const svc = require('../js/services/aiService.js');

      // Provide a publishInfo thumbnailUrls without altText to verify altText is inserted
      const idea = {
        title: 'SEO Test',
        description: '',
        tags: [],
        publishInfo: { thumbnailUrls: { url_16x9: 'https://images.test/16x9.png' } },
      };

      const res = await svc.generateDraftFromIdea(idea, {
        generateDraft: true,
        generateThumbnail: false,
      });
      global.fetch = originalFetch;

      console.log('[TEST DEBUG] generateDraftFromIdea res:', res);

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      // jsonLdSchema should be created even though the model didn't provide it
      expect(res.jsonLdSchema).toBeTruthy();
      expect(res.jsonLdSchema.headline).toBeTruthy();
      // metaDescription should be present and include expected snippet
      expect(res.metaDescription).toBeTruthy();
      expect(res.metaDescription).toMatch(/summary paragraph/);
      // thumbnailUrls altText should be set from seoTitle or title
      expect(res.thumbnailUrls).toBeTruthy();
      expect(res.thumbnailUrls.altText).toBeTruthy();
    });
    test.skip('should generate draft with affiliate links', async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip('should handle missing idea data gracefully', async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip('should include performance data in prompt when available', async () => {
      // 매우 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });
  });

  describe('generateIdeaBriefing', () => {
    test('generate briefing for affiliate link', async () => {
      // Mock callGeminiAPI to return JSON arrays for prompts
      const svc = require('../js/services/aiService.js');
      const mock = jest.spyOn(svc, 'callGeminiAPI');
      mock.mockImplementation(async (prompt) => {
        if (prompt.includes('목차'))
          return '["1. 소개", "2. 기능", "3. 사용법", "4. 팁", "5. 결론"]';
        if (prompt.includes('주요 키워드')) return '["제품명", "리뷰", "할인", "구매", "비교"]';
        if (prompt.includes('롱테일'))
          return '["제품명 사용법", "제품명 리뷰 후기", "제품명 vs 경쟁제품", "제품명 할인 정보", "제품명 구매처"]';
        if (prompt.includes('추천 검색어'))
          return '["#제품명", "#리뷰", "#할인", "#구매", "#추천"]';
        return '[]';
      });

      // Call generateIdeaBriefing directly with affiliate origin context
      const result = await svc.generateIdeaBriefing('card-123', '제품명 베타', '효율적인 사용법', {
        status: 'ideas',
        generateOutline: true,
        generateKeywords: true,
        generateLongTail: true,
        generateMainKeywords: true,
        originType: 'affiliate_link',
        origin: { productName: '제품명' },
      });

      // 새로운 반환 형식: 구조화된 결과 객체를 반환해야 함
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.updates)).toBe(true);

      // no-op: no spy used in this test
    });

    test('writes processing status at start', async () => {
      jest.resetModules();
      // spy on update to see initial processing write
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn().mockResolvedValue(),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((d) => d),
        serverTimestamp: () => 'SERVER_TS',
      }));

      const svc = require('../js/services/aiService.js');
      const mock = jest.spyOn(svc, 'callGeminiAPI').mockImplementation(async (prompt) => '[]');

      await svc.generateIdeaBriefing('card-proc', 'title', 'desc', { status: 'ideas' });

      const firebase = require('../js/services/firebaseService.js');
      // first update should include processing flag
      expect(firebase.update).toHaveBeenCalled();
      const firstUpdate = firebase.update.mock.calls[0][1];
      expect(firstUpdate.briefingStatus).toBe('processing');

      // should also have persisted an initial progress marker (5%)
      const progressCall = firebase.update.mock.calls.find(
        (c) => c[1] && typeof c[1].briefingProgress === 'number'
      );
      expect(progressCall).toBeTruthy();
      expect(progressCall[1].briefingProgress).toBeGreaterThanOrEqual(0);

      // test complete - no spy to restore in this case
    });

    test('writes done status when updates are saved successfully', async () => {
      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn().mockResolvedValue(),
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((d) => d),
        serverTimestamp: () => 'SERVER_TS',
      }));

      const svc = require('../js/services/aiService.js');
      const mock = jest.spyOn(svc, 'callGeminiAPI').mockImplementation(async (prompt) => {
        if (prompt.includes('목차')) return '["1. intro"]';
        if (prompt.includes('주요 키워드')) return '["kw1","kw2"]';
        return '[]';
      });

      await svc.generateIdeaBriefing('card-success', 'title', 'desc', {
        status: 'ideas',
        generateOutline: true,
        generateMainKeywords: true,
      });

      const firebase = require('../js/services/firebaseService.js');
      const calls = firebase.update.mock.calls.map((c) => c[1]);
      const doneCall = calls.find((p) => p && p.briefingStatus === 'done');
      expect(doneCall).toBeDefined();
      // progress should have been persisted at least once during the flow
      const progressCallExists = calls.some((p) => p && typeof p.briefingProgress === 'number');
      expect(progressCallExists).toBeTruthy();

      // cleanup: no spy to restore in this test
    });

    test('returns done + no updates when model provides empty responses', async () => {
      jest.resetModules();
      // Make firebase.update a spy to capture calls BEFORE importing aiService
      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: jest.fn().mockResolvedValue(),
        serverTimestamp: () => 'SERVER_TS',
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((d) => d),
      }));

      const svc = require('../js/services/aiService.js');
      const mock = jest.spyOn(svc, 'callGeminiAPI');
      // Simulate no response (null) so no updates keys are created
      mock.mockImplementation(async () => null);
      const res = await svc.generateIdeaBriefing('card-empty', 'Empty Case', 'No content', {
        status: 'ideas',
        generateOutline: true,
        generateKeywords: true,
        generateLongTail: true,
        generateMainKeywords: true,
        originType: 'manual_entry',
        origin: {},
      });

      expect(res).toBeDefined();
      expect(res.success).toBe(true);
      expect(Array.isArray(res.updates)).toBe(true);
      expect(res.updates.length).toBe(0);

      // Should have written briefingStatus: 'done' (may have earlier 'processing' write)
      const firebase = require('../js/services/firebaseService.js');
      expect(firebase.update).toHaveBeenCalled();
      const calls = firebase.update.mock.calls.map((c) => c[1]);
      const doneCall = calls.find((p) => p && p.briefingStatus === 'done');
      expect(doneCall).toBeDefined();

      // no spy used in this test
    });

    test('should mark failed and return structured error when DB update fails', async () => {
      jest.resetModules();
      // Prepare firebase update mock: first call (processing) resolves,
      // second call (saving updates) rejects to simulate DB failure,
      // third call (failed marker) resolves.
      // updateMock will reject only when saving actual update payload (no briefingStatus key)
      const updateMock = jest.fn((path, payload) => {
        // If payload looks like an updates object (has keys but not briefingStatus), simulate failure
        if (payload && Object.keys(payload).length > 0 && !payload.briefingStatus) {
          return Promise.reject(new Error('SAVE_FAIL'));
        }
        // Otherwise (processing flag or failure marker), succeed
        return Promise.resolve();
      });

      jest.doMock('../js/services/firebaseService.js', () => ({
        getDb: jest.fn(() => 'mock-db'),
        ref: jest.fn(() => 'mock-ref'),
        update: updateMock,
        serverTimestamp: () => 'SERVER_TS',
        get: jest.fn(() => Promise.resolve({ val: () => ({}) })),
        // getCurrentUserId returns a valid user id so the outer try block runs
        getCurrentUserId: jest.fn(() => 'test-user-id'),
        cleanDataForFirebase: jest.fn((d) => d),
      }));
      // Simulate chrome storage failure to throw inside the try block, triggering outer catch
      global.chrome.storage.local.get = jest.fn(() => {
        throw new Error('SIMULATED_CHROME_FAIL');
      });
      const svc = require('../js/services/aiService.js');

      const firebase = require('../js/services/firebaseService.js');
      const res = await svc.generateIdeaBriefing('card-fail', 'FailCase', 'desc', {
        status: 'ideas',
        generateOutline: true,
        generateKeywords: false,
        generateLongTail: false,
        generateMainKeywords: false,
        originType: 'ai_generated',
        origin: {},
      });

      // debug: inspect result
      // (removed noisy debug output)
      expect(res).toBeDefined();
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();

      // Should have attempted to write failure status after update rejection
      expect(firebase.update).toHaveBeenCalled();
      const calls = firebase.update.mock.calls.map((c) => c[1]);
      // The mock should have been called multiple times and one of the
      // calls should set briefingStatus to 'failed'
      const failCall = calls.find((p) => p && p.briefingStatus === 'failed');
      expect(failCall).toBeDefined();

      // no spy to restore in this test
    });
  });

  describe('generateAiImage', () => {
    test.skip('should generate AI images successfully', async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip('should handle API errors gracefully', async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });

    test.skip('should default to count = 1 when not specified', async () => {
      // 복잡한 함수로 인해 스킵 - 통합 테스트에서 검증
    });
  });

  describe('analyzeKeywordGap', () => {
    test('should analyze keyword gap between content', async () => {
      const myContent = [{ tags: ['#tag1', '#tag2'] }, { tags: ['#tag2', '#tag3'] }];
      const competitorContent = [{ tags: ['#tag1', '#tag4'] }, { tags: ['#tag4', '#tag5'] }];

      const result = await analyzeKeywordGap(myContent, competitorContent);

      expect(result).toHaveProperty('gapKeywords');
      expect(result).toHaveProperty('gapCount');
      expect(Array.isArray(result.gapKeywords)).toBe(true);
      expect(result.gapKeywords).toContain('tag4');
      expect(result.gapKeywords).toContain('tag5');
    });
  });

  describe('getEmergingTopics', () => {
    test('should get emerging topics from channel context', async () => {
      mockFetchResponse.json.mockResolvedValue({
        candidates: [
          {
            content: {
              parts: [{ text: '신흥 주제 분석 결과' }],
            },
          },
        ],
      });

      // ensure fetch returns our mock response
      global.fetch.mockResolvedValue(mockFetchResponse);

      const result = await getEmergingTopics('테스트 채널 맥락');

      expect(typeof result).toBe('string');
      expect(result).toContain('신흥 주제 분석 결과');
    });

    test('should return null for empty channel context', async () => {
      const result = await getEmergingTopics(null);

      expect(result).toBeNull();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('should handle API errors', async () => {
      const channelContext = 'test context';

      mockFetchResponse.ok = false;
      mockFetchResponse.status = 400;
      mockFetchResponse.json.mockResolvedValue({
        error: { message: 'Bad Request' },
      });

      // ensure fetch returns our mock response
      global.fetch.mockResolvedValue(mockFetchResponse);

      await expect(getEmergingTopics(channelContext)).rejects.toThrow('Bad Request');

      // 복원
      mockFetchResponse.ok = true;
      mockFetchResponse.status = 200;
    });
  });

  describe('postProcessAffiliateHtml', () => {
    test('wraps existing affiliate anchors and styles them', () => {
      const html = '<p>테스트 문장 <a href="https://shop.example/aff1">구매하기</a> 끝</p>';
      const links = [
        {
          url: 'https://shop.example/aff1',
          productName: '상품A',
          keywords: ['상품A'],
        },
      ];

      const result = require('../js/services/aiService.js').postProcessAffiliateHtml(html, links, {
        maxLinks: 3,
      });

      expect(result).toContain('style="color: #2e7d32;');
      expect(result).toContain('href="https://shop.example/aff1"');
    });

    test('inserts affiliate link when keyword is present and no anchor exists', () => {
      const html = '<p>이 글은 최신 상품A 리뷰입니다. 많은 정보를 담았습니다.</p>';
      const links = [
        {
          url: 'https://shop.example/aff1',
          productName: '상품A',
          keywords: ['상품A'],
        },
      ];

      const result = require('../js/services/aiService.js').postProcessAffiliateHtml(html, links, {
        maxLinks: 2,
      });

      // Should have inserted an anchor for 상품A
      expect(result).toMatch(/<a [^>]*href="https:\/\/shop.example\/aff1"/);
      // Should contain CTA text (상품명 기반)
      expect(result).toContain('상품A 최저가 확인하기');
    });

    test('does not insert more than maxLinks', () => {
      const html = '<p>상품A와 상품B, 상품C 및 상품D가 소개됩니다.</p>';
      const links = [
        { url: 'https://s/affA', productName: '상품A', keywords: ['상품A'] },
        { url: 'https://s/affB', productName: '상품B', keywords: ['상품B'] },
        { url: 'https://s/affC', productName: '상품C', keywords: ['상품C'] },
        { url: 'https://s/affD', productName: '상품D', keywords: ['상품D'] },
      ];

      const result = require('../js/services/aiService.js').postProcessAffiliateHtml(html, links, {
        maxLinks: 3,
      });

      // should include exactly 3 affiliate anchors
      const matches = result.match(/<a [^>]*href="https?:\/\/[^"]+"/g) || [];
      // allow other anchors, but ensure affiliate insertions <= 3 by counting our link urls
      const affCount = (result.match(/상품[A-D] 최저가 확인하기/g) || []).length;
      expect(affCount).toBeLessThanOrEqual(3);
    });
  });
});
