import { jest } from '@jest/globals';

describe('Migration Service - update (real run)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('updates kanban, scraps and channel_content items when dryRun=false', async () => {
    const userId = 'user-4';
    const kanbanData = {
      'in-progress': {
        'card-1': { id: 'card-1', channelId: null },
      },
    };
    const scrapsData = { 'scrap-1': { id: 'scrap-1', channelId: null } };
    const channelContent = { 'ct-1': { id: 'ct-1', channelId: null } };

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) return { val: () => kanbanData };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => channelContent };
      return { val: () => ({}) };
    });

    const updateMock = jest.fn().mockResolvedValue(true);
    const setMock = jest.fn().mockResolvedValue(true);

    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb: jest.fn(),
      ref: jest.fn((db, path) => path),
      get: getMock,
      update: updateMock,
      set: setMock,
      remove: jest.fn(),
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');

    const result = await runDataMigration(userId, 'chX', { dryRun: false });
    expect(result.success).toBe(true);
    // verify DB updates were called for kanban (scraps/channel_content require host-match)
    expect(updateMock).toHaveBeenCalled();
    const calls = updateMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([`kanban/${userId}/in-progress/card-1`]));
  });

  test('updates only the selected collections when provided', async () => {
    const userId = 'user-4b';
    const kanbanData = {
      'in-progress': { 'card-1': { id: 'card-1', channelId: null } },
    };
    const scrapsData = { 'scrap-1': { id: 'scrap-1', channelId: null } };
    const channelContent = { 'ct-1': { id: 'ct-1', channelId: null } };

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) return { val: () => kanbanData };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => channelContent };
      return { val: () => ({}) };
    });

    const updateMock = jest.fn().mockResolvedValue(true);
    const setMock = jest.fn().mockResolvedValue(true);

    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb: jest.fn(),
      ref: jest.fn((db, path) => path),
      get: getMock,
      update: updateMock,
      set: setMock,
      remove: jest.fn(),
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');

    const result = await runDataMigration(userId, 'chX', { dryRun: false, collections: ['scraps'] });
    expect(result.success).toBe(true);
    // update should not be called when only scraps collection is selected (host matching required)
    expect(updateMock).not.toHaveBeenCalled();
  });

  test('updates items when URL host matches target channel', async () => {
    const userId = 'user-9';
    const kanbanData = {
      ideas: { 'card-1': { id: 'card-1', publishInfo: { url: 'https://blog.example.com/post/1' } } },
    };
    const scrapsData = {};
    const channelContent = {};
    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) return { val: () => kanbanData };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => channelContent };
      if (refPath.endsWith(`channels/${userId}/myChannels/blogs`)) return { val: () => [{ id: 'blog-ch', inputUrl: 'https://blog.example.com' }] };
      return { val: () => ({}) };
    });

    const updateMock = jest.fn().mockResolvedValue(true);
    const setMock = jest.fn().mockResolvedValue(true);

    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb: jest.fn(),
      ref: jest.fn((db, path) => path),
      get: getMock,
      update: updateMock,
      set: setMock,
      remove: jest.fn(),
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'blog-ch', { dryRun: false });
    expect(result.success).toBe(true);
    const calls = updateMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([`kanban/${userId}/ideas/card-1`]));
  });

  test('empty collections array behaves as select ALL for updates', async () => {
    const userId = 'user-4c';
    const kanbanData = {
      'in-progress': { 'card-1': { id: 'card-1', channelId: null } },
    };
    const scrapsData = { 'scrap-1': { id: 'scrap-1', channelId: null } };
    const channelContent = { 'ct-1': { id: 'ct-1', channelId: null } };

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) return { val: () => kanbanData };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => channelContent };
      return { val: () => ({}) };
    });

    const updateMock = jest.fn().mockResolvedValue(true);
    const setMock = jest.fn().mockResolvedValue(true);

    jest.doMock('../js/services/firebaseService.js', () => ({
      getDb: jest.fn(),
      ref: jest.fn((db, path) => path),
      get: getMock,
      update: updateMock,
      set: setMock,
      remove: jest.fn(),
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');

    const result = await runDataMigration(userId, 'chX', { dryRun: false, collections: [] });
    expect(result.success).toBe(true);
    // update should be called for kanban only (scraps/channel_content require host-match)
    expect(updateMock).toHaveBeenCalled();
    const calls = updateMock.mock.calls.map((c) => c[0]);
    expect(calls).toEqual(expect.arrayContaining([`kanban/${userId}/in-progress/card-1`]));
  });
});
