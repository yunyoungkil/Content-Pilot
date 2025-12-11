import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - ID preservation', () => {
  beforeEach(() => {
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('saving edited channel preserves existing id', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Mock get_channels_and_key response with a channel that has an id
    const mockChannels = {
      success: true,
      data: {
        myChannels: {
          blogs: [
            {
              id: 'existing-123',
              inputUrl: 'https://blog.example.com/user',
              url: 'https://blog.example.com/user',
              apiUrl: 'https://blog.example.com/rss',
              platformType: 'naver',
              gaPropertyId: '',
              adSenseAccountId: '',
              contentLimit: 10,
              competitorContentLimit: 10,
              competitors: [],
            },
          ],
        },
      },
    };

    // Mock runtime get_channels_and_key response
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') cb(mockChannels);
      else cb({ success: true });
    });

    renderChannelMode(container);

    // Wait for initial render
    await testHelpers.waitForNextTick();

    // Click edit button on the first channel
    const editBtn = container.querySelector('.my-channel-card .edit-btn');
    expect(editBtn).toBeTruthy();
    editBtn.click();

    // Wait for modal
    await testHelpers.waitForNextTick();

    // Click apply without changes
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();

    // wait for async saveChannelsToFirebase -> chrome.runtime.sendMessage
    await testHelpers.waitForMs(20);

    // Find save_channels_and_key call and inspect payload
    const sent = chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(sent).toBeTruthy();
    const payload = sent[0].data;
    expect(payload).toBeTruthy();
    const savedBlogs = payload.myChannels.blogs;
    expect(Array.isArray(savedBlogs)).toBe(true);
    expect(savedBlogs[0].id).toBe('existing-123');
  });
});
