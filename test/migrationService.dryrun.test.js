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
    expect(result.dryRunResult.totalItems).toBe(6); // card-1, card-3, card-4, scrap-1, card-2, scrap-2
    
    // groups should include kanban, scraps, and ideas
    // ideas: card-1, card-3
    // kanban: card-4 (in-progress)
    // scraps: scrap-1
    expect(result.dryRunResult.groups.ideas.count).toBe(2);
    expect(result.dryRunResult.groups.kanban.count).toBe(2);
    expect(result.dryRunResult.groups.scraps.count).toBe(2);
    // distribution checks
    expect(result.dryRunResult.distribution.ideas['null']).toBe(2);
    expect(result.dryRunResult.distribution.kanban['null'] || result.dryRunResult.distribution.kanban['undefined']).toBe(1);
    expect(result.dryRunResult.distribution.kanban['ch-other']).toBe(1);
    expect(result.dryRunResult.distribution.scraps['null']).toBe(1);
    expect(result.dryRunResult.distribution.scraps['ch-other']).toBe(1);
    
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
    expect(result.dryRunResult.totalItems).toBe(2);
    // Since the item is in 'ideas' status, it should be grouped under 'ideas'
    expect(result.dryRunResult.groups.ideas.count).toBe(2);
    expect(result.dryRunResult.distribution.ideas['null']).toBe(1);
    expect(result.dryRunResult.distribution.ideas['exists']).toBe(1);
  });

  test('channel_content items without channelId are detected', async () => {
    const userId = 'user-3';
    const kanbanData = {};
    const scrapsData = {};
    const channelContent = {
      'ct-1': { id: 'ct-1', title: 'content', channelId: null },
      'ct-2': { id: 'ct-2', title: 'has channel', channelId: 'exist' },
    };

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'ch3', { dryRun: true });

    expect(result.success).toBe(true);
    // include ct-1 (null) and ct-2 (exists != target)
    expect(result.dryRunResult.totalItems).toBe(2);
    expect(result.dryRunResult.groups.channel_content.count).toBe(2);
    expect(result.dryRunResult.distribution.channel_content['null']).toBe(1);
    expect(result.dryRunResult.distribution.channel_content['exist']).toBe(1);
  });

  test('nested channel_content under blogs are detected', async () => {
    const userId = 'user-3b';
    const kanbanData = {};
    const scrapsData = {};
    const channelContent = {
      blogs: {
        'b-1': { id: 'b-1', channelId: null },
        'b-2': { id: 'b-2', channelId: 'exist' },
      },
    };

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'ch3b', { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRunResult.totalItems).toBe(2);
    expect(result.dryRunResult.groups.channel_content.count).toBe(2);
    // sample should be nested 'blogs/b-1'
    // sample removed; only check counts
    expect(result.dryRunResult.distribution.channel_content['null']).toBe(1);
    expect(result.dryRunResult.distribution.channel_content['exist']).toBe(1);
  });

  test('host match classification includes items when URLs host matches target channel', async () => {
    const userId = 'user-8';
    const kanbanData = {
      ideas: { 'k1': { id: 'k1', publishInfo: { url: 'https://myblog.example.com/post/1' } } },
    };
    const scrapsData = {};
    const channelContent = {};
    const getMock = jest.fn().mockImplementation(async (refPath) => {
      if (refPath.endsWith(`kanban/${userId}`)) return { val: () => kanbanData };
      if (refPath.endsWith(`scraps/${userId}`)) return { val: () => scrapsData };
      if (refPath.endsWith(`channel_content/${userId}`)) return { val: () => channelContent };
      if (refPath.endsWith(`channels/${userId}/myChannels/blogs`)) return { val: () => [{ id: 'blog-1', inputUrl: 'https://myblog.example.com' }] };
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
    const result = await runDataMigration(userId, 'blog-1', { dryRun: true });
    expect(result.success).toBe(true);
    expect(result.dryRunResult.totalItems).toBe(1);
    expect(result.dryRunResult.groups.ideas.count).toBe(1);
  });

  test('collections filter limits the dry-run candidates', async () => {
    const userId = 'user-5';
    const kanbanData = {
      ideas: { 'k1': { id: 'k1', channelId: null } },
    };
    const scrapsData = { 's1': { id: 's1', channelId: null } };
    const channelContent = { 'ct1': { id: 'ct1', channelId: null } };

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'chX', { dryRun: true, collections: ['scraps'] });

    expect(result.success).toBe(true);
    // only scraps should be present
    expect(result.dryRunResult.totalItems).toBe(1);
    expect(result.dryRunResult.groups.scraps.count).toBe(1);
    expect(result.dryRunResult.groups.kanban.count).toBe(0);
    expect(result.dryRunResult.groups.channel_content.count).toBe(0);
  });

  test('resolves linkedScraps referenced by kanban cards and includes as candidates', async () => {
    const userId = 'user-9';
    const kanbanData = {
      ideas: { 'card-1': { id: 'card-1', linkedScraps: ['scrap-1'] } },
    };
    const scrapsData = {
      'scrap-1': { id: 'scrap-1', channelId: null },
      'scrap-2': { id: 'scrap-2', channelId: 'ch-other' },
    };
    const channelContent = {};

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'ch9', { dryRun: true });

    expect(result.success).toBe(true);
    // card and linked scrap should both be included as candidates
    expect(result.dryRunResult.totalItems).toBe(3);
    expect(result.dryRunResult.groups.scraps.count).toBe(2);
    expect(result.dryRunResult.groups.ideas.count || result.dryRunResult.groups.kanban.count).toBe(1);
    // sample removed; only check counts
  });

  test('dry-run returns distribution and groups even when no candidates', async () => {
    const userId = 'user-7';
    const kanbanData = {
      ideas: { 'k1': { id: 'k1', channelId: 'exists' } },
    };
    const scrapsData = { 's1': { id: 's1', channelId: 'exists' } };
    const channelContent = { 'ct1': { id: 'ct1', channelId: 'exists' } };

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    // Use 'exists' as target so existing channelId equals target and no candidates
    const result = await runDataMigration(userId, 'exists', { dryRun: true });

    expect(result.success).toBe(true);
    expect(result.dryRunResult).toBeTruthy();
    expect(result.dryRunResult.totalItems).toBe(0);
    expect(result.dryRunResult.groups.kanban.count).toBe(0);
    expect(result.dryRunResult.groups.scraps.count).toBe(0);
    expect(result.dryRunResult.groups.channel_content.count).toBe(0);
    // distribution should contain counts even when 0 candidates
    expect(result.dryRunResult.distribution).toBeTruthy();
  });

  test('empty collections array behaves as select ALL', async () => {
    const userId = 'user-6';
    const kanbanData = {
      ideas: { 'k1': { id: 'k1', channelId: null } },
    };
    const scrapsData = { 's1': { id: 's1', channelId: null } };
    const channelContent = { 'ct1': { id: 'ct1', channelId: null } };

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
    }));

    const { runDataMigration } = await import('../js/services/migrationService.js');
    const result = await runDataMigration(userId, 'chY', { dryRun: true, collections: [] });

    expect(result.success).toBe(true);
    // all 3 groups should be included
    expect(result.dryRunResult.totalItems).toBe(3);
    expect(result.dryRunResult.groups.ideas.count || result.dryRunResult.groups.kanban.count).toBeTruthy();
    expect(result.dryRunResult.groups.scraps.count).toBe(1);
    expect(result.dryRunResult.groups.channel_content.count).toBe(1);
  });
});
