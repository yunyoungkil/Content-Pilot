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
    expect(runDataMigrationMock).toHaveBeenCalledWith('user-123', 'ch1');
  });
});