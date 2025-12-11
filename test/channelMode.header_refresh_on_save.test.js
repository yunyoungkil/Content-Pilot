import { renderChannelMode } from '../js/ui/channelMode.js';

jest.mock('../js/ui/header.js', () => ({
  addHeaderEventListeners: jest.fn(),
  refreshGlobalChannelSelector: jest.fn(),
}));

describe('ChannelMode - refresh header selector after save', () => {
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

  test('calls header.refreshGlobalChannelSelector after save', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // initial server returns no channels
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        if (callback) callback({ success: true, data: { myChannels: { blogs: [] } } });
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

    // Open modal and add channel
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    const blogUrlEl = container.querySelector('#modal-blog-url');
    blogUrlEl.value = 'https://example.blog/user';
    const applyBtn = container.querySelector('#modal-apply-btn');
    applyBtn.click();
    await testHelpers.waitForMs(200);

    // 방송 메시지가 발행되었는지 확인 (헤더 갱신 트리거)
    const sent = chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'channels_data_updated');
    expect(sent).toBeTruthy();
  });
});
