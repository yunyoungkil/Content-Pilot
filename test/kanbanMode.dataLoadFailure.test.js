import { jest } from '@jest/globals';

describe('Kanban data load retry behavior', () => {
  beforeEach(() => {
    jest.resetModules();
    // Support both callback-style and promise-style usage
    chrome.storage.local.get = jest.fn((keys, cb) => {
      const payload = { activeChannelId: 'channel-1', googleUserEmail: 'test@example.com' };
      if (typeof cb === 'function') return cb(payload);
      return Promise.resolve(payload);
    });
    // ensure storage change listeners exist
    chrome.storage.onChanged = { addListener: jest.fn(), removeListener: jest.fn() };
  });

  test('retries get_kanban_data and updates UI when initial callback is not invoked', async () => {
    jest.useFakeTimers();

    const { renderKanban } = await import('../js/ui/kanbanMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);

    const allCards = {
      ideas: {
        'card-retry-success': {
          title: 'Retry success card',
          workspace: { draft: { briefingStatus: 'done', briefingCompletedAt: Date.now() } },
        },
      },
      'in-progress': {},
      done: {},
    };

    // First sendMessage call: do not call callback (simulate lost callback)
    chrome.runtime.sendMessage.mockImplementationOnce((msg, cb) => {
      // noop - callback not invoked
    });

    // Subsequent calls: invoke callback with data
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (typeof cb === 'function') cb({ success: true, data: allCards });
    });

    // Now render (after mocking sendMessage behavior)
    renderKanban(container);

    // Advance timers to trigger the retry path (1000ms timeout in loadKanbanData)
    jest.advanceTimersByTime(1100);

    // Run any pending timers to ensure retry sendMessage executes
    jest.runOnlyPendingTimers();

    // allow promises / microtasks to flush
    await Promise.resolve();

    // sanity check: sendMessage should have been called at least twice
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThanOrEqual(2);

    const card = container.querySelector('[data-id="card-retry-success"]');
    expect(card).toBeTruthy();

    jest.useRealTimers();
  });
});
