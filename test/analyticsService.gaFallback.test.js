jest.mock('../js/services/firebaseService.js', () => ({
  CONSTANTS: { USER_ID: 'default_user' },
  getDb: jest.fn(() => ({})),
  ref: jest.fn((db, path) => path),
  get: jest.fn(async (path) => {
    if (path === 'channels/user-123') {
      return { val: () => ({ myChannels: { blogs: [{ inputUrl: 'https://blog.example.com/user', gaPropertyId: '' }] } }) };
    }
    if (path.includes('kanban/user-123')) {
      // simulate card performance structure
      return { val: () => ({ ideas: { c1: { publishedUrl: 'https://blog.example.com/post/1' } } }) };
    }
    return { val: () => null };
  }),
  set: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  getCurrentUserId: jest.fn(async () => 'user-123'),
  initializeFirebase: jest.fn(() => true),
}));

// Mock authService BEFORE importing analyticsService so getValidToken used by
// analyticsService returns a valid token during the test
jest.mock('../js/services/authService.js', () => ({
  getValidToken: jest.fn(async () => 'fake-token'),
}));

import * as analyticsService from '../js/services/analyticsService.js';
import * as firebaseService from '../js/services/firebaseService.js';

describe('analyticsService GA4 fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // mock token retrieval
    jest.spyOn(require('../js/services/authService.js'), 'getValidToken').mockResolvedValue('fake-token');
  });

  test('collects AdSense data even when GA4 ID is missing', async () => {
    // prepare storage mock - no selectedGaPropertyId
    jest.spyOn(global.chrome.storage.local, 'get').mockImplementation(async (keys) => {
      return { adSenseAccountId: 'pub-123' };
    });

    // spy on analytics functions to avoid real network calls
    jest.spyOn(analyticsService, 'getAnalyticsData').mockResolvedValue({ pageviews: 0, gaEarnings: 0 });
    jest.spyOn(analyticsService, 'getAdsenseData').mockResolvedValue({ estimatedEarnings: 0.5, pageViews: 8 });

    await analyticsService.updateSinglePerformanceMetric({ id: 'c1', path: 'kanban/user-123/ideas/c1', url: 'https://blog.example.com/post/1' });

    // Expect update called to write performance (collecting false after completion)
    expect(firebaseService.update).toHaveBeenCalled();
    // Ensure we did not early-abort with GA4 missing error
    const updates = firebaseService.update.mock.calls.map((c) => c[1] || c[0]);
    const hadGaMissingError = updates.some((u) => u && u.error === 'GA4 속성 ID 없음');
    expect(hadGaMissingError).toBe(false);
  });
});
