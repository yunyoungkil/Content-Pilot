// test/background.test.js
import { jest } from '@jest/globals';

// background.js의 메시지 핸들러 테스트
describe('Background Message Handlers', () => {
  let mockSendResponse;
  let mockGetUnifiedGalleryImages;

  beforeEach(() => {
    // chrome API 모킹: background.js가 다양한 chrome API를 사용하므로 테스트용으로 충분히 스텁을 제공
    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        onConnect: { addListener: jest.fn() },
        onInstalled: { addListener: jest.fn() },
        sendMessage: jest.fn(),
        lastError: null,
      },
      storage: {
        // Ensure restoreAuthSession / validateStoredToken sees an object (avoid undefined access)
        local: { get: jest.fn().mockImplementation((k, cb) => cb && cb({ googleAuthToken: null })), set: jest.fn() },
      },
      tabs: { query: jest.fn().mockImplementation((o, cb) => cb && cb([])), sendMessage: jest.fn() },
      action: { onClicked: { addListener: jest.fn() } },
      scripting: { executeScript: jest.fn(), insertCSS: jest.fn() },
      alarms: { onAlarm: { addListener: jest.fn() }, create: jest.fn(), get: jest.fn() },
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
      await import('../background.js');

      // background가 runtime onMessage listener를 등록했는지 확인
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      // 테스트 메시지
      const message = {
        action: 'get_unified_gallery',
        data: { filter: 'ALL' },
      };

      // 실제로 메시지 핸들러를 호출하고 비동기 응답이 resolve되도록 대기
      await runtimeHandler(message, { tab: { id: 1 } }, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      // 메시지 핸들러 함수 추출 (테스트용으로 가정)
      // 실제로는 background.js의 핸들러 로직을 테스트하기 위해 별도 함수로 분리하는 것이 좋음

      expect(mockGetUnifiedGalleryImages).toHaveBeenCalledWith('ALL');
      expect(mockSendResponse).toHaveBeenCalledWith({ success: true, images: mockImages });
    });

    test('should handle get_unified_gallery message with STORAGE filter', async () => {
      const mockImages = [
        { id: '2', source: 'STORAGE', url: 'http://example.com/2.jpg' },
      ];
      mockGetUnifiedGalleryImages.mockResolvedValue(mockImages);

      // ensure the background module is loaded and listener registered
      await import('../background.js');

      const message = { action: 'get_unified_gallery', filter: 'STORAGE' };

      // ensure the listener exists and call it with the STORAGE filter
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      const runtimeHandler2 = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      await runtimeHandler2(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

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

      // ensure the background module is loaded and listener registered
      await import('../background.js');

      // invoke handler without filter -> should default to ALL
      const runtimeHandler3 = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      await runtimeHandler3(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGetUnifiedGalleryImages).toHaveBeenCalledWith('ALL');
    });

    test('should handle error in getUnifiedGalleryImages', async () => {
      mockGetUnifiedGalleryImages.mockRejectedValue(new Error('Database error'));

      const message = {
        action: 'get_unified_gallery',
        data: { filter: 'ALL' },
      };

      await import('../background.js');

      const runtimeHandler4 = chrome.runtime.onMessage.addListener.mock.calls[0][0];
      await runtimeHandler4(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockSendResponse).toHaveBeenCalledWith({ success: false, error: 'Database error' });
    });
  });

  describe('system handlers (ping / get_user_id)', () => {
    test('should reply to ping synchronously', async () => {
      await import('../background.js');

      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = { action: 'ping' };
      const sendResponse = jest.fn();

      const ret = runtimeHandler(message, {}, sendResponse);

      // ping returns a synchronous response and should not indicate async
      expect(ret).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ success: true, message: 'pong' });
    });

    test('should handle get_user_id with async reply', async () => {
      // mock getCurrentUserId to return a known value
      const mockedUserId = 'background-test-user';
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue(mockedUserId),
        getDb: jest.fn(),
        CONSTANTS: { USER_ID: 'default_user' },
        initializeFirebase: jest.fn(),
      }));

      await import('../background.js');

      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = { action: 'get_user_id' };
      const sendResponse = jest.fn();

      const ret = runtimeHandler(message, {}, sendResponse);

      // get_user_id returns an async handler (true) and eventually calls sendResponse
      expect(ret).toBe(true);
      // wait for microtasks to complete
      await new Promise((r) => setTimeout(r, 0));

      expect(sendResponse).toHaveBeenCalledWith({ success: true, userId: mockedUserId });
    });
  });
});