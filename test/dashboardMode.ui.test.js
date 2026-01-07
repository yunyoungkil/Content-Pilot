import { jest } from '@jest/globals';

describe('Dashboard UI - channel loading', () => {
  beforeEach(() => {
    jest.resetModules();
    // reset sendMessage mock
    chrome.runtime.sendMessage = jest.fn();
  });

  test('replaces loading placeholder when storage.get uses callback-style API', async () => {
    // callback-style storage.get
    chrome.storage.local.get = jest.fn((key, cb) => cb({ activeChannelId: 'channel-1' }));

    // mock get_channel_content response
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_channel_content') {
        cb({
          success: true,
          data: {
            content: [
              { sourceId: btoa('https://example.com/feed'), title: 'Post 1' },
            ],
            metas: { [btoa('https://example.com/feed')]: { title: 'My Channel' } },
            channels: {
              myChannels: { blogs: [{ id: 'channel-1', inputUrl: 'My Channel', url: 'https://example.com' }] },
              competitorChannels: {},
            },
          },
        });
      } else if (typeof cb === 'function') {
        cb({});
      }
    });

    // ensure storage.onChanged exists (dashboard attaches listener)
    chrome.storage.onChanged = { addListener: jest.fn(), removeListener: jest.fn() };

    const { renderDashboard } = await import('../js/ui/dashboardMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderDashboard(container);

    // wait for async UI update (poll up to 500ms)
    let header;
    for (let i = 0; i < 50; i++) {
      header = container.querySelector('#my-channels-col .dashboard-col-header h2');
      if (header && header.textContent.includes('My Channel')) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10));
    }

    const loading = container.querySelector('#myChannels-content-list .loading-placeholder');
    expect(loading).toBeFalsy();

    expect(header).toBeTruthy();
    expect(header.textContent).toContain('My Channel');
  });

  test('works when storage.get returns a Promise (mockResolvedValue)', async () => {
    chrome.storage.local.get = jest.fn().mockResolvedValue({ activeChannelId: 'channel-1' });

    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_channel_content') {
        cb({
          success: true,
          data: {
            content: [
              { sourceId: 'abc', title: 'Post 1' },
            ],
            metas: { [btoa('https://example.com/feed')]: { title: 'My Channel' } },
            channels: {
              myChannels: { blogs: [{ id: 'channel-1', inputUrl: 'My Channel', url: 'https://example.com' }] },
              competitorChannels: {},
            },
          },
        });
      } else if (typeof cb === 'function') {
        cb({});
      }
    });

    // ensure storage.onChanged exists (dashboard attaches listener)
    chrome.storage.onChanged = { addListener: jest.fn(), removeListener: jest.fn() };

    const { renderDashboard } = await import('../js/ui/dashboardMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderDashboard(container);

    // wait for async UI update (poll up to 500ms)
    let header;
    for (let i = 0; i < 50; i++) {
      header = container.querySelector('#my-channels-col .dashboard-col-header h2');
      if (header && header.textContent.includes('My Channel')) break;
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 10));
    }

    const loading = container.querySelector('#myChannels-content-list .loading-placeholder');
    expect(loading).toBeFalsy();

    expect(header).toBeTruthy();
    expect(header.textContent).toContain('My Channel');
  });
});
