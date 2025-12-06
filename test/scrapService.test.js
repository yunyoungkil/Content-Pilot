// test/scrapService.test.js

// Firebase SDK 모킹
jest.mock('firebase/app', () => ({
  initializeApp: jest.fn(),
}));

jest.mock('firebase/database', () => ({
  getDatabase: jest.fn(() => 'mock-db'),
  ref: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  push: jest.fn(),
}));

// 서비스 모킹
jest.mock('../js/services/firebaseService.js', () => ({
  getCurrentUserId: jest.fn(),
  cleanDataForFirebase: jest.fn((data) => data),
  getDb: jest.fn(() => 'mock-db'),
  ref: jest.fn(),
  get: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  push: jest.fn(),
}));

jest.mock('../js/utils.js', () => ({
  Logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    biz: jest.fn(),
  },
}));

import { removeScrapImage } from '../js/services/scrapService.js';

/**
 * Scrap Service 테스트
 * 스크랩 관련 기능 검증
 */
describe('Scrap Service', () => {
  let mockFirebaseService;
  let mockLogger;

  beforeEach(() => {
    jest.clearAllMocks();

    // 모킹된 서비스들 가져오기
    mockFirebaseService = require('../js/services/firebaseService.js');
    mockLogger = require('../js/utils.js').Logger;

    // 기본 모킹 설정
    mockFirebaseService.getCurrentUserId.mockResolvedValue('test-user-id');
    mockFirebaseService.ref.mockReturnValue('mock-ref');
  });

  describe('toggleScrapSharing', () => {
    it('should return error when scrap not found', async () => {
      const scrapId = 'not-found';
      const mockSnapshot = { exists: jest.fn(() => false), val: jest.fn(() => null) };
      mockFirebaseService.get.mockResolvedValue(mockSnapshot);

      const result = await require('../js/services/scrapService.js').toggleScrapSharing(scrapId, 'channel-x');
      expect(result.success).toBe(false);
      expect(result.error).toBe('스크랩을 찾을 수 없습니다.');
    });

    it('should toggle to dedicated and clear cache when currently public', async () => {
      const scrapId = 'scrap-1';
      const mockScrapData = { channelId: null };
      const mockSnapshot = { exists: jest.fn(() => true), val: jest.fn(() => mockScrapData) };
      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      const result = await require('../js/services/scrapService.js').toggleScrapSharing(scrapId, 'active-chan');
      expect(result.success).toBe(true);
      expect(result.newChannelId).toBe('active-chan');
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', { channelId: 'active-chan' });
    });

    it('should toggle to public when currently dedicated', async () => {
      const scrapId = 'scrap-2';
      const mockScrapData = { channelId: 'some-chan' };
      const mockSnapshot = { exists: jest.fn(() => true), val: jest.fn(() => mockScrapData) };
      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      const result = await require('../js/services/scrapService.js').toggleScrapSharing(scrapId, 'ignored');
      expect(result.success).toBe(true);
      expect(result.newChannelId).toBe(null);
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', { channelId: null });
    });
  });

  describe('removeScrapImage', () => {
    it('should successfully remove image from allImages array', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: [
          'https://example.com/image1.jpg',
          'https://example.com/image.jpg',
          'https://example.com/image2.jpg',
        ],
        images: [],
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockFirebaseService.getCurrentUserId).toHaveBeenCalledTimes(1);
      expect(mockFirebaseService.ref).toHaveBeenCalledWith(
        'mock-db',
        'scraps/test-user-id/test-scrap-id'
      );
      expect(mockFirebaseService.get).toHaveBeenCalledWith('mock-ref');
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', {
        allImages: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      });
      expect(mockLogger.info).toHaveBeenCalledWith('[removeScrapImage] 이미지 삭제 완료');
    });

    it('should successfully remove image from images array (legacy)', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: [],
        images: [
          'https://example.com/image1.jpg',
          'https://example.com/image.jpg',
          'https://example.com/image2.jpg',
        ],
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', {
        images: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
      });
    });

    it('should successfully remove image from image field (legacy)', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: [],
        images: [],
        image: 'https://example.com/image.jpg',
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', {
        image: null,
      });
    });

    it('should handle HTML entity decoding in URLs', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image&amp;test.jpg'; // HTML 엔티티

      const mockScrapData = {
        allImages: ['https://example.com/image&test.jpg'], // 디코딩된 URL
        images: [],
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', {
        allImages: [],
      });
    });

    it('should return success when image not found (no changes needed)', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/nonexistent.jpg';

      const mockScrapData = {
        allImages: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
        images: [],
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(false);
      expect(mockFirebaseService.update).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[removeScrapImage] 매칭되는 이미지가 없습니다.'
      );
    });

    it('should return error when scrap not found', async () => {
      // Given
      const scrapId = 'nonexistent-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockSnapshot = {
        exists: jest.fn(() => false),
        val: jest.fn(() => null),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Scrap not found');
      expect(mockFirebaseService.update).not.toHaveBeenCalled();
    });

    it('should handle Firebase errors gracefully', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const firebaseError = new Error('Firebase connection error');
      mockFirebaseService.get.mockRejectedValue(firebaseError);

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(false);
      expect(result.error).toBe('Firebase connection error');
      expect(mockLogger.error).toHaveBeenCalledWith('[removeScrapImage] 오류:', firebaseError);
    });

    it('should clear scrap cache after successful update', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: ['https://example.com/image.jpg'],
        images: [],
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // scrapCache 모킹 (실제로는 scrapService 내부에 있지만 테스트를 위해 모킹)
      const mockScrapCache = { clear: jest.fn() };
      jest.doMock(
        '../js/services/scrapService.js',
        () => ({
          ...jest.requireActual('../js/services/scrapService.js'),
          scrapCache: mockScrapCache,
        }),
        { virtual: true }
      );

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockLogger.info).toHaveBeenCalledWith('[removeScrapImage] 캐시 초기화 완료');
    });

    it('should handle multiple image fields simultaneously', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: ['https://example.com/image.jpg', 'https://example.com/other.jpg'],
        images: ['https://example.com/image.jpg'],
        image: 'https://example.com/image.jpg',
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);
      mockFirebaseService.update.mockResolvedValue();

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(result.changed).toBe(true);
      expect(mockFirebaseService.update).toHaveBeenCalledWith('mock-ref', {
        allImages: ['https://example.com/other.jpg'],
        images: [],
        image: null,
      });
    });

    it('should handle empty or invalid image arrays', async () => {
      // Given
      const scrapId = 'test-scrap-id';
      const imageUrl = 'https://example.com/image.jpg';

      const mockScrapData = {
        allImages: null,
        images: undefined,
        image: null,
      };

      const mockSnapshot = {
        exists: jest.fn(() => true),
        val: jest.fn(() => mockScrapData),
      };

      mockFirebaseService.get.mockResolvedValue(mockSnapshot);

      // When
      const result = await removeScrapImage(scrapId, imageUrl);

      // Then
      expect(result.success).toBe(true);
      expect(mockFirebaseService.update).not.toHaveBeenCalled();
    });
  });
});
