// test/aiService.affiliateLinks.test.js

/**
 * 제휴 링크 매칭 최적화 테스트
 * 
 * 테스트 항목:
 * 1. 완전 일치 매칭
 * 2. 부분 일치 매칭
 * 3. 상품명 우선순위
 * 4. 캐시 동작
 * 5. 스코어링 알고리즘
 */

import { getRelevantAffiliateLinks, invalidateAffiliateLinkCache } from '../js/services/aiService.js';
import * as firebaseService from '../js/services/firebaseService.js';

// Mock Firebase
jest.mock('../js/services/firebaseService.js', () => ({
  getDb: jest.fn(() => ({})),
  ref: jest.fn((db, path) => ({ _path: path })),
  get: jest.fn(),
  getCurrentUserId: jest.fn(() => Promise.resolve('test-user-123')),
}));

describe('제휴 링크 매칭 최적화', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateAffiliateLinkCache(); // 캐시 초기화
  });

  describe('완전 일치 매칭', () => {
    it('제목과 키워드가 완전히 일치하면 가장 높은 점수를 부여해야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['아이폰15'],
          productName: '아이폰 15 프로',
          url: 'https://example.com/iphone15',
        },
        link2: {
          id: 'link2',
          keywords: ['갤럭시'],
          productName: '갤럭시 S24',
          url: 'https://example.com/galaxy',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '아이폰15 구매 가이드');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('link1');
    });

    it('상품명 완전 일치가 키워드 일치보다 높은 점수여야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['스마트폰'],
          productName: '갤럭시 S24',
          url: 'https://example.com/galaxy',
        },
        link2: {
          id: 'link2',
          keywords: ['갤럭시 S24'],
          productName: '아이폰',
          url: 'https://example.com/iphone',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '갤럭시 S24 리뷰');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('link1'); // 상품명 일치가 우선
    });
  });

  describe('부분 일치 매칭', () => {
    it('키워드가 제목에 부분적으로 포함되면 매칭되어야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['무선이어폰'],
          url: 'https://example.com/earbuds',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks(
        'test-user',
        '2024 최고의 무선이어폰 추천 TOP 10'
      );

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('link1');
    });

    it('역방향 매칭: 제목의 토큰이 키워드에 포함되는 경우', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['갤럭시버즈프로3'],
          url: 'https://example.com/buds',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '갤럭시 버즈 프로 리뷰');

      expect(result).toHaveLength(1);
    });
  });

  describe('설명(description) 보조 매칭', () => {
    it('설명에 매칭되는 키워드가 있으면 보조 점수를 부여해야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['노트북'],
          description: '업무용 노트북 추천 고성능 모델',
          url: 'https://example.com/laptop1',
        },
        link2: {
          id: 'link2',
          keywords: ['게임'],
          description: '게임용 노트북',
          url: 'https://example.com/laptop2',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '업무용 노트북 추천');

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].id).toBe('link1'); // 설명에 "업무용" 포함
    });
  });

  describe('preferredAffiliateId 우선순위', () => {
    it('선호 ID가 지정되면 최우선으로 선택되어야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['아이폰'],
          url: 'https://example.com/iphone1',
        },
        link2: {
          id: 'preferred-link',
          keywords: ['갤럭시'],
          url: 'https://example.com/galaxy',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '아이폰 구매', {
        preferredAffiliateId: 'preferred-link',
      });

      expect(result[0].id).toBe('preferred-link');
    });
  });

  describe('필터링 및 유효성 검증', () => {
    it('키워드가 없는 링크는 제외되어야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: [],
          url: 'https://example.com/link1',
        },
        link2: {
          id: 'link2',
          keywords: ['스마트폰'],
          url: 'https://example.com/link2',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '스마트폰 추천');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('link2');
    });

    it('URL이 없는 링크는 제외되어야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['스마트폰'],
          url: '',
        },
        link2: {
          id: 'link2',
          keywords: ['스마트폰'],
          url: 'https://example.com/link2',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '스마트폰 추천');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('link2');
    });

    it('최소 스코어(0.5) 미만인 링크는 제외되어야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['완전다른키워드'],
          url: 'https://example.com/link1',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '아이폰 추천');

      expect(result).toHaveLength(0);
    });
  });

  describe('결과 개수 제한', () => {
    it('최대 10개까지만 반환해야 함', async () => {
      const mockLinks = {};
      for (let i = 1; i <= 20; i++) {
        mockLinks[`link${i}`] = {
          id: `link${i}`,
          keywords: ['스마트폰'],
          url: `https://example.com/link${i}`,
        };
      }

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '스마트폰 추천');

      expect(result.length).toBeLessThanOrEqual(10);
    });

    it('점수 차이가 크면 상위 5개만 반환해야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['아이폰15'],
          productName: '아이폰 15 프로',
          url: 'https://example.com/link1',
        },
      };
      // 점수가 낮은 링크들 추가
      for (let i = 2; i <= 10; i++) {
        mockLinks[`link${i}`] = {
          id: `link${i}`,
          keywords: ['스마트'],
          url: `https://example.com/link${i}`,
        };
      }

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks('test-user', '아이폰15 프로 리뷰');

      // 고품질 매칭이므로 5개 이하
      expect(result.length).toBeLessThanOrEqual(5);
    });
  });

  describe('캐시 동작', () => {
    it('같은 사용자 ID로 두 번 호출하면 캐시에서 로드해야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['test'],
          url: 'https://example.com/test',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      // 첫 번째 호출
      await getRelevantAffiliateLinks('test-user', 'test keyword');
      expect(firebaseService.get).toHaveBeenCalledTimes(1);

      // 두 번째 호출 (캐시에서 로드)
      await getRelevantAffiliateLinks('test-user', 'test keyword');
      expect(firebaseService.get).toHaveBeenCalledTimes(1); // 여전히 1회만 호출됨
    });

    it('invalidateAffiliateLinkCache 호출 후 다시 조회해야 함', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['test'],
          url: 'https://example.com/test',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      // 첫 번째 호출
      await getRelevantAffiliateLinks('test-user', 'test keyword');
      expect(firebaseService.get).toHaveBeenCalledTimes(1);

      // 캐시 무효화
      invalidateAffiliateLinkCache('test-user');

      // 두 번째 호출 (다시 조회)
      await getRelevantAffiliateLinks('test-user', 'test keyword');
      expect(firebaseService.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('에러 처리', () => {
    it('Firebase 조회 실패 시 빈 배열을 반환해야 함', async () => {
      firebaseService.get.mockRejectedValue(new Error('Network error'));

      const result = await getRelevantAffiliateLinks('test-user', 'test keyword');

      expect(result).toEqual([]);
    });

    it('데이터가 없으면 빈 배열을 반환해야 함', async () => {
      firebaseService.get.mockResolvedValue({ val: () => null });

      const result = await getRelevantAffiliateLinks('test-user', 'test keyword');

      expect(result).toEqual([]);
    });
  });

  describe('실전 시나리오', () => {
    it('시나리오 1: 가전제품 리뷰 글', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['에어프라이어', '가전'],
          productName: '필립스 에어프라이어 XXL',
          url: 'https://example.com/airfryer1',
        },
        link2: {
          id: 'link2',
          keywords: ['전자레인지'],
          productName: 'LG 전자레인지',
          url: 'https://example.com/microwave',
        },
        link3: {
          id: 'link3',
          keywords: ['에어프라이어'],
          productName: '코스모 에어프라이어',
          url: 'https://example.com/airfryer2',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks(
        'test-user',
        '2024 에어프라이어 추천 TOP 5 가전제품'
      );

      expect(result.length).toBeGreaterThan(0);
      expect(result[0].keywords).toContain('에어프라이어');
    });

    it('시나리오 2: IT 제품 비교 글', async () => {
      const mockLinks = {
        link1: {
          id: 'link1',
          keywords: ['아이폰15'],
          productName: '아이폰 15 프로',
          url: 'https://example.com/iphone',
        },
        link2: {
          id: 'link2',
          keywords: ['갤럭시S24'],
          productName: '갤럭시 S24 울트라',
          url: 'https://example.com/galaxy',
        },
      };

      firebaseService.get.mockResolvedValue({ val: () => mockLinks });

      const result = await getRelevantAffiliateLinks(
        'test-user',
        '아이폰15 vs 갤럭시S24 비교 리뷰'
      );

      expect(result).toHaveLength(2);
    });
  });
});
