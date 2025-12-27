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
        // make sendMessage return a Promise so callers using .catch() won't throw
        sendMessage: jest.fn().mockResolvedValue({ success: true }),
        lastError: null,
      },
      storage: {
        // Ensure restoreAuthSession / validateStoredToken sees an object (avoid undefined access)
        local: {
          get: jest.fn().mockImplementation((k, cb) => cb && cb({ googleAuthToken: null })),
          set: jest.fn(),
        },
      },
      tabs: {
        query: jest.fn().mockImplementation((o, cb) => cb && cb([])),
        sendMessage: jest.fn(),
      },
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
      // 기본적으로 테스트에서 사용하는 Firebase helper들을 스텁으로 제공
      getDb: jest.fn(),
      get: jest.fn().mockResolvedValue({ val: () => null }),
      getUploadedImagesLog: jest.fn().mockResolvedValue([]),
      remove: jest.fn(),
      ref: jest.fn(),
      markDeletedThumbnail: jest.fn(),
      isThumbnailDeleted: jest.fn().mockResolvedValue(false),
      CONSTANTS: { USER_ID: 'default_user' },
      initializeFirebase: jest.fn(),
      uploadImageToFirebaseStorage: jest.fn(),
      cleanDataForFirebase: jest.fn(),
    }));

    // authService.restoreAuthSession을 테스트에서 무시하도록 모킹해서 import 시 불필요한 로그를 억제
    jest.doMock('../js/services/authService.js', () => ({
      restoreAuthSession: jest.fn().mockResolvedValue(null),
      getValidToken: jest.fn(),
      startGoogleAuth: jest.fn(),
      revokeGoogleAuth: jest.fn(),
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

      // background.cjs 로드 (동적으로 import)
      // background.js 대신 실제 프로덕션 소스인 background.cjs를 테스트
      await import('../background.cjs');

      // background가 runtime onMessage listener를 등록했는지 확인
      expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
      // pick the most recently registered listener
      const calls = chrome.runtime.onMessage.addListener.mock.calls;
      const runtimeHandler = calls[calls.length - 1][0];

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
      const lastResp = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastResp).toEqual(expect.objectContaining({ success: true, images: mockImages }));
    });

    test('should handle get_unified_gallery message with STORAGE filter', async () => {
      const mockImages = [{ id: '2', source: 'STORAGE', url: 'http://example.com/2.jpg' }];
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

      const lastErr = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastErr).toEqual(expect.objectContaining({ success: false, error: 'Database error' }));
    });

    test('delete_storage_image returns error when storagePath is missing', async () => {
      // mock deleteImageFromStorage to ensure it is not called
      const mockDelete = jest.fn();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: jest.fn(),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image', data: { id: 'x' } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      // now returns synchronous error response (false) instead of async handler
      expect(ret).toBe(false);

      const lastErr = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastErr).toEqual(
        expect.objectContaining({ success: false, error: 'missing storagePath' })
      );
      expect(mockDelete).not.toHaveBeenCalled();
    });

    test('delete_storage_image responds immediately when message data is missing', async () => {
      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image' }; // no data
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);

      // synchronous early-return => false and immediate response
      expect(ret).toBe(false);
      const lastErr = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastErr).toEqual(
        expect.objectContaining({ success: false, error: 'missing message data' })
      );
    });

    test('delete_storage_image handles deleteImageFromStorage failure gracefully', async () => {
      const mockDelete = jest.fn().mockRejectedValue(new Error('DELETE failed'));
      const mockRemove = jest.fn();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'delete_storage_image',
        data: { id: 'x', storagePath: 'gs://bucket/x.png' },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      const lastErr = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastErr).toEqual(expect.objectContaining({ success: false, error: 'DELETE failed' }));
      expect(mockRemove).not.toHaveBeenCalled();
    });

    test('delete_storage_image succeeds when delete and remove succeed (no tab)', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn().mockReturnValue('thumbnail_ref');
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: mockRef,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'delete_storage_image',
        data: { id: 'x', storagePath: 'gs://bucket/x.png' },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      const lastSucc = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastSucc).toEqual(expect.objectContaining({ success: true }));
      expect(mockRemove).toHaveBeenCalled();
    });

    test('delete_storage_image accepts and notifies tab with final result', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn().mockReturnValue('thumbnail_ref');
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: mockRef,
      }));

      chrome.tabs = { sendMessage: jest.fn((tabId, msg, cb) => cb && cb()) };

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'delete_storage_image',
        data: { id: 'x', storagePath: 'gs://bucket/x.png' },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, { tab: { id: 123 } }, sendResponse);

      // immediate ACK
      expect(ret).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: 'accepted', requestId: expect.any(String) })
      );

      // wait for async notification to be sent
      await new Promise((r) => setTimeout(r, 0));

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        123,
        expect.objectContaining({ action: 'delete_storage_image_result', success: true }),
        expect.any(Function)
      );
    });

    test('delete_storage_image marks tombstone for parsed storage path', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn().mockReturnValue('thumbnail_ref');
      const mockMark = jest.fn().mockResolvedValue(true);

      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: mockRef,
        markDeletedThumbnail: mockMark,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'delete_storage_image',
        data: { id: 'x', storagePath: 'gs://bucket/thumbnails/user/gen-1.png' },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockRemove).toHaveBeenCalled();
      expect(mockMark).toHaveBeenCalledWith('test-user', 'thumbnails/user/gen-1.png');
    });

    test('delete_storage_image_by_url marks tombstone for parsed path', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest.fn().mockResolvedValue([]);
      const mockMark = jest.fn().mockResolvedValue(true);
      const downloadUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        markDeletedThumbnail: mockMark,
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image_by_url', data: { url: downloadUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockMark).toHaveBeenCalledWith('test-user', 'thumbnails/user/gen-1.png');
    });

    test('force_remove_url_references dryRun shows planned removals', async () => {
      const testUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/thumbnails%2F113959899989339493619%2F1766719112553_0.png?alt=media&token=tok';

      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: testUrl,
            storagePath:
              'gs://content-pilot-7eb03.firebasestorage.app/thumbnails/113959899989339493619/1766719112553_0.png',
          },
        ]);

      const kanbanData = {
        ideas: {
          card1: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: testUrl, bgImages: [testUrl] }],
              bgImage: testUrl,
              bgImages: [testUrl],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData.ideas : null) })
        );
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockUpdate = jest.fn().mockResolvedValue(true);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('113959899989339493619'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        get: mockGet,
        remove: mockRemove,
        update: mockUpdate,
        markDeletedThumbnail: jest.fn().mockResolvedValue(true),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'force_remove_url_references',
        data: { url: testUrl, dryRun: true },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      // sendResponse captured result via handleAsync - find last call
      const lastCall = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastCall && lastCall.success).toBe(true);
      expect(lastCall.planned).toBeTruthy();
      expect(lastCall.planned.thumbnailIds.length).toBeGreaterThanOrEqual(1);
      expect(lastCall.planned.kanbanUpdates.length).toBeGreaterThanOrEqual(1);
    });

    test('delete_storage_image_by_url clears and removes empty bgImages arrays', async () => {
      const downloadUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2F113959899989339493619%2F1766719112553_0.png?alt=media&token=tok';

      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: downloadUrl,
            storagePath:
              'gs://content-pilot-7eb03.appspot.com/thumbnails/113959899989339493619/1766719112553_0.png',
          },
        ]);

      const kanbanData = {
        ideas: {
          card1: {
            publishInfo: {
              bgImages: [downloadUrl],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData.ideas : null) })
        );
      const mockUpdate = jest.fn().mockResolvedValue(true);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('113959899989339493619'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        get: mockGet,
        update: mockUpdate,
        markDeletedThumbnail: jest.fn().mockResolvedValue(true),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image_by_url', data: { url: downloadUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      // update should be called to remove the publishInfo.bgImages field (one of the updates should remove the bgImages field)
      const updateCalls = mockUpdate.mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
      const hadDeletedBgImages = updateCalls.some((c) => {
        const upd = c[1];
        return (
          upd &&
          upd.publishInfo &&
          !Object.prototype.hasOwnProperty.call(upd.publishInfo, 'bgImages')
        );
      });
      expect(hadDeletedBgImages).toBe(true);
    });

    test('force_remove_url_references sends immediate ACK and delivers final result to sender tab', async () => {
      const testUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/thumbnails%2F113959899989339493619%2F1766719112553_0.png?alt=media&token=tok';

      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: testUrl,
            storagePath:
              'gs://content-pilot-7eb03.firebasestorage.app/thumbnails/113959899989339493619/1766719112553_0.png',
          },
        ]);

      const kanbanData = {
        ideas: {
          card1: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: testUrl, bgImages: [testUrl] }],
              bgImage: testUrl,
              bgImages: [testUrl],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData.ideas : null) })
        );
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);

      // mock tabs sendMessage to capture final result
      chrome.tabs = { sendMessage: jest.fn((tabId, msg, cb) => cb && cb()) };

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('113959899989339493619'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        get: mockGet,
        update: mockUpdate,
        remove: mockRemove,
        markDeletedThumbnail: jest.fn().mockResolvedValue(true),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'force_remove_url_references',
        data: { url: testUrl, dryRun: false },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, { tab: { id: 987 } }, sendResponse);

      // handler returns true and should have sent immediate ACK
      expect(ret).toBe(true);
      expect(sendResponse).toHaveBeenCalled();
      const firstCall = sendResponse.mock.calls[0][0];
      expect(firstCall && firstCall.success).toBe('accepted');
      expect(firstCall && firstCall.requestId).toBeTruthy();

      // wait for async work to finish
      await new Promise((r) => setTimeout(r, 0));

      // verify final result delivered to tab
      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
        987,
        expect.objectContaining({
          action: 'force_remove_url_references_result',
          requestId: expect.any(String),
        }),
        expect.any(Function)
      );
      // final sendResponse attempt should also have been made (last call)
      const lastCall = sendResponse.mock.calls.slice(-1)[0][0];
      expect(
        lastCall && (lastCall.success === true || lastCall.success === false || lastCall.requestId)
      ).toBeTruthy();
    });

    test('force_remove_url_references executes removals when dryRun=false', async () => {
      const testUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/thumbnails%2F113959899989339493619%2F1766719112553_0.png?alt=media&token=tok';

      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: testUrl,
            storagePath:
              'gs://content-pilot-7eb03.firebasestorage.app/thumbnails/113959899989339493619/1766719112553_0.png',
          },
        ]);

      const kanbanData = {
        ideas: {
          card1: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: testUrl, bgImages: [testUrl] }],
              bgImage: testUrl,
              bgImages: [testUrl],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData.ideas : null) })
        );
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockDeleteImage = jest.fn().mockResolvedValue(true);
      const mockMarkDeleted = jest.fn().mockResolvedValue(true);

      // Add wrapper to track calls
      const mockRemoveWrapper = jest.fn(async (...args) => {
        // eslint-disable-next-line no-console
        console.log('[TEST] mockRemove called with:', args);
        return mockRemove(...args);
      });

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('113959899989339493619'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        get: mockGet,
        remove: mockRemoveWrapper,
        ref: (db, path) => path, // mock ref to return path directly
        update: mockUpdate,
        deleteImageFromStorage: mockDeleteImage,
        markDeletedThumbnail: mockMarkDeleted,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'force_remove_url_references',
        data: { url: testUrl, dryRun: false },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      // wait for immediate ACK + handler to compute planned removals
      await new Promise((r) => setTimeout(r, 100));

      const lastCall = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastCall && lastCall.success).toBe(true);
      // planned should be returned by the handler
      expect(lastCall.planned).toBeTruthy();
      expect(lastCall.planned.thumbnailIds.length).toBeGreaterThanOrEqual(1);

      // allow execution of removals to proceed - increased wait
      await new Promise((r) => setTimeout(r, 200));

      // debug: output planned removals
      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] force_remove executed planned:', JSON.stringify(lastCall.planned));
      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] mockDeleteImage calls:', mockDeleteImage.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] mockMarkDeleted calls:', mockMarkDeleted.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] mockRemove calls:', mockRemove.mock.calls.length);
      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] mockRemoveWrapper calls:', mockRemoveWrapper.mock.calls.length);

      expect(mockDeleteImage).toHaveBeenCalled();
      expect(mockMarkDeleted).toHaveBeenCalled();
      expect(mockRemoveWrapper).toHaveBeenCalled();
    });

    test('delete_storage_image_by_url deletes when metadata found', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: 'https://example.com/img.png',
            storagePath: 'gs://bucket/path.png',
          },
        ]);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        markDeletedThumbnail: jest.fn(),
        isThumbnailDeleted: jest.fn().mockResolvedValue(false),
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'delete_storage_image_by_url',
        data: { url: 'https://example.com/img.png' },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockDelete).toHaveBeenCalledWith('gs://bucket/path.png');
      expect(mockRemove).toHaveBeenCalled();
    });

    test('delete_storage_image_by_url parses firebase download URL and deletes when no metadata', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest.fn().mockResolvedValue([]);
      const mockMarkDeleted = jest.fn();

      // URL with encoded object path
      const dlUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        markDeletedThumbnail: mockMarkDeleted,
        isThumbnailDeleted: jest.fn().mockResolvedValue(false),
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image_by_url', data: { url: dlUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockDelete).toHaveBeenCalled();
      expect(mockMarkDeleted).toHaveBeenCalled();
    });
    test('delete_storage_image_by_url clears publishInfo thumbnail refs in kanban cards', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const storagePath = 'gs://content-pilot-7eb03.appspot.com/thumbnails/user/gen-1.png';
      const downloadUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';
      const mockGetUploaded = jest.fn().mockResolvedValue([]);

      // kanban entries containing publishInfo with thumbnailInfo referencing the URL
      const mockKanban = {
        ideas: {
          card1: {
            publishInfo: { thumbnailInfo: [{ bgImage: downloadUrl }], bgImages: [downloadUrl] },
          },
          card2: {
            publishInfo: { thumbnailInfo: [{ bgImage: downloadUrl }], bgImages: [downloadUrl] },
          },
        },
      };

      const mockGet = jest.fn().mockImplementation((path) => {
        const parts = path.split('/');
        if (path === `kanban/test-user/ideas`)
          return Promise.resolve({ val: () => mockKanban.ideas });
        return Promise.resolve({ val: () => null });
      });

      const mockUpdate = jest.fn().mockResolvedValue(true);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
        get: mockGet,
        update: mockUpdate,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image_by_url', data: { url: downloadUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockUpdate).toHaveBeenCalled();
      // ensure both cards were updated
      expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    test('delete_storage_image_by_url clears publishInfo for encoded / filename variants', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const downloadUrlWithToken =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';
      const downloadUrlNoToken =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media';
      const filenameOnly = 'gen-1.png';
      const mockGetUploaded = jest.fn().mockResolvedValue([]);

      const mockKanban = {
        ideas: {
          card1: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: downloadUrlWithToken }],
              bgImages: [downloadUrlWithToken],
            },
          },
          card2: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: downloadUrlNoToken }],
              bgImages: [downloadUrlNoToken],
            },
          },
          card3: {
            publishInfo: { thumbnailInfo: [{ bgImage: filenameOnly }], bgImages: [filenameOnly] },
          },
        },
      };

      const mockGet = jest.fn().mockImplementation((path) => {
        const parts = path.split('/');
        if (path === `kanban/test-user/ideas`)
          return Promise.resolve({ val: () => mockKanban.ideas });
        return Promise.resolve({ val: () => null });
      });
      const mockUpdate = jest.fn().mockResolvedValue(true);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
        get: mockGet,
        update: mockUpdate,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = {
        action: 'delete_storage_image_by_url',
        data: { url: downloadUrlWithToken },
      };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      // Should have updated all three cards (token variant, no-token variant, filename match)
      expect(mockUpdate).toHaveBeenCalled();
      expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
    test('delete_storage_image_by_url removes multiple metadata entries for parsed path', async () => {
      const mockDelete = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);
      const storagePath = 'gs://content-pilot-7eb03.appspot.com/thumbnails/user/gen-1.png';
      const downloadUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';
      const mockGetUploaded = jest.fn().mockResolvedValue([
        { id: 'a', downloadURL: downloadUrl, storagePath },
        { id: 'b', downloadURL: downloadUrl, storagePath },
      ]);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        deleteImageFromStorage: mockDelete,
        remove: mockRemove,
        ref: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        firebaseConfig: { storageBucket: 'content-pilot-7eb03.appspot.com' },
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'delete_storage_image_by_url', data: { url: downloadUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockDelete).toHaveBeenCalledWith(storagePath);
      expect(mockRemove).toHaveBeenCalledTimes(2);
    });

    test.skip('is_thumbnail_deleted returns tombstone status', async () => {
      const mockIsDeleted = jest.fn().mockResolvedValue(true);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        isThumbnailDeleted: mockIsDeleted,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const downloadUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/thumbnails%2Fuser%2Fgen-1.png?alt=media&token=abc';
      const message = { action: 'is_thumbnail_deleted', data: { url: downloadUrl } };
      const sendResponse = jest.fn();
      runtimeHandler(message, {}, sendResponse);
      // handleAsync returns undefined; wait for final response
      await new Promise((r) => setTimeout(r, 100));

      // eslint-disable-next-line no-console
      console.log('[TEST DEBUG] is_thumbnail_deleted sendResponse calls:', JSON.stringify(sendResponse.mock.calls, null, 2));

      expect(sendResponse).toHaveBeenCalled();
      const last = sendResponse.mock.calls.slice(-1)[0]?.[0];
      expect(last).toBeTruthy();
      expect(last.success).toBe(true);
      expect(last.deleted).toBe(true);
      expect(mockIsDeleted).toHaveBeenCalled();
    });

    test('find_url_references finds URL in thumbnail_images and kanban', async () => {
      const testUrl =
        'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.firebasestorage.app/o/thumbnails%2F113959899989339493619%2F1766714193282_0.png?alt=media&token=tok';

      const mockGetUploaded = jest
        .fn()
        .mockResolvedValue([
          {
            id: 'img1',
            downloadURL: testUrl,
            storagePath:
              'gs://content-pilot-7eb03.firebasestorage.app/thumbnails/113959899989339493619/1766714193282_0.png',
          },
        ]);

      const kanbanData = {
        card1: {
          publishInfo: {
            thumbnailInfo: [{ bgImage: testUrl, bgImages: [testUrl] }],
            bgImage: testUrl,
            bgImages: [testUrl],
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData : null) })
        );

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: mockGetUnifiedGalleryImages,
        getCurrentUserId: jest.fn().mockResolvedValue('113959899989339493619'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        getUploadedImagesLog: mockGetUploaded,
        get: mockGet,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'find_url_references', data: { url: testUrl } };
      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      // Verify the response captured a thumbnail_images entry and kanban references
      expect(sendResponse).toHaveBeenCalled();
      const lastResp = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastResp && lastResp.success).toBe(true);
      expect(lastResp.results.thumbnailImages.length).toBe(1);
      expect(lastResp.results.kanban.length).toBeGreaterThanOrEqual(1);
    });

    test('mark_thumbnail_used marks metadata for matching storage url', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest.fn().mockResolvedValue([
        { id: '123', downloadURL: 'https://storage.googleapis.com/bucket/o/path.png', storagePath: 'gs://bucket/path' },
      ]);

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUploadedImagesLog: mockGetUploaded,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        update: mockUpdate,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'mark_thumbnail_used', data: { url: 'https://storage.googleapis.com/bucket/o/path.png', cardId: 'card-1' } };
      const sendResponse = jest.fn();
      runtimeHandler(message, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      const last = sendResponse.mock.calls.slice(-1)[0][0];
      expect(last && last.success).toBe(true);
      expect(last.updatedId).toBe('123');
      expect(mockUpdate).toHaveBeenCalled();
    });

    test('mark_thumbnail_used updates card publishInfo.thumbnailInfo when matching', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest.fn().mockResolvedValue([
        { id: '123', downloadURL: 'https://storage.googleapis.com/bucket/o/path.png', storagePath: 'gs://bucket/path' },
      ]);

      // Mock kanban get to return a card under 'ideas' with thumbnailInfo matching the downloadURL
      const kanbanData = {
        ideas: {
          'card-1': {
            publishInfo: {
              thumbnailInfo: [
                { bgImage: 'https://storage.googleapis.com/bucket/o/path.png' },
                { bgImage: 'https://other.example/x.png' },
              ],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData : null) })
        );

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUploadedImagesLog: mockGetUploaded,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        update: mockUpdate,
        get: mockGet,
        ref: (db, path) => path,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'mark_thumbnail_used', data: { url: 'https://storage.googleapis.com/bucket/o/path.png', cardId: 'card-1' } };
      const sendResponse = jest.fn();
      runtimeHandler(message, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      const last = sendResponse.mock.calls.slice(-1)[0][0];
      expect(last && last.success).toBe(true);
      // expect update was called for thumbnail_images and for kanban publishInfo
      expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(2);
      const calls = mockUpdate.mock.calls;
      const kanbanCall = calls.find((c) => String(c[0]).includes('kanban/test-user/ideas/card-1'));
      expect(kanbanCall).toBeTruthy();
      const updatedPublishInfo = kanbanCall && kanbanCall[1] && kanbanCall[1].publishInfo ? kanbanCall[1].publishInfo : null;
      expect(updatedPublishInfo).toBeTruthy();
      expect(Array.isArray(updatedPublishInfo.thumbnailInfo)).toBe(true);
      const updatedFirst = updatedPublishInfo.thumbnailInfo[0];
      expect(updatedFirst.usedInDraft).toBe(true);
      expect(updatedFirst.usedInDraftAt).toBeTruthy();
      expect(updatedFirst.usedInDraftCardId).toBe('card-1');
    });

    test('mark_thumbnail_used updates card publishInfo.thumbnailInfo when upload log missing (fallback)', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockGetUploaded = jest.fn().mockResolvedValue([]); // upload log missing

      // Kanban contains card with thumbnailInfo that matches the provided URL
      const kanbanData = {
        ideas: {
          'card-1': {
            publishInfo: {
              thumbnailInfo: [
                { bgImage: 'https://storage.googleapis.com/bucket/o/path.png' },
              ],
            },
          },
        },
      };

      const mockGet = jest
        .fn()
        .mockImplementation((path) =>
          Promise.resolve({ val: () => (path.startsWith('kanban/') ? kanbanData : null) })
        );

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUploadedImagesLog: mockGetUploaded,
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        update: mockUpdate,
        get: mockGet,
        ref: (db, path) => path,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const message = { action: 'mark_thumbnail_used', data: { url: 'https://storage.googleapis.com/bucket/o/path.png', cardId: 'card-1' } };
      const sendResponse = jest.fn();
      runtimeHandler(message, {}, sendResponse);
      await new Promise((r) => setTimeout(r, 50));

      const last = sendResponse.mock.calls.slice(-1)[0][0];
      expect(last && last.success).toBe(true);
      // expect update was called at least once (for kanban publishInfo)
      expect(mockUpdate.mock.calls.length).toBeGreaterThanOrEqual(1);
      const calls = mockUpdate.mock.calls;
      const kanbanCall = calls.find((c) => String(c[0]).includes('kanban/test-user/ideas/card-1'));
      expect(kanbanCall).toBeTruthy();
      const updatedPublishInfo = kanbanCall && kanbanCall[1] && kanbanCall[1].publishInfo ? kanbanCall[1].publishInfo : null;
      expect(updatedPublishInfo).toBeTruthy();
      expect(Array.isArray(updatedPublishInfo.thumbnailInfo)).toBe(true);
      const updatedFirst = updatedPublishInfo.thumbnailInfo[0];
      expect(updatedFirst.usedInDraft).toBe(true);
      expect(updatedFirst.usedInDraftAt).toBeTruthy();
      expect(updatedFirst.usedInDraftCardId).toBe('card-1');
    });

    test('update_kanban_card normalizes thumbnailInfo bgImage to selected index', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn().mockReturnValue('kanbanRef');

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        update: mockUpdate,
        ref: mockRef,
        cleanDataForFirebase: jest.fn((d) => d),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const url = 'https://images.test/gen.png';
      const message = {
        action: 'update_kanban_card',
        data: {
          cardId: 'card1',
          status: 'ideas',
          updates: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: url }, { bgImage: url }, { bgImage: url }],
              selectedThumbnailIndex: 1,
            },
          },
        },
      };

      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockUpdate).toHaveBeenCalled();
      const passedUpdates = mockUpdate.mock.calls[0][1];
      expect(Array.isArray(passedUpdates.publishInfo.thumbnailInfo)).toBe(true);
      expect(passedUpdates.publishInfo.thumbnailInfo[0].bgImage).toBeNull();
      expect(passedUpdates.publishInfo.thumbnailInfo[1].bgImage).toBe(url);
      expect(passedUpdates.publishInfo.thumbnailInfo[2].bgImage).toBeNull();
    });

    test('update_kanban_card strips tombstoned thumbnail urls from publishInfo', async () => {
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn().mockReturnValue('kanbanRef');

      const mockIsDeleted = jest.fn().mockResolvedValue(true); // any queried path is considered deleted

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        update: mockUpdate,
        ref: mockRef,
        cleanDataForFirebase: jest.fn((d) => d),
        isThumbnailDeleted: mockIsDeleted,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls.slice(-1)[0][0];

      const url = 'https://firebasestorage.googleapis.com/v0/b/content-pilot-7eb03.appspot.com/o/thumbnails%2Fuser%2Fgen.png?alt=media&token=abc';
      const message = {
        action: 'update_kanban_card',
        data: {
          cardId: 'card1',
          status: 'ideas',
          updates: {
            publishInfo: {
              thumbnailInfo: [{ bgImage: url }, { bgImage: url }],
              selectedThumbnailIndex: 0,
              bgImage: url,
              bgImages: [url],
              thumbnailUrls: { url_16x9: url },
            },
          },
        },
      };

      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockUpdate).toHaveBeenCalled();
      const passed = mockUpdate.mock.calls[0][1];
      const pub = passed && passed.publishInfo ? passed.publishInfo : {};
      expect(pub.bgImage).toBeUndefined();
      expect(pub.bgImages).toBeUndefined();
      expect(pub.thumbnailInfo && pub.thumbnailInfo[0] && pub.thumbnailInfo[0].bgImage).toBeUndefined();
      expect(pub.thumbnailUrls && pub.thumbnailUrls.url_16x9).toBeUndefined();
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
      jest.resetModules();
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

      const lastResp = sendResponse.mock.calls.slice(-1)[0][0];
      expect(lastResp).toEqual(expect.objectContaining({ success: true, userId: mockedUserId }));
    });
  });

  describe('add_image_to_scrap handler', () => {
    test('should add image to allImages and set image if missing', async () => {
      const mockGet = jest
        .fn()
        .mockResolvedValue({ exists: () => true, val: () => ({ allImages: [], image: null }) });
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn();

      jest.resetModules();
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        uploadImageToFirebaseStorage: jest.fn(),
        cleanDataForFirebase: jest.fn((d) => d),
        get: mockGet,
        update: mockUpdate,
        ref: mockRef,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'add_image_to_scrap',
        data: { scrapId: 'scrap-1', imageUrl: 'https://example.test/new.jpg' },
      };

      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      // should be async
      expect(ret).toBe(true);

      await new Promise((r) => setTimeout(r, 0));

      expect(mockGet).toHaveBeenCalled();
      expect(mockUpdate).toHaveBeenCalledWith(mockRef(), {
        allImages: ['https://example.test/new.jpg'],
        image: 'https://example.test/new.jpg',
      });
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, allImages: expect.any(Array) })
      );
    });

    test('should return duplicate when image already exists and avoid update', async () => {
      const mockGet = jest.fn().mockResolvedValue({
        exists: () => true,
        val: () => ({
          allImages: ['https://example.test/new.jpg'],
          image: 'https://example.test/new.jpg',
        }),
      });
      const mockUpdate = jest.fn().mockResolvedValue(true);
      const mockRef = jest.fn();

      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        uploadImageToFirebaseStorage: jest.fn(),
        cleanDataForFirebase: jest.fn((d) => d),
        get: mockGet,
        update: mockUpdate,
        ref: mockRef,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'add_image_to_scrap',
        data: { scrapId: 'scrap-1', imageUrl: 'https://example.test/new.jpg' },
      };

      const sendResponse = jest.fn();
      const ret = runtimeHandler(message, {}, sendResponse);
      expect(ret).toBe(true);

      await new Promise((r) => setTimeout(r, 0));

      expect(mockGet).toHaveBeenCalled();
      // update should not be called because duplicate
      expect(mockUpdate).not.toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, duplicate: true })
      );
    });
  });

  describe('scrap_element handler', () => {
    test('should call saveScrapElement and refresh scraps when scrap saved', async () => {
      // mock scrapService functions
      const mockSave = jest.fn().mockResolvedValue({ success: true, scrapId: 'scrap-xyz' });
      const mockGetFirebaseScraps = jest.fn().mockResolvedValue({ data: [], hasMore: false });

      jest.resetModules();
      jest.doMock('../js/services/scrapService.js', () => ({
        saveScrapElement: mockSave,
        getFirebaseScraps: mockGetFirebaseScraps,
      }));

      // reload background module
      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const sendResponse = jest.fn();
      const message = { action: 'scrap_element', data: { title: 'test' }, channelId: null };
      const ret = runtimeHandler(message, {}, sendResponse);
      // should be async
      expect(ret).toBe(true);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockSave).toHaveBeenCalledWith({ title: 'test' }, null);
      expect(mockGetFirebaseScraps).toHaveBeenCalledWith(null);
      // verify tabs query broadcast - simulate tabs.query being called (mocked earlier)
      expect(chrome.tabs.query).toHaveBeenCalled();
    });
  });

  describe('AI handlers (generate_idea_briefing)', () => {
    test('should handle generate_idea_briefing message with top-level payload', async () => {
      const mockGenerate = jest.fn().mockResolvedValue(true);
      jest.doMock('../js/services/aiService.js', () => ({
        generateIdeaBriefing: mockGenerate,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'generate_idea_briefing',
        cardId: 'card-123',
        title: 'Example title',
        description: 'Some description',
      };

      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGenerate).toHaveBeenCalledWith(
        'card-123',
        'Example title',
        'Some description',
        undefined
      );
      const lastOk = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk).toEqual(expect.objectContaining({ success: true }));
    });

    test('should handle generate_idea_briefing message with nested data payload', async () => {
      const mockGenerate2 = jest.fn().mockResolvedValue(true);
      jest.doMock('../js/services/aiService.js', () => ({
        generateIdeaBriefing: mockGenerate2,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'generate_idea_briefing',
        data: { cardId: 'card-234', title: 'Nested title', description: 'Nested desc' },
      };

      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockGenerate2).toHaveBeenCalledWith(
        'card-234',
        'Nested title',
        'Nested desc',
        undefined
      );
      const lastOk2 = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk2).toEqual(expect.objectContaining({ success: true }));
    });

    test('should handle retry_idea_briefing by queuing DB state and scheduling generateIdeaBriefing', async () => {
      // Mock firebase get/update and current user
      const mockGet = jest.fn().mockResolvedValue({
        val: () => ({ title: 'Retry Title', description: 'Retry Desc' }),
        exists: () => true,
      });
      const mockUpdate = jest.fn().mockResolvedValue(true);

      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        uploadImageToFirebaseStorage: jest.fn(),
        cleanDataForFirebase: jest.fn(),
        get: mockGet,
        update: mockUpdate,
        ref: jest.fn(),
        serverTimestamp: jest.fn(() => 'SERVER_TS'),
      }));

      // mock generateIdeaBriefing scheduling
      const mockGen = jest.fn().mockResolvedValue(true);
      jest.doMock('../js/services/aiService.js', () => ({ generateIdeaBriefing: mockGen }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'retry_idea_briefing',
        data: { cardId: 'card-999', status: 'ideas' },
      };
      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      // DB update should be called to mark queued state
      expect(mockUpdate).toHaveBeenCalled();
      // scheduled generator should have been called with correct title/desc
      expect(mockGen).toHaveBeenCalledWith('card-999', 'Retry Title', 'Retry Desc', {
        status: 'ideas',
      });
      const lastOk3 = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk3).toEqual(expect.objectContaining({ success: true }));
    });
  });

  describe('collector handlers (fetch_all_channel_data / refresh_channel_data / fetch_and_save_single_post / delete_channel)', () => {
    test('should handle fetch_all_channel_data via fetchAllChannelData', async () => {
      const mockFetchAll = jest.fn().mockResolvedValue({ success: true, count: 3 });
      jest.doMock('../js/services/collectorService.js', () => ({
        fetchAllChannelData: mockFetchAll,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = { action: 'fetch_all_channel_data' };
      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockFetchAll).toHaveBeenCalled();
      const lastOk = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk).toEqual(expect.objectContaining({ success: true, count: 3 }));
    });

    test('should handle refresh_channel_data with source and platform', async () => {
      const mockRefresh = jest.fn().mockResolvedValue({ success: true, refreshed: 1 });
      jest.doMock('../js/services/collectorService.js', () => ({
        refreshChannelData: mockRefresh,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = { action: 'refresh_channel_data', sourceId: 'source-x', platform: 'blogs' };
      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockRefresh).toHaveBeenCalledWith('source-x', 'blogs');
      const lastOk = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk).toEqual(expect.objectContaining({ success: true, refreshed: 1 }));
    });

    test('should handle fetch_and_save_single_post with url and ids', async () => {
      const mockFetchSave = jest.fn().mockResolvedValue({ success: true, saved: true });
      jest.doMock('../js/services/collectorService.js', () => ({
        fetchAndSaveSinglePost: mockFetchSave,
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'fetch_and_save_single_post',
        url: 'https://example.com/post',
        channelId: 'chan1',
        sourceId: 'source1',
      };

      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      expect(mockFetchSave).toHaveBeenCalledWith('https://example.com/post', 'chan1', 'source1');
      const lastOk = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk).toEqual(expect.objectContaining({ success: true, saved: true }));
    });

    test('delete_channel should reject when user is default_user (not authenticated)', async () => {
      // mock getCurrentUserId to return default_user to exercise unauthorized branch
      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('default_user'),
        getDb: jest.fn(),
        CONSTANTS: { USER_ID: 'default_user' },
        initializeFirebase: jest.fn(),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = { action: 'delete_channel', id: 'ch-1', url: 'https://channel' };
      await runtimeHandler(message, {}, mockSendResponse);
      await new Promise((r) => setTimeout(r, 0));

      const lastErr2 = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastErr2).toEqual(
        expect.objectContaining({ success: false, error: '로그인이 필요합니다.' })
      );
    });

    test('delete_draft_and_publish_info treats nulls as removed and does not retry', async () => {
      // Prepare card data: initial card contains draftContent + publishInfo
      const cardInitial = {
        draftContent: 'some content',
        publishInfo: { seoTitle: 'S', thumbnailInfo: {} },
        seoTitle: 'S',
        workspace: { draft: 'workspace draft' },
      };

      // After set, the verify GET will return a record where fields are null (should be treated as removed)
      const verifyDataWithNulls = {
        draftContent: null,
        publishInfo: null,
        seoTitle: null,
        workspace: { draft: null },
      };

      // Mock get to return initial then verification data
      const mockGet = jest
        .fn()
        .mockResolvedValueOnce({ val: () => cardInitial })
        .mockResolvedValueOnce({ val: () => verifyDataWithNulls })
        .mockResolvedValueOnce({ val: () => verifyDataWithNulls });

      const mockSet = jest.fn().mockResolvedValue(true);
      const mockRemove = jest.fn().mockResolvedValue(true);

      jest.doMock('../js/services/firebaseService.js', () => ({
        getUnifiedGalleryImages: jest.fn(),
        getCurrentUserId: jest.fn().mockResolvedValue('test-user'),
        getDb: jest.fn(),
        initializeFirebase: jest.fn(),
        uploadImageToFirebaseStorage: jest.fn(),
        cleanDataForFirebase: (d) => d,
        get: mockGet,
        set: mockSet,
        remove: mockRemove,
        ref: jest.fn(),
        serverTimestamp: jest.fn(),
      }));

      await import('../background.js');
      const runtimeHandler = chrome.runtime.onMessage.addListener.mock.calls[0][0];

      const message = {
        action: 'delete_draft_and_publish_info',
        data: { ideaId: 'card-123', status: 'ideas' },
      };

      await runtimeHandler(message, {}, mockSendResponse);
      // wait for async verification + UI broadcast (handler uses a small setTimeout(300) when verifying)
      await new Promise((r) => setTimeout(r, 700));

      // set should be called only once (no retry needed when fields are null)
      expect(mockSet).toHaveBeenCalledTimes(1);

      // response should indicate success
      const lastOk = mockSendResponse.mock.calls.slice(-1)[0][0];
      expect(lastOk).toEqual(expect.objectContaining({ success: true, moved: false }));
    });
  });
});
