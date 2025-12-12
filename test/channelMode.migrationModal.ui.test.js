import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - migration modal on ID click', () => {
  beforeEach(() => {
    jest.resetModules();
    // mock chrome storage and runtime
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('clicking channel ID opens migration modal', async () => {
    // Do not mock modal; test actual DOM insertion and default select behavior

    // Mock get_channels_and_key response
    const responsePayload = {
      success: true,
      data: {
        myChannels: {
          blogs: [
            {
              id: 'ch1',
              inputUrl: 'https://blog.example.com/user',
              apiUrl: 'https://blog.example.com/rss',
              platformType: 'naver',
            },
          ],
        },
      },
    };

    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') {
        cb(responsePayload);
      } else cb({ success: true });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);

    // Import module after mocking
    const module = await import('../js/ui/channelMode.js');
    module.renderChannelMode(container);

    // Wait a tick for initialization and rendering
    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    const idEl = container.querySelector('.channel-id');
    expect(idEl).toBeTruthy();

    // Click the id
    idEl.click();
    await testHelpers.waitForNextTick();

    // Modal DOM should be present and select default to channel.platformType
    const modalEl = document.querySelector('#channel-migration-modal');
    expect(modalEl).toBeTruthy();
    const selectEl = modalEl.querySelector('#migration-target-select');
    expect(selectEl).toBeTruthy();
    expect(selectEl.value).toBe('naver');
  });
});
