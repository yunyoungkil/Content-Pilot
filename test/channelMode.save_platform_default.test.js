import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - save defaults platformType when missing', () => {
  beforeEach(() => {
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockReset();
    jest.resetAllMocks();
  });

  test('Save All includes platformType for blogs missing it in server response', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Simulate server state: blog without platformType
    let savedChannels = { myChannels: { blogs: [ { id: 'ch1', inputUrl: 'https://example.com/mine', url: 'https://example.com/mine', apiUrl: 'https://example.com/rss' } ] } };

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        if (callback) callback({ success: true, data: savedChannels });
        return;
      }

      if (message && message.action === 'save_channels_and_key') {
        savedChannels = message.data || savedChannels;
        if (callback) callback({ success: true });
        return;
      }

      if (callback) callback({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Add second channel and Save All
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    container.querySelector('#modal-platform-select').value = 'naver';
    container.querySelector('#modal-blog-url').value = 'https://blog.naver.com/other';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(50);

    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    saveAllBtn.click();
    await testHelpers.waitForMs(50);

    // After save, ensure both channels exist and the first one has platformType default
    expect(savedChannels.myChannels.blogs.length).toBe(2);
    const first = savedChannels.myChannels.blogs.find((b) => b.inputUrl && b.inputUrl.includes('example.com'));
    const second = savedChannels.myChannels.blogs.find((b) => b.inputUrl && b.inputUrl.includes('naver'));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first.platformType).toBe('naver'); // defaulted
    expect(second.platformType).toBe('naver');
  });
});
