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

    // Click apply (로컬만 업데이트됨)
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();
    await testHelpers.waitForMs(20);

    // 모달 적용 시에는 저장 호출이 발생하지 않음
    let saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(0);

    // 이제 '설정 저장하기' 를 눌러 서버에 저장
    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    expect(saveAllBtn).toBeTruthy();
    saveAllBtn.click();
    await testHelpers.waitForMs(20);

    // 저장 호출 발생 및 payload 확인
    saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(1);
    const payload = saveCalls[0][0].data;
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

    // 저장 호출은 아직 발생하지 않음
    let saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(0);

    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    saveAllBtn.click();
    await testHelpers.waitForMs(20);
    saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(1);
    const payload = saveCalls[0][0].data;
    const blogs = payload.myChannels.blogs || [];
    expect(blogs.length).toBe(1);
    expect(blogs[0].id).toBe(derivedId);
  });
});
