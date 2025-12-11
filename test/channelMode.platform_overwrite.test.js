import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - platform overwrite regression', () => {
  beforeEach(() => {
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
    global.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    document.body.innerHTML = '';
    chrome.runtime.sendMessage.mockReset();
    global.confirm = undefined;
    jest.resetAllMocks();
  });

  test('saving channels preserves platform per channel (no cross-overwrite)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Mock messaging behavior
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      // on load, return no channels
      if (message && message.action === 'get_channels_and_key') {
        if (callback) callback({ success: true, data: { myChannels: { blogs: [] } } });
        return;
      }
      // capture save
      if (message && message.action === 'save_channels_and_key') {
        // simulate success
        if (callback) callback({ success: true });
        return;
      }
      if (callback) callback({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Add first channel (Tistory)
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    const platformSelect = container.querySelector('#modal-platform-select');
    const blogUrlEl = container.querySelector('#modal-blog-url');
    platformSelect.value = 'tistory';
    blogUrlEl.value = 'https://example.tistory.com/mine';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(200);

    // Add second channel (Naver)
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    const platformSelect2 = container.querySelector('#modal-platform-select');
    const blogUrlEl2 = container.querySelector('#modal-blog-url');
    platformSelect2.value = 'naver';
    blogUrlEl2.value = 'https://blog.naver.com/other';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(200);

    // Click save all channels
    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    saveAllBtn.click();
    await testHelpers.waitForMs(200);

    // Find the save_channels_and_key call payload
    const calls = chrome.runtime.sendMessage.mock.calls;
    const saveCalls = calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    const saveCall = saveCalls.pop();
    expect(saveCall).toBeTruthy();
    const payload = saveCall[0].data;
    expect(payload).toBeTruthy();
    expect(payload.myChannels).toBeTruthy();
    const blogs = payload.myChannels.blogs;
    expect(blogs && blogs.length).toBe(2);

    // The first channel (index 0) platform should remain 'tistory'
    expect(blogs[0].platformType).toBe('tistory');
    // The second channel (index 1) platform should be 'naver'
    expect(blogs[1].platformType).toBe('naver');
  });

  test('preserve platform when channels are preloaded (existing channels)', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Preload existing channels in get_channels_and_key response
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        if (callback)
          callback({
            success: true,
            data: {
              myChannels: {
                blogs: [
                  {
                    id: 'ch1',
                    inputUrl: 'https://example.tistory.com/mine',
                    apiUrl: 'https://example.tistory.com/rss',
                    platformType: 'tistory',
                  },
                  {
                    id: 'ch2',
                    inputUrl: 'https://blog.naver.com/other',
                    apiUrl: 'https://rss.blog.naver.com/other.xml',
                    platformType: 'naver',
                  },
                ],
              },
            },
          });
        return;
      }
      if (message && message.action === 'save_channels_and_key') {
        if (callback) callback({ success: true });
        return;
      }
      if (callback) callback({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Edit channel 1: open detail, change nothing or adjust to tistory again
    const firstEditBtn = container.querySelector('#my-channel-list .my-channel-card .edit-btn');
    if (firstEditBtn) firstEditBtn.click();
    await testHelpers.waitForNextTick();
    const blogUrlEl = container.querySelector('#modal-blog-url');
    const platformSelect = container.querySelector('#modal-platform-select');
    platformSelect.value = 'tistory';
    blogUrlEl.value = 'https://example.tistory.com/mine';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(200);

    // Edit channel 2: ensure platform remains 'naver' after saving all
    const allBtn = container.querySelector('#save-all-channels-btn');
    allBtn.click();
    await testHelpers.waitForMs(200);

    const saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    const saveCall = saveCalls.pop();
    expect(saveCall).toBeTruthy();
    const payload = saveCall[0].data;
    const blogs = payload.myChannels.blogs;
    expect(blogs && blogs.length).toBe(2);
    expect(blogs.find((b) => b.id === 'ch1').platformType).toBe('tistory');
    expect(blogs.find((b) => b.id === 'ch2').platformType).toBe('naver');
  });
});
