import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - login/logout/relogin duplicate prevention', () => {
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
  });

  test('relogin does not create duplicate channels', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Step 1: initial server returns no channels
    const initialBlogs = [];
    // Step 2: after save, server returns a single channel
    const existingBlog = {
      id: null, // server hasn't provided an id (legacy), apiUrl present
      inputUrl: 'https://example.blog/user',
      url: 'https://example.blog/user',
      apiUrl: 'https://example.blog/user/rss',
    };
    const derivedId = btoa(existingBlog.inputUrl.replace(/\/$/, '')).replace(/=/g, '');

    let callCount = 0;
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        callCount += 1;
        if (callCount === 1) {
          // initial load - empty
          if (callback) callback({ success: true, data: { myChannels: { blogs: initialBlogs } } });
        } else {
          // subsequent load - server has one channel
          if (callback) callback({ success: true, data: { myChannels: { blogs: [existingBlog] } } });
        }
        return;
      }
      if (message && message.action === 'save_channels_and_key') {
        // pretend save ok
        if (callback) callback({ success: true });
        return;
      }
      if (callback) callback({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Add channel via modal
    const addBtn = container.querySelector('#add-my-channel-btn');
    addBtn.click();
    await testHelpers.waitForNextTick();
    const blogUrlEl = container.querySelector('#modal-blog-url');
    blogUrlEl.value = existingBlog.inputUrl;
    const platformSelect = container.querySelector('#modal-platform-select');
    platformSelect.value = 'wordpress';
    const applyBtn = container.querySelector('#modal-apply-btn');
    applyBtn.click();
    await testHelpers.waitForMs(20);

    // After save, server returns the single channel; trigger a reload / re-login simulated by active channel update
    chrome.runtime.triggerMessage({ action: 'get_channels_and_key', data: { myChannels: { blogs: [existingBlog] } } });
    await testHelpers.waitForMs(10);

    // There should only be one channel in UI, with the deterministic ID
    expect(container.querySelectorAll('.my-channel-card').length).toBe(1);
    const calls = chrome.runtime.sendMessage.mock.calls;
    const saveCall = calls.find((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCall).toBeTruthy();
    const payload = saveCall[0].data;
    const blogs = payload.myChannels.blogs || [];
    expect(blogs.length).toBe(1);
    expect(blogs[0].id).toBe(derivedId);
  });
});
