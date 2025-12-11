import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - preserve platformType on reload when server response is missing platformType', () => {
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

  test("preserves locally-known platformType when server doesn't provide it", async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // 1) initial server state includes platformType tistory
    let savedChannels = { myChannels: { blogs: [ { id: 'ch1', inputUrl: 'https://example.tistory.com/mine', url: 'https://example.tistory.com/mine', apiUrl: 'https://example.tistory.com/rss', platformType: 'tistory' } ] } };

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

    // Add second channel and Save All (ensure normal path)
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    container.querySelector('#modal-platform-select').value = 'naver';
    container.querySelector('#modal-blog-url').value = 'https://blog.naver.com/other';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(50);
    container.querySelector('#save-all-channels-btn').click();
    await testHelpers.waitForMs(50);

    // verify payload contains tistory for existing ch1
    expect(savedChannels.myChannels.blogs.find(b => b.id === 'ch1').platformType).toBe('tistory');

    // 2) Simulate server update where platformType for ch1 is missing
    // (e.g., backend or another client saved without platformType)
    savedChannels = { myChannels: { blogs: [ { id: 'ch1', inputUrl: 'https://example.tistory.com/mine', url: 'https://example.tistory.com/mine', apiUrl: 'https://example.tistory.com/rss' } ] } };
    // trigger the channels_data_updated broadcast without re-creating the UI
    chrome.runtime.triggerMessage({ action: 'channels_data_updated', data: savedChannels });
    await testHelpers.waitForNextTick();

    // confirm myChannelsData still has platformType preserved when opening modal for ch1
    container.querySelectorAll('.edit-btn')[0].click();
    await testHelpers.waitForNextTick();
    const platformSelect = container.querySelector('#modal-platform-select');
    expect(platformSelect.value).toBe('tistory');

    // Add second channel and Save All again
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    container.querySelector('#modal-platform-select').value = 'naver';
    container.querySelector('#modal-blog-url').value = 'https://blog.naver.com/other';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(50);
    container.querySelector('#save-all-channels-btn').click();
    await testHelpers.waitForMs(50);

    // After saving, first channel should still be tistory
    expect(savedChannels.myChannels.blogs.find(b => b.inputUrl && b.inputUrl.includes('tistory')).platformType).toBe('tistory');
  });
});
