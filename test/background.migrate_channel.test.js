describe('Background - migrate_channel handler', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns dry-run result when migrationService returns dry-run', async () => {
    const runDataMigrationMock = jest.fn().mockResolvedValue({ success: true, message: 'Dry-run OK', dryRunResult: { items: 2 } });
    const getCurrentUserId = jest.fn().mockResolvedValue('user-123');

    jest.doMock('../js/services/migrationService.js', () => ({
      runDataMigration: runDataMigrationMock,
      checkMigrationNeeded: jest.fn().mockResolvedValue({ success: true, needsMigration: false }),
    }));

    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId,
      initializeFirebase: jest.fn(),
      CONSTANTS: { USER_ID: 'default_user' },
    }));
    jest.doMock('../js/services/authService.js', () => ({
      restoreAuthSession: jest.fn().mockResolvedValue(null),
      startGoogleAuth: jest.fn(),
      revokeGoogleAuth: jest.fn(),
      getValidToken: jest.fn().mockResolvedValue(null),
    }));
    jest.doMock('../js/constants.js', () => ({
      USER_ID: 'default_user',
    }));

    // minimal chrome stubs
    if (!global.chrome.alarms) global.chrome.alarms = { onAlarm: { addListener: jest.fn() }, create: jest.fn() };
    if (!global.chrome.runtime.onConnect) global.chrome.runtime.onConnect = { addListener: jest.fn() };
    if (!global.chrome.runtime.onInstalled) global.chrome.runtime.onInstalled = { addListener: jest.fn() };

    const bg = await import('../background.js');

    const runtimeHandler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const sendResponse = jest.fn();
    runtimeHandler({ action: 'migrate_channel', channelId: 'ch1', dryRun: true }, {}, sendResponse);

    // wait for async
    await new Promise((r) => setTimeout(r, 0));

    // sendResponse should have been called with the dry-run result
    expect(runDataMigrationMock).toHaveBeenCalledWith('user-123', 'ch1', { dryRun: true, targetPlatform: null });
  });

  test('returns error when channel is not owned by user', async () => {
    const runDataMigrationMock = jest.fn();
    const getCurrentUserId = jest.fn().mockResolvedValue('user-123');
    const getMock = jest.fn().mockResolvedValue({ val: () => ({ myChannels: { blogs: [{ id: 'owner-1' }] } }) });

    jest.doMock('../js/services/migrationService.js', () => ({
      runDataMigration: runDataMigrationMock,
      checkMigrationNeeded: jest.fn().mockResolvedValue({ success: true, needsMigration: false }),
    }));

    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId,
      get: getMock,
      ref: jest.fn((db, path) => path),
      initializeFirebase: jest.fn(),
      CONSTANTS: { USER_ID: 'default_user' },
    }));

    jest.doMock('../js/services/authService.js', () => ({
      restoreAuthSession: jest.fn().mockResolvedValue(null),
      startGoogleAuth: jest.fn(),
      revokeGoogleAuth: jest.fn(),
      getValidToken: jest.fn().mockResolvedValue(null),
    }));

    const chromeSet = jest.fn((obj, cb) => cb());
    chrome.storage.local.set = chromeSet;

    const bg = await import('../background.js');

    const runtimeHandler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const sendResponse = jest.fn();
    runtimeHandler({ action: 'migrate_channel', channelId: 'not-owned', dryRun: true }, {}, sendResponse);

    // wait for async
    await new Promise((r) => setTimeout(r, 0));

    expect(runDataMigrationMock).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalled();
    const resp = sendResponse.mock.calls[0][0];
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('권한');
  });

  test('enqueues migration job for non-dry-run and returns jobId', async () => {
    const runDataMigrationMock = jest.fn().mockResolvedValue({ success: true });
    const getCurrentUserId = jest.fn().mockResolvedValue('user-123');
    const getMock = jest.fn().mockResolvedValue({ val: () => ({ myChannels: { blogs: [{ id: 'my-blog' }] } }) });

    jest.doMock('../js/services/migrationService.js', () => ({
      runDataMigration: runDataMigrationMock,
      checkMigrationNeeded: jest.fn().mockResolvedValue({ success: true, needsMigration: false }),
    }));

    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId,
      get: getMock,
      ref: jest.fn((db, path) => path),
      initializeFirebase: jest.fn(),
      CONSTANTS: { USER_ID: 'default_user' },
    }));

    jest.doMock('../js/services/authService.js', () => ({
      restoreAuthSession: jest.fn().mockResolvedValue(null),
      startGoogleAuth: jest.fn(),
      revokeGoogleAuth: jest.fn(),
      getValidToken: jest.fn().mockResolvedValue(null),
    }));

    // chrome.storage.local mocks
    let storage = {};
    chrome.storage.local.get = jest.fn((keys, cb) => cb(storage));
    chrome.storage.local.set = jest.fn((obj, cb) => {
      storage = Object.assign({}, storage, obj);
      if (cb) cb();
    });

    const bg = await import('../background.js');
    const runtimeHandler = global.chrome.runtime.onMessage.addListener.mock.calls[0][0];

    const sendResponse = jest.fn();
    runtimeHandler({ action: 'migrate_channel', channelId: 'my-blog', dryRun: false }, {}, sendResponse);

    await new Promise((r) => setTimeout(r, 0));

    expect(sendResponse).toHaveBeenCalled();
    const resp = sendResponse.mock.calls[0][0];
    expect(resp.success).toBe(true);
    expect(resp.jobId).toBeTruthy();
    // verify job enqueued
    expect(storage.migrationJobs).toBeDefined();
    expect(storage.migrationJobs.length).toBe(1);
    expect(storage.migrationJobs[0].id).toBe(resp.jobId);
  });
});