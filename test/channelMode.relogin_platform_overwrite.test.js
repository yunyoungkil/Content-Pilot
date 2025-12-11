import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - relogin platform overwrite regression', () => {
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

  test('channel platforms persist across relogin/save sequence', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // We'll simulate backend state: savedChannels will hold last saved myChannels
    let savedChannels = { myChannels: { blogs: [], youtubes: [] } };

    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message && message.action === 'get_channels_and_key') {
        // return the current saved channels state
        if (callback) callback({ success: true, data: savedChannels });
        return;
      }

      if (message && message.action === 'save_channels_and_key') {
        // capture payload into savedChannels and respond success
        savedChannels = message.data || savedChannels;
        if (callback) callback({ success: true });
        return;
      }

      if (callback) callback({ success: true });
    });

    renderChannelMode(container);
    await testHelpers.waitForNextTick();

    // Add channel 1 (Tistory) and save
    container.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    container.querySelector('#modal-platform-select').value = 'tistory';
    container.querySelector('#modal-blog-url').value = 'https://example.tistory.com/mine';
    container.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(50);

    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    saveAllBtn.click();
    await testHelpers.waitForMs(50);

    // Verify savedChannels now contains the tistory channel
    expect(savedChannels.myChannels.blogs.length).toBe(1);
    expect(savedChannels.myChannels.blogs[0].platformType).toBe('tistory');
    console.log('After first save payload:', JSON.stringify(savedChannels, null, 2));

    // Simulate relogin: clear UI and render again which should pull savedChannels
    document.body.innerHTML = '';
    const container2 = document.createElement('div');
    document.body.appendChild(container2);

    renderChannelMode(container2);
    await testHelpers.waitForNextTick();

    // Add channel 2 (Naver) and save
    container2.querySelector('#add-my-channel-btn').click();
    await testHelpers.waitForNextTick();
    container2.querySelector('#modal-platform-select').value = 'naver';
    container2.querySelector('#modal-blog-url').value = 'https://blog.naver.com/other';
    container2.querySelector('#modal-apply-btn').click();
    await testHelpers.waitForMs(50);

    const saveAllBtn2 = container2.querySelector('#save-all-channels-btn');
    saveAllBtn2.click();
    await testHelpers.waitForMs(50);

    // After saving, ensure both channels exist and first channel remains tistory
    console.log('After second save payload:', JSON.stringify(savedChannels, null, 2));
    expect(savedChannels.myChannels.blogs.length).toBe(2);
    const first = savedChannels.myChannels.blogs.find((b) => b.inputUrl && b.inputUrl.includes('tistory'));
    const second = savedChannels.myChannels.blogs.find((b) => b.inputUrl && b.inputUrl.includes('naver'));
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first.platformType).toBe('tistory');
    expect(second.platformType).toBe('naver');
  });
});