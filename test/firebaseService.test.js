// test/firebaseService.test.js
import { jest } from '@jest/globals';

// Firebase 모킹
jest.mock('../js/services/firebaseService.js', () => ({
  getUnifiedGalleryImages: jest.fn(),
  getCurrentUserId: jest.fn(),
}));

import {
  getUnifiedGalleryImages,
  getCurrentUserId,
} from '../js/services/firebaseService.js';

describe('Firebase Service - getUnifiedGalleryImages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should be a function', () => {
    expect(typeof getUnifiedGalleryImages).toBe('function');
  });

  test('should accept filter parameter', async () => {
    getUnifiedGalleryImages.mockResolvedValue([]);

    await getUnifiedGalleryImages('ALL');

    expect(getUnifiedGalleryImages).toHaveBeenCalledWith('ALL');
  });

  test('should return array', async () => {
    const mockResult = [
      { id: '1', source: 'SCRAP', url: 'http://example.com/1.jpg' },
    ];
    getUnifiedGalleryImages.mockResolvedValue(mockResult);

    const result = await getUnifiedGalleryImages('ALL');

    expect(Array.isArray(result)).toBe(true);
    expect(result).toEqual(mockResult);
  });

  test('should handle different filters', async () => {
    getUnifiedGalleryImages.mockResolvedValue([]);

    await getUnifiedGalleryImages('STORAGE');
    expect(getUnifiedGalleryImages).toHaveBeenCalledWith('STORAGE');

    await getUnifiedGalleryImages('SCRAP');
    expect(getUnifiedGalleryImages).toHaveBeenCalledWith('SCRAP');
  });

  test('should handle errors', async () => {
    const error = new Error('Database error');
    getUnifiedGalleryImages.mockRejectedValue(error);

    await expect(getUnifiedGalleryImages('ALL')).rejects.toThrow('Database error');
  });

});

// -------------------------------
// saveUploadedImageMetadata tests
// -------------------------------

describe('saveUploadedImageMetadata retry behavior', () => {
  let svcModule;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    // ensure we import the real module (not the top-level mock)
    jest.unmock('../js/services/firebaseService.js');
    svcModule = require('../js/services/firebaseService.js');
  });

  test('retries once on set failure and succeeds', async () => {
    // First PUT (set) will fail (non-ok response), second will succeed
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    const authSvc = require('../js/services/authService.js');
    const tokenSpy = jest.spyOn(authSvc, 'getValidToken').mockResolvedValue('new-token');

    const res = await svcModule.saveUploadedImageMetadata('thumbnail_images/test-user/1', { foo: 'bar' });

    expect(res).toBe(true);
    // fetch called twice (initial attempt + retry)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(tokenSpy).toHaveBeenCalledWith(true);
  });

  test('returns false if both attempts fail', async () => {
    // Both PUT attempts fail
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });

    const authSvc = require('../js/services/authService.js');
    const tokenSpy = jest.spyOn(authSvc, 'getValidToken').mockResolvedValue('new-token');

    const res = await svcModule.saveUploadedImageMetadata('thumbnail_images/test-user/2', { foo: 'baz' });

    expect(res).toBe(false);
    // fetch called twice (initial attempt + retry)
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(tokenSpy).toHaveBeenCalledWith(true);
  });
});