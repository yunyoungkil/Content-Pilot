import { jest } from '@jest/globals';

jest.mock('../js/services/firebaseService.js', () => ({
  get: jest.fn(),
  push: jest.fn(),
  getCurrentUserId: jest.fn(),
  ref: jest.fn(),
  getDb: jest.fn(),
  cleanDataForFirebase: jest.fn((d) => d),
}));

jest.mock('../js/services/offscreenService.js', () => ({
  parseHtmlInOffscreen: jest.fn(),
}));

import { push, getCurrentUserId } from '../js/services/firebaseService.js';
import { parseHtmlInOffscreen } from '../js/services/offscreenService.js';
import { saveScrapElement } from '../js/services/scrapService.js';

describe('saveScrapElement title extraction', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('saveScrapElement extracts title from offscreen parse', async () => {
    getCurrentUserId.mockResolvedValue('test-user');
    // return a mock ref with key
    push.mockResolvedValue({ key: 'scrap-123' });
    parseHtmlInOffscreen.mockResolvedValue({ title: 'OG Title from Offscreen' });

    const data = {
      html: '<meta property="og:title" content="OG Title from Offscreen">',
      text: 'Some text',
      url: 'http://example.com',
    };
    const res = await saveScrapElement(data, null);

    expect(res.success).toBe(true);
    expect(res.scrapData.title).toBe('OG Title from Offscreen');
    expect(push).toHaveBeenCalled();
  });

  test('saveScrapElement respects provided title if present', async () => {
    getCurrentUserId.mockResolvedValue('test-user');
    push.mockResolvedValue({ key: 'scrap-456' });
    parseHtmlInOffscreen.mockResolvedValue({ title: 'OG Title from Offscreen' });

    const data = {
      title: 'User Given Title',
      html: '<meta property="og:title" content="OG Title">',
      text: 'Some text',
    };
    const res = await saveScrapElement(data, null);

    expect(res.success).toBe(true);
    expect(res.scrapData.title).toBe('User Given Title');
  });
});
