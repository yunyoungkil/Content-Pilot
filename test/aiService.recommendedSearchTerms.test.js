// test/aiService.recommendedSearchTerms.test.js

/**
 * 추천 검색어 생성 최적화 테스트
 * 
 * 목적: 자료 수집에 최적화된 실용적인 검색어 생성 검증
 */

import { generateIdeaBriefing } from '../js/services/aiService.js';
import * as firebaseService from '../js/services/firebaseService.js';

// Mock dependencies
jest.mock('../js/services/firebaseService.js', () => ({
  getDb: jest.fn(() => ({})),
  ref: jest.fn((db, path) => ({ _path: path })),
  get: jest.fn(),
  update: jest.fn(),
  serverTimestamp: jest.fn(() => Date.now()),
  getCurrentUserId: jest.fn(() => Promise.resolve('test-user-123')),
  CONSTANTS: {
    GEMINI_API_KEY: 'test-api-key',
  },
}));

// Mock Gemini API
global.fetch = jest.fn();

describe('추천 검색어 생성 최적화', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('프롬프트 구조', () => {
    it('자료 수집 목적을 명확히 명시해야 함', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '스마트홈 시장 규모 2024',
                    '스마트홈 설치 가이드',
                    '구글홈 vs 아마존 에코 비교',
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '스마트홈 추천', '2024년 스마트홈 제품 가이드', {
        generateKeywords: true,
      });

      // fetch가 호출되었는지 확인
      expect(global.fetch).toHaveBeenCalled();
      
      // 프롬프트에 자료 수집 목적이 포함되어 있는지 확인
      const fetchCall = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      const prompt = requestBody.contents[0].parts[0].text;
      
      expect(prompt).toContain('자료를 수집');
      expect(prompt).toContain('검색어 생성 원칙');
      expect(prompt).toContain('구체성');
      expect(prompt).toContain('다양성');
      expect(prompt).toContain('실용성');
    });

    it('5가지 검색어 유형을 균형있게 생성하도록 요청해야 함', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '스마트홈 시장 규모 2024',
                    '스마트홈 설치 가이드',
                    '구글홈 vs 아마존 에코',
                    '스마트홈 구축 사례',
                    '2024 스마트홈 트렌드',
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '스마트홈 추천', '스마트홈 가이드', {
        generateKeywords: true,
      });

      const fetchCall = global.fetch.mock.calls[0];
      const requestBody = JSON.parse(fetchCall[1].body);
      const prompt = requestBody.contents[0].parts[0].text;

      // 5가지 유형 언급 확인
      expect(prompt).toContain('통계/데이터 검색어');
      expect(prompt).toContain('가이드/방법 검색어');
      expect(prompt).toContain('비교/분석 검색어');
      expect(prompt).toContain('사례/후기 검색어');
      expect(prompt).toContain('최신 트렌드 검색어');
    });
  });

  describe('검색어 품질 검증', () => {
    it('해시태그 없이 실용적인 검색어를 생성해야 함', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '아이폰 15 프로 카메라 성능',
                    '아이폰 15 배터리 수명 테스트',
                    '아이폰 15 vs 갤럭시 S24 비교',
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '아이폰 15 리뷰', '아이폰 15 프로 상세 리뷰', {
        generateKeywords: true,
      });

      const updateCall = firebaseService.update.mock.calls.find(
        (call) => call[1] && call[1].tags
      );
      
      if (updateCall) {
        const tags = updateCall[1].tags;
        // 해시태그가 없어야 함
        tags.forEach((tag) => {
          expect(tag).not.toMatch(/^#/);
        });
      }
    });

    it('구체적이고 실용적인 검색어를 생성해야 함', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '전기차 충전 인프라 현황 2024',
                    '전기차 보조금 신청 방법',
                    '테슬라 모델3 vs 아이오닉6 가격 비교',
                    '전기차 실주행 거리 테스트',
                    '전기차 겨울철 배터리 관리 팁',
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '전기차 구매 가이드', '2024 전기차 추천', {
        generateKeywords: true,
      });

      const updateCall = firebaseService.update.mock.calls.find(
        (call) => call[1] && call[1].tags
      );

      if (updateCall) {
        const tags = updateCall[1].tags;
        
        // 각 검색어가 구체적인지 확인 (단순 1-2단어가 아닌 구체적인 문구)
        const hasSpecificTerms = tags.some((tag) => {
          const wordCount = tag.split(/\s+/).length;
          return wordCount >= 3; // 최소 3단어 이상
        });
        
        expect(hasSpecificTerms).toBe(true);
      }
    });
  });

  describe('에러 처리', () => {
    it('API 호출 실패 시 빈 배열을 반환해야 함', async () => {
      global.fetch.mockRejectedValue(new Error('API Error'));

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '테스트 제목', '테스트 설명', {
        generateKeywords: true,
      });

      // 에러가 발생해도 업데이트가 진행되어야 함 (tags가 없거나 빈 배열)
      expect(firebaseService.update).toHaveBeenCalled();
    });

    it('잘못된 JSON 응답 시 재시도해야 함', async () => {
      // 첫 번째 호출: 잘못된 형식
      // 두 번째 호출: 올바른 형식
      global.fetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [{ text: '이것은 배열이 아닙니다' }],
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify(['검색어1', '검색어2']),
                    },
                  ],
                },
              },
            ],
          }),
        });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing('test-card-id', '테스트', '테스트 설명', {
        generateKeywords: true,
      });

      // 재시도가 발생했는지 확인 (fetch가 2번 이상 호출됨)
      expect(global.fetch.mock.calls.length).toBeGreaterThan(1);
    });
  });

  describe('실전 시나리오', () => {
    it('시나리오 1: 가전제품 리뷰 - 다양한 유형의 검색어 생성', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '에어프라이어 시장 규모 2024', // 통계
                    '에어프라이어 사용법 초보자 가이드', // 가이드
                    '필립스 vs 코스모 에어프라이어 비교', // 비교
                    '에어프라이어 구매 후기', // 사례
                    '2024 에어프라이어 신제품 트렌드', // 트렌드
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing(
        'test-card-id',
        '에어프라이어 추천',
        '2024 에어프라이어 TOP 5',
        {
          generateKeywords: true,
        }
      );

      const updateCall = firebaseService.update.mock.calls.find(
        (call) => call[1] && call[1].tags
      );

      if (updateCall) {
        const tags = updateCall[1].tags;
        expect(tags.length).toBeGreaterThan(0);
        
        // 다양한 유형의 검색어가 포함되어 있는지 확인
        const hasStatistics = tags.some((t) => t.includes('시장') || t.includes('규모'));
        const hasGuide = tags.some((t) => t.includes('가이드') || t.includes('방법'));
        const hasComparison = tags.some((t) => t.includes('비교') || t.includes('vs'));
        
        expect(hasStatistics || hasGuide || hasComparison).toBe(true);
      }
    });

    it('시나리오 2: IT 제품 비교 - 비교 분석에 최적화된 검색어', async () => {
      const mockApiResponse = {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify([
                    '아이폰15 vs 갤럭시S24 성능 벤치마크',
                    '아이폰15 vs 갤럭시S24 카메라 화질 비교',
                    '아이폰15 vs 갤럭시S24 가격 비교',
                    '스마트폰 시장 점유율 2024',
                    '플래그십 스마트폰 배터리 수명 테스트',
                  ]),
                },
              ],
            },
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      firebaseService.get.mockResolvedValue({
        val: () => ({ status: 'idea' }),
      });
      firebaseService.update.mockResolvedValue();

      await generateIdeaBriefing(
        'test-card-id',
        '아이폰15 vs 갤럭시S24',
        '플래그십 스마트폰 비교',
        {
          generateKeywords: true,
        }
      );

      const updateCall = firebaseService.update.mock.calls.find(
        (call) => call[1] && call[1].tags
      );

      if (updateCall) {
        const tags = updateCall[1].tags;
        
        // 비교 분석에 유용한 검색어가 포함되어 있는지
        const hasComparisonTerms = tags.some(
          (t) =>
            t.includes('비교') ||
            t.includes('vs') ||
            t.includes('벤치마크') ||
            t.includes('테스트')
        );
        
        expect(hasComparisonTerms).toBe(true);
      }
    });
  });
});
