// test/background.test.js
import { jest } from '@jest/globals';

// background.js의 메시지 핸들러 테스트
describe('Background Message Handlers', () => {
  let mockSendResponse;
  let mockGetUnifiedGalleryImages;

  beforeEach(() => {
    // chrome API 모킹
    global.chrome = {
      runtime: {
        onMessage: {
          addListener: jest.fn(),
        },
        sendMessage: jest.fn(),
      },
      storage: {
        local: {
          get: jest.fn(),
          set: jest.fn(),
        },
      },
    };

    // sendResponse 모킹
    mockSendResponse = jest.fn();

    // firebaseService 모킹
    mockGetUnifiedGalleryImages = jest.fn();
    jest.doMock('../js/services/firebaseService.js', () => ({
      getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
      getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
      // 다른 필요한 함수들도 모킹
      getDb: jest.fn(),
      CONSTANTS: { USER_ID: 'default_user' },
      initializeFirebase: jest.fn(),
      uploadImageToFirebaseStorage: jest.fn(),
      cleanDataForFirebase: jest.fn(),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  describe('get_unified_gallery handler', () => {
    test('should handle get_unified_gallery message with ALL filter', async () => {
      // firebaseService 모킹 설정
      const mockImages = [
        { id: '1', source: 'SCRAP', url: 'http://example.com/1.jpg' },
        { id: '2', source: 'STORAGE', url: 'http://example.com/2.jpg' },
      ];
      mockGetUnifiedGalleryImages.mockResolvedValue(mockImages);

      // background.js 로드 (동적으로 import)
      const backgroundModule = await import('../background.js');

      // 메시지 핸들러 함수 추출 (테스트용으로 가정)
      // 실제로는 background.js의 핸들러 로직을 테스트하기 위해 별도 함수로 분리하는 것이 좋음

      // 테스트 메시지
      const message = {
        action: 'get_unified_gallery',
        data: { filter: 'ALL' },
      };

      // 핸들러 직접 호출 (실제 구현에 맞게 조정 필요)
      // 이 부분은 background.js의 실제 핸들러 구조에 따라 다름

      expect(mockGetUnifiedGalleryImages).toHaveBeenCalledWith('ALL');
      expect(mockSendResponse).toHaveBeenCalledWith({
        success: true,
        images: mockImages,
      });
    });

    test('should handle get_unified_gallery message with STORAGE filter', async () => {
      const mockImages = [
        { id: '2', source: 'STORAGE', url: 'http://example.com/2.jpg' },
      ];
      mockGetUnifiedGalleryImages.mockResolvedValue(mockImages);

      const message = {
        action: 'get_unified_gallery',
        filter: 'STORAGE',
      };

      // 핸들러 호출 로직 (실제 구현에 맞게)

      expect(mockGetUnifiedGalleryImages).toHaveBeenCalledWith('STORAGE');
    });

    test('should handle get_unified_gallery message with default filter', async () => {
      const mockImages = [
        { id: '1', source: 'SCRAP', url: 'http://example.com/1.jpg' },
        { id: '2', source: 'STORAGE', url: 'http://example.com/2.jpg' },
      ];
      mockGetUnifiedGalleryImages.mockResolvedValue(mockImages);

      const message = {
        action: 'get_unified_gallery',
        // filter 없음
      };

      // 핸들러 호출

      expect(mockGetUnifiedGalleryImages).toHaveBeenCalledWith('ALL');
    });

    test('should handle error in getUnifiedGalleryImages', async () => {
      mockGetUnifiedGalleryImages.mockRejectedValue(new Error('Database error'));

      const message = {
        action: 'get_unified_gallery',
        data: { filter: 'ALL' },
      };

      // 핸들러 호출 시 에러 처리 확인

      expect(mockSendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Database error',
      });
    });
  });
});