import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - delete flow', () => {
  beforeEach(() => {
    global.testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    global.testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('deleting channel with missing id uses apiUrl base64 fallback', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const apiUrl = 'https://example.com/rss';
    // Mock get_channels_and_key response instead of calling sendMessage with object callback
    const mockChannels = [{ inputUrl: 'https://example.com', url: 'https://example.com', apiUrl }];
    const mockResponse = { success: true, data: { myChannels: { blogs: mockChannels } } };
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') cb(mockResponse);
      else if (cb) cb({ success: true });
    });

    // Render and wait
    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Inject a channel with apiUrl but without id
    const encoded = btoa(mockChannels[0].inputUrl.replace(/\/$/, '')).replace(/=/g, '');
    // Wait a tick for the UI to receive data and render
    await testHelpers.waitForMs(200);
    // For debugging tests: help identify what the DOM contains
    // console.log('DEBUG my-channel-list HTML:', container.querySelector('#my-channel-list')?.innerHTML);

    // Ensure background call was triggered
    const calls = chrome.runtime.sendMessage.mock.calls;
    const calledGetChannels = calls.some((c) => c[0] && c[0].action === 'get_channels_and_key');
    expect(calledGetChannels).toBe(true);

    // Find delete button for first channel
    const deleteBtn = container.querySelector('.my-channel-card .delete-btn');
    expect(deleteBtn).toBeTruthy();

    // Mock confirm to auto-approve
    window.confirm = jest.fn().mockReturnValue(true);

    // Click delete
    deleteBtn.click();

    // Wait for async path
    await testHelpers.waitForMs(20);

    const laterCalls = chrome.runtime.sendMessage.mock.calls;
    const found = laterCalls.some((c) => c[0] && c[0].action === 'delete_channel' && c[0].id === encoded);
    expect(found).toBe(true);
  });
});