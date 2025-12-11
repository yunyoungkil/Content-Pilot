import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - id inference for missing id', () => {
  beforeEach(() => {
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('saving edited channel with missing id keeps deterministic id derived from apiUrl', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // channel without id but with apiUrl
    const inputUrl = 'https://blog.example.com/user';
    const expectedId = (typeof btoa !== 'undefined'
      ? btoa(inputUrl.replace(/\/$/, '')).replace(/=/g, '')
      : Buffer.from(inputUrl).toString('base64').replace(/=/g, ''));

    const mockChannels = {
      success: true,
      data: {
        myChannels: {
          blogs: [
            {
              // id missing
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

    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') cb(mockChannels);
      else cb({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Click edit button on the first channel and apply without changes
    const editBtn = container.querySelector('.my-channel-card .edit-btn');
    expect(editBtn).toBeTruthy();
    editBtn.click();
    await testHelpers.waitForNextTick();
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();

    await testHelpers.waitForMs(20);

    const sent = chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(sent).toBeTruthy();
    const payload = sent[0].data;
    const savedBlogs = payload.myChannels.blogs;
    expect(savedBlogs[0].id).toBe(expectedId);
  });
});
