import { jest } from '@jest/globals';

describe('Migration Service - migrateChannelIdCascade', () => {
  beforeEach(() => jest.resetModules());

  test('updates channel_content entries alongside kanban and scraps', async () => {
    const userId = 'user-5';
    const oldId = 'oldChannel';

    const kanbanData = {
      ideas: { 'k1': { id: 'k1', channelId: oldId } },
      'in-progress': {},
    };
    const scrapsData = { 's1': { id: 's1', channelId: oldId } };
    const contentData = { 'blogs': { 'ct1': { id: 'ct1', channelId: oldId } } };

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}/ideas`)) return { val: () => kanbanData.ideas };
      if (refPath.endsWith(`kanban/${userId}/in-progress`)) return { val: () => kanbanData['in-progress'] };
      if (refPath.endsWith(`kanban/${userId}/done`)) return { val: () => ({}) };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => contentData };
      return { val: () => ({}) };
    });
    const updateMock = jest.fn().mockResolvedValue(true);

    // mock firebaseService with getCurrentUserId/get/ref/get/update
    jest.doMock('../js/services/firebaseService.js', () => ({
      getCurrentUserId: jest.fn().mockResolvedValue(userId),
      getDb: jest.fn(),
      ref: jest.fn((db, path) => path),
      get: getMock,
      update: updateMock,
    }));

    const { migrateChannelIdCascade } = await import('../js/services/migrationService.js');

    const result = await migrateChannelIdCascade(oldId, 'newChannel');
    // Our function returns success true, count should be 3
    expect(result).toBeTruthy();
    expect(result.success).toBe(true);
    expect(result.count).toBe(3);
    // update should be called once with multi-location update
    expect(updateMock).toHaveBeenCalled();
    const updatesArg = updateMock.mock.calls[0][1] || updateMock.mock.calls[0][0];
    expect(updatesArg[`kanban/${userId}/ideas/k1/channelId`]).toBe('newChannel');
    expect(updatesArg[`scraps/${userId}/s1/channelId`]).toBe('newChannel');
    expect(updatesArg[`channel_content/${userId}/blogs/ct1/channelId`]).toBe('newChannel');
  });
});
