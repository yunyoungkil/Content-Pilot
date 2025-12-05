import { jest } from '@jest/globals';

// Mock firebaseService helper functions
jest.mock('../js/services/firebaseService.js', () => ({
  getCurrentUserId: jest.fn(),
  getDb: jest.fn(),
  ref: jest.fn((db, path) => path),
  get: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
}));

// Mock performance optimizer to call through
jest.mock('../js/services/performanceOptimizer.js', () => ({
  performanceOptimizer: {
    getCachedData: jest.fn(async (k, cb) => cb()),
  },
}));

import {
  updateUrlIndex,
  checkDuplicateUrl,
  normalizeUrlForComparison,
} from '../js/services/collectorService.js';

describe('Collector Service - risky-area tests (indexing & duplicate checks)', () => {
  const fb = require('../js/services/firebaseService.js');

  beforeEach(() => {
    jest.clearAllMocks();
    fb.getCurrentUserId.mockResolvedValue('test-user');
  });

  test('updateUrlIndex updates origin and published index paths when present', async () => {
    fb.update.mockResolvedValue();

    await updateUrlIndex('cardX', 'done', 'https://example.com/orig', 'https://example.com/pub');

    expect(fb.update).toHaveBeenCalled();
    const calledPaths = fb.update.mock.calls.map((c) => c[0]);
    expect(calledPaths.some((p) => p.includes('url_index/test-user'))).toBe(true);
  });

  test('checkDuplicateUrl returns exists=true when index points to existing card', async () => {
    // index snapshot returns a mapping for origin -> card1 with status 'todo'
    fb.get.mockImplementation(async (path) => {
      if (path.startsWith('url_index/')) {
        return { exists: () => true, val: () => ({ origin: { card1: { status: 'todo' } } }) };
      }
      if (path.startsWith('kanban/')) {
        return { exists: () => true, val: () => ({ title: 'Card Title' }) };
      }
      return { exists: () => false, val: () => null };
    });

    const resp = await checkDuplicateUrl('https://example.com/a');

    expect(resp.exists).toBe(true);
    expect(resp.cardId).toBe('card1');
    expect(resp.title).toBe('Card Title');
  });

  test('checkDuplicateUrl removes orphan index entries when card missing', async () => {
    // index present, but kanban card missing
    fb.get.mockImplementation(async (path) => {
      if (path.startsWith('url_index/')) {
        return { exists: () => true, val: () => ({ origin: { orphanCard: { status: 'done' } } }) };
      }
      if (path.includes('kanban/')) return { exists: () => false, val: () => null };
      return { exists: () => false, val: () => null };
    });

    fb.remove.mockResolvedValue();

    const resp = await checkDuplicateUrl('https://example.com/orphan');

    expect(resp.exists).toBe(false);
    // removed orphan index should have been called
    expect(fb.remove).toHaveBeenCalled();
    const removedPath = fb.remove.mock.calls[0][0];
    expect(removedPath).toContain('url_index/test-user');
  });
});
