
import { generateIdeaBriefing } from '../js/services/aiService.js';

// Mock dependencies
jest.mock('../js/services/firebaseService.js', () => ({
  getDb: jest.fn(),
  ref: jest.fn(),
  update: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue({ val: () => ({}) }),
  getCurrentUserId: jest.fn().mockResolvedValue('test-user-id'),
  cleanDataForFirebase: jest.fn((data) => data),
  serverTimestamp: jest.fn(() => 'timestamp'),
}));

jest.mock('../js/utils.js', () => ({
  Logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    biz: jest.fn(),
  },
}));

// Mock callGeminiAPI to avoid actual network calls
jest.mock('../js/services/aiService.js', () => {
  const originalModule = jest.requireActual('../js/services/aiService.js');
  return {
    ...originalModule,
    callGeminiAPI: jest.fn().mockResolvedValue('["Mock Item 1", "Mock Item 2"]'),
  };
});

describe('generateIdeaBriefing Progress Broadcasting', () => {
  beforeEach(() => {
    // Setup global chrome mock
    global.chrome = {
      storage: {
        local: {
          get: jest.fn().mockResolvedValue({ geminiApiKey: 'test-key' }),
        },
      },
      runtime: {
        sendMessage: jest.fn().mockImplementation((msg) => Promise.resolve()),
      },
      tabs: {
        query: jest.fn().mockImplementation((query, callback) => {
          // Simulate finding one tab
          const tabs = [{ id: 123, url: 'https://example.com' }];
          if (callback) callback(tabs);
          return Promise.resolve(tabs); // Support promise if used
        }),
        sendMessage: jest.fn().mockResolvedValue(true),
      },
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('should broadcast progress to both runtime and tabs', async () => {
    const cardId = 'test-card-id';
    const title = 'Test Title';
    const description = 'Test Description';
    const options = {
      generateOutline: true, // Trigger some progress steps
    };

    await generateIdeaBriefing(cardId, title, description, options);

    // Verify runtime.sendMessage was called for progress
    expect(global.chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'kanban_card_progress_updated',
        cardId: cardId,
        progress: expect.any(Number),
      })
    );

    // Verify tabs.query was called
    expect(global.chrome.tabs.query).toHaveBeenCalled();

    // Verify tabs.sendMessage was called for progress
    // We expect multiple calls (5%, 30%, etc.)
    expect(global.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        action: 'kanban_card_progress_updated',
        cardId: cardId,
        progress: expect.any(Number),
      })
    );
  });
});
