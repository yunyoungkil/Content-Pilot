import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - add duplicate should update existing channel', () => {
  beforeEach(() => {
    // 초기 스토리지 상태: 로그인된 상태로 가정
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

  test('adding a channel with existing URL switches to update and does not create duplicate', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const existingBlog = {
      id: 'existing-1',
      inputUrl: 'https://blog.example.com/user',
      url: 'https://blog.example.com/user',
      apiUrl: 'https://blog.example.com/atom',
      platformType: 'wordpress',
      gaPropertyId: '',
      adSenseAccountId: '',
      competitors: [],
    };

    // Custom sendMessage behavior: respond to get_channels_and_key with existing blog
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        if (callback) callback({ success: true, data: { myChannels: { blogs: [existingBlog] } } });
        return;
      }
      if (message && message.action === 'save_channels_and_key') {
        if (callback) callback({ success: true });
        return;
      }
      // default: call callback success
      if (callback) callback({ success: true });
    });

    // Render channel mode
    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Ensure initial channel is rendered
    await testHelpers.waitForMs(5);
    const channelCard = container.querySelector('.my-channel-card');
    expect(channelCard).toBeTruthy();

    // Open modal (simulate clicking add channel)
    const addBtn = container.querySelector('#add-my-channel-btn');
    expect(addBtn).toBeTruthy();
    addBtn.click();
    await testHelpers.waitForNextTick();

    const blogUrlEl = container.querySelector('#modal-blog-url');
    expect(blogUrlEl).toBeTruthy();
    // Input same URL but with trailing slash to test normalization
    blogUrlEl.value = 'https://blog.example.com/user/';

    // Click apply
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();

    // wait for async saveChannelsToFirebase -> chrome.runtime.sendMessage
    await testHelpers.waitForMs(20);

    // Assert that save_channels_and_key message was sent with only one blog and preserved id
    const calls = chrome.runtime.sendMessage.mock.calls;
    const saveCall = calls.find((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCall).toBeTruthy();
    const payload = saveCall[0].data;
    expect(payload).toBeTruthy();
    const blogs = payload.myChannels.blogs || [];
    expect(blogs.length).toBe(1);
    expect(blogs[0].id).toBe(existingBlog.id);
  });

  test('existing channel without id uses derived deterministic id when updated', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const existingBlog = {
      // id missing
      inputUrl: 'https://blog.example.com/user',
      url: 'https://blog.example.com/user',
      apiUrl: 'https://blog.example.com/atom',
      platformType: 'wordpress',
      gaPropertyId: '',
      adSenseAccountId: '',
      competitors: [],
    };

    const derivedId = btoa(existingBlog.inputUrl.replace(/\/$/, '')).replace(/=/g, '');

    // Custom sendMessage behavior: respond to get_channels_and_key with existing blog
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        if (callback) callback({ success: true, data: { myChannels: { blogs: [existingBlog] } } });
        return;
      }
      if (message && message.action === 'save_channels_and_key') {
        if (callback) callback({ success: true });
        return;
      }
      if (callback) callback({ success: true });
    });

    // Render channel mode
    renderChannelMode(container);
    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(5);

    const addBtn = container.querySelector('#add-my-channel-btn');
    addBtn.click();
    await testHelpers.waitForNextTick();

    const blogUrlEl = container.querySelector('#modal-blog-url');
    blogUrlEl.value = 'https://blog.example.com/user';

    const applyBtn = container.querySelector('#modal-apply-btn');
    applyBtn.click();
    await testHelpers.waitForMs(20);

    const calls = chrome.runtime.sendMessage.mock.calls;
    const saveCall = calls.find((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCall).toBeTruthy();
    const payload = saveCall[0].data;
    const blogs = payload.myChannels.blogs || [];
    expect(blogs.length).toBe(1);
    expect(blogs[0].id).toBe(derivedId);
  });
});
