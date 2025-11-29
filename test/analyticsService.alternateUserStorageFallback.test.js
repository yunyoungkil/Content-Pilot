jest.mock('../js/services/firebaseService.js', () => ({
  CONSTANTS: { USER_ID: 'default_user' },
  getDb: jest.fn(() => ({})),
  ref: jest.fn((db, path) => path),
  get: jest.fn(async (path) => {
    if (path === 'channels/google-uid-1') {
      return { val: () => null };
    }
    if (path === 'channels/safe_user_example_com') {
      return {
        val: () => ({
          myChannels: {
            blogs: [{ inputUrl: 'https://costcatcher.k-posting.info', gaPropertyId: '464070489' }],
          },
        }),
      };
    }
    if (path.includes('kanban/google-uid-1')) {
      // simulate card performance structure
      return {
        val: () => ({
          ideas: { c1: { publishedUrl: 'https://costcatcher.k-posting.info/post/1' } },
        }),
      };
    }
    return { val: () => null };
  }),
  set: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
  getCurrentUserId: jest.fn(async () => 'google-uid-1'),
  initializeFirebase: jest.fn(() => true),
}));

jest.mock('../js/services/authService.js', () => ({
  getValidToken: jest.fn(async () => 'fake-token'),
}));

import * as analyticsService from '../js/services/analyticsService.js';
import * as firebaseService from '../js/services/firebaseService.js';

describe('analyticsService alternate storage/userId fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .spyOn(require('../js/services/authService.js'), 'getValidToken')
      .mockResolvedValue('fake-token');
  });

  test('finds channels stored under email-based user key when current userId differs', async () => {
    // simulate storage indicating googleUserEmail that maps to safe_user_example
    jest.spyOn(global.chrome.storage.local, 'get').mockImplementation(async (keys) => {
      // keys might be 'googleUserEmail' or array including it
      return { googleUserEmail: 'safe.user@example.com', adSenseAccountId: 'pub-123' };
    });

    jest
      .spyOn(analyticsService, 'getAnalyticsData')
      .mockResolvedValue({ pageviews: 5, gaEarnings: 0.4 });
    jest
      .spyOn(analyticsService, 'getAdsenseData')
      .mockResolvedValue({ estimatedEarnings: 0.3, pageViews: 5 });

    await analyticsService.updateSinglePerformanceMetric({
      id: 'c1',
      path: 'kanban/google-uid-1/ideas/c1',
      url: 'https://costcatcher.k-posting.info/post/1',
    });

    expect(firebaseService.update).toHaveBeenCalled();

    const updates = firebaseService.update.mock.calls.map((c) => c[1] || c[0]);
    // Ensure no GA4 missing error was written
    const hadGaMissingError = updates.some((u) => u && u.error === 'GA4 속성 ID 없음');
    expect(hadGaMissingError).toBe(false);
  });
});
