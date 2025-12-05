jest.mock('../js/services/firebaseService.js', () => {
  return {
    getDb: jest.fn(() => ({})),
    ref: jest.fn((db, path) => path),
    get: jest.fn(async (path) => ({ val: () => null })),
    set: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getCurrentUserId: jest.fn(async () => 'user-xyz'),
  };
});

import { fetchAllChannelData } from '../js/services/collectorService.js';
import * as firebaseService from '../js/services/firebaseService.js';

describe('collectorService dynamic userId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchAllChannelData uses getCurrentUserId when reading channels', async () => {
    await fetchAllChannelData();
    expect(firebaseService.ref).toHaveBeenCalled();
    // The first ref call should be for channels/{userId}
    const calledWith = firebaseService.ref.mock.calls[0][1];
    expect(calledWith).toBe('channels/user-xyz');
  });

  test('fetchAllChannelData broadcasts cp_data_refreshed after completion', async () => {
    // Prepare mocked channel data so promises list is non-empty and resolves
    const fakeChannels = {
      myChannels: {
        blogs: [
          { apiUrl: 'https://example.com/rss', contentLimit: 1 }
        ],
        youtubes: []
      }
    };

    // Override get() to return our fakeChannels for this test
    firebaseService.get.mockImplementation(async (path) => ({ val: () => fakeChannels }));

    // Spy on fetchRssFeed and make it resolve quickly
    const collector = require('../js/services/collectorService.js');
    const spyFetchRss = jest.spyOn(collector, 'fetchRssFeed').mockResolvedValue(undefined);

    // Ensure chrome.runtime and chrome.tabs are set up (from test setup helpers)
    const runtime = testHelpers.mockChromeRuntime();
    chrome.tabs.query.mockImplementation((opts, cb) => cb([{ id: 123 }, { id: 456 }]));

    await fetchAllChannelData();

    // Runtime should have been sent the refresh notification
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ action: 'cp_data_refreshed' });

    // Tabs.query should be called and tabs.sendMessage should have been attempted
    expect(chrome.tabs.query).toHaveBeenCalled();

    // Clean up the spy
    spyFetchRss.mockRestore();
  });
});
