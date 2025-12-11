const { Logger } = require('../js/utils.js');

describe('Background - save_channels_and_key merge protection', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('preserves existing platformType when incoming payload omits it', async () => {
    // Mock firebaseService methods
    const existingChannels = {
      myChannels: {
        blogs: [
          {
            id: 'ch1',
            inputUrl: 'https://example.tistory.com/mine',
            apiUrl: 'https://example.tistory.com/rss',
            platformType: 'tistory',
          },
        ],
      },
    };

    const setMock = jest.fn().mockResolvedValue(true);
    const getMock = jest.fn().mockResolvedValue({ val: () => existingChannels });
    const getCurrentUserId = jest.fn().mockResolvedValue('user-123');
    const getDb = jest.fn();
    const ref = jest.fn();

    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb,
      getCurrentUserId,
      get: getMock,
      set: setMock,
      ref,
      // background expects initializeFirebase at import time
      initializeFirebase: jest.fn(),
    }));

    // Prepare chrome.alarms mock used by background initialization
    if (!global.chrome.alarms) global.chrome.alarms = { onAlarm: { addListener: jest.fn() }, create: jest.fn() };

    // load background module (registers handlers)
    // To prevent background from attempting heavy initial work (auth/fetches), stub methods used during initialization
    if (!global.chrome.alarms) global.chrome.alarms = { onAlarm: { addListener: jest.fn() }, create: jest.fn() };
    if (!global.chrome.runtime.onConnect) global.chrome.runtime.onConnect = { addListener: jest.fn() };
    if (!global.chrome.runtime.onInstalled) global.chrome.runtime.onInstalled = { addListener: jest.fn() };
    const bg = await import('../background.js');

    // find registered runtime handler
    const runtimeHandler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    // incoming payload missing platformType for ch1
    const payload = {
      myChannels: {
        blogs: [
          {
            id: 'ch1',
            inputUrl: 'https://example.tistory.com/mine',
            apiUrl: 'https://example.tistory.com/rss',
            // platformType omitted
          },
        ],
      },
    };

    // call handler
    const sendResponse = jest.fn();
    const ret = runtimeHandler({ action: 'save_channels_and_key', data: payload }, {}, sendResponse);

    // wait for async operations
    await new Promise((r) => setTimeout(r, 0));

    // ensure set was called and the data passed includes preserved platformType
    expect(getMock).toHaveBeenCalled();
    console.log('DEBUG get called', getMock.mock.calls.length);
    expect(setMock).toHaveBeenCalled();
    const calledWith = setMock.mock.calls[0][1];
    console.log('DEBUG set payload:', JSON.stringify(calledWith, null, 2));
    expect(calledWith.myChannels.blogs[0].platformType).toBe('tistory');
  });
});
