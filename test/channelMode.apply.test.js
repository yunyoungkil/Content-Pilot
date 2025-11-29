import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - apply/save flow', () => {
  beforeEach(() => {
    // 초기 스토리지 상태: 로그인된 상태로 가정
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    // storage.onChanged 이벤트 리스너를 사용하는 모듈이 있으므로 모크를 추가
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('clicking Apply in channel modal triggers save_channels_and_key', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Render channel mode
    renderChannelMode(container);

    // Wait a tick for initialization
    await testHelpers.waitForNextTick();

    // Open modal (simulate clicking add channel)
    const addBtn = container.querySelector('#add-my-channel-btn');
    expect(addBtn).toBeTruthy();
    addBtn.click();

    // Wait for modal render
    await testHelpers.waitForNextTick();

    const blogUrlEl = container.querySelector('#modal-blog-url');
    expect(blogUrlEl).toBeTruthy();
    // Input valid URL
    blogUrlEl.value = 'https://blog.example.com/user';

    // Click apply
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();

    // wait for async saveChannelsToFirebase -> chrome.runtime.sendMessage
    await testHelpers.waitForMs(20);

    // Assert that save_channels_and_key message was sent
    const calls = chrome.runtime.sendMessage.mock.calls;
    const found = calls.some((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(found).toBe(true);
  });
});
