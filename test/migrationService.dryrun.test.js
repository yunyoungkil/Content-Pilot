describe('Migration Service - dry-run', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('dry-run collects migration candidates and does not write', async () => {
    const userId = 'user-1';
    // Mock data: 1 kanban (ideas) with null channelId, 1 kanban (in-progress) with null channelId
    const kanbanData = {
      ideas: {
        'card-1': { id: 'card-1', channelId: null },
        'card-3': { id: 'card-3', channelId: '' }, // empty string
      },
      'in-progress': {
        'card-2': { id: 'card-2', channelId: 'ch-other' },
        'card-4': { id: 'card-4', channelId: null },
      }
    };
    const scrapsData = {
      'scrap-1': { id: 'scrap-1', channelId: null },
      'scrap-2': { id: 'scrap-2', channelId: 'ch-other' },
    };

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) {
        return { val: () => kanbanData };
      }
      if (refPath.endsWith(`scraps/${userId}`)) {
        return { val: () => scrapsData };
      }
      // default: empty
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

    const result = await runDataMigration(userId, 'ch1', { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRunResult).toBeTruthy();
    expect(result.dryRunResult.totalItems).toBe(4); // card-1, card-3, card-4, scrap-1
    
    // groups should include kanban, scraps, and ideas
    // ideas: card-1, card-3
    // kanban: card-4 (in-progress)
    // scraps: scrap-1
    expect(result.dryRunResult.groups.ideas.count).toBe(2);
    expect(result.dryRunResult.groups.kanban.count).toBe(1);
    expect(result.dryRunResult.groups.scraps.count).toBe(1);
    
    expect(updateMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });

  test('nested publishInfo.channelId missing is treated as candidate', async () => {
    const userId = 'user-2';
    const kanbanData = {
      ideas: {
        'card-1': { id: 'card-1', publishInfo: { channelId: null } },
        'card-2': { id: 'card-2', publishInfo: { channelId: 'exists' } },
      },
    };
    const scrapsData = {};

    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) {
        return { val: () => kanbanData };
      }
      if (refPath.endsWith(`scraps/${userId}`)) {
        return { val: () => scrapsData };
      }
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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');

    const result = await runDataMigration(userId, 'ch2', { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.dryRunResult.totalItems).toBe(1);
    // Since the item is in 'ideas' status, it should be grouped under 'ideas'
    expect(result.dryRunResult.groups.ideas.count).toBe(1);
  });
});
