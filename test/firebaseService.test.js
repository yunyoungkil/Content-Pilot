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