describe('Migration Service - dry-run', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('dry-run collects migration candidates and does not write', async () => {
    const userId = 'user-1';
    // Mock data: 1 kanban with null channelId, 1 scrap with null channelId
    const kanbanData = {
      ideas: {
        'card-1': { id: 'card-1', channelId: null },
        'card-2': { id: 'card-2', channelId: 'ch-other' },
      },
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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');

    const result = await runDataMigration(userId, 'ch1', { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRunResult).toBeTruthy();
    expect(result.dryRunResult.totalItems).toBe(2); // card-1 and scrap-1
    expect(updateMock).not.toHaveBeenCalled();
    expect(setMock).not.toHaveBeenCalled();
  });
});
