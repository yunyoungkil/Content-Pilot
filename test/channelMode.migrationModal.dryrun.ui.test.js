import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - migration modal dry-run action', () => {
  beforeEach(() => {
    jest.resetModules();
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('dry-run shows result in modal', async () => {
    const responsePayload = {
      success: true,
      data: {
        myChannels: {
          blogs: [
            { id: 'ch1', inputUrl: 'https://blog.example.com/user', apiUrl: 'https://blog.example.com/rss', platformType: 'naver' },
          ],
        },
      },
    };
    const LONG_SAMPLE = 'X'.repeat(200);

    let capturedMigrateMsg = null;
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') {
        cb(responsePayload);
      } else if (msg && msg.action === 'migrate_channel') {
        capturedMigrateMsg = msg;
        cb({
          success: true,
          dryRunResult: {
            totalItems: 2,
            groups: {
              kanban: { count: 1, statuses: { 'in-progress': 1, done: 0 } },
              scraps: { count: 1 },
              channel_content: { count: 1 },
            },
            distribution: {
              channel_content: { 'blog-1': 1 },
              scraps: { 'ch-abc': 1 },
              ideas: {},
              kanban_inprogress: {},
              kanban_done: {},
              kanban: {},
            },
            overallDistribution: {
              channel_content: { 'blog-1': 1 },
              scraps: { 'ch-abc': 1 },
              kanban: {},
              kanban_inprogress: {},
              kanban_done: {},
              ideas: {},
            },
          },
        });
      } else cb({ success: true });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const module = await import('../js/ui/channelMode.js');
    module.renderChannelMode(container);

    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    // click id
    const idEl = container.querySelector('.channel-id');
    expect(idEl).toBeTruthy();
    idEl.click();

    await testHelpers.waitForNextTick();

    const modal = document.querySelector('#channel-migration-modal');
    expect(modal).toBeTruthy();

    const dryRunCheckbox = modal.querySelector('#migration-dryrun');
    expect(dryRunCheckbox).toBeTruthy();
    dryRunCheckbox.checked = true; // set dry-run
    const debugCheckbox = modal.querySelector('#migration-debug');
    expect(debugCheckbox).toBeTruthy();
    debugCheckbox.checked = true;

    const runBtn = modal.querySelector('#migration-run');
    expect(runBtn).toBeTruthy();
    runBtn.click();

    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    const resultEl = modal.querySelector('#migration-result');
    expect(resultEl).toBeTruthy();
    expect(resultEl.textContent).toContain('총 2개 항목');
    // header/counters removed - ensure distribution lines are present instead
    // distribution checks: only overall distribution entries are shown (non-null)
    expect(resultEl.textContent).toContain('대상 채널콘텐츠 분포:');
    expect(resultEl.textContent).toContain('blog-1: 1');
    // Verify selected collections were sent (all selected by default)
    expect(capturedMigrateMsg).toBeTruthy();
    expect(capturedMigrateMsg.options).toBeTruthy();
    expect(Array.isArray(capturedMigrateMsg.options.collections)).toBe(true);
    expect(capturedMigrateMsg.options.debug).toBe(true);
    // sample removed in new UI; no truncation expected
    // Distribution lines should include each collection label with counts and channel ID breakdown
    expect(resultEl.textContent).toContain('대상 스크랩 분포:');
    expect(resultEl.textContent).toContain('ch-abc: 1');
  });

  test('modal sends selected collections to background', async () => {
    const responsePayload = {
      success: true,
      data: {
        myChannels: { blogs: [{ id: 'ch1', inputUrl: 'https://blog.example.com/user', apiUrl: 'https://blog.example.com/rss', platformType: 'naver' }] }
      },
    };
    let capturedMigrateMsg = null;
    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') cb(responsePayload);
      else if (msg && msg.action === 'migrate_channel') {
        capturedMigrateMsg = msg;
        cb({ success: true, dryRunResult: { totalItems: 0, groups: {} } });
      } else cb({ success: true });
    });

    const container = document.createElement('div');
    document.body.appendChild(container);
    const module = await import('../js/ui/channelMode.js');
    module.renderChannelMode(container);
    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    const idEl = container.querySelector('.channel-id');
    idEl.click();
    await testHelpers.waitForNextTick();

    const modal = document.querySelector('#channel-migration-modal');
    expect(modal).toBeTruthy();
    const dryRunCheckbox = modal.querySelector('#migration-dryrun');
    dryRunCheckbox.checked = true;

    // uncheck kanban statuses and channel_content
    modal.querySelector('input[value="kanban_inprogress"]').checked = false;
    modal.querySelector('input[value="kanban_done"]').checked = false;
    modal.querySelector('input[value="ideas"]').checked = false;
    modal.querySelector('input[value="channel_content"]').checked = false;

    modal.querySelector('#migration-run').click();
    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    expect(capturedMigrateMsg).toBeTruthy();
    expect(capturedMigrateMsg.options.collections).toEqual(['scraps']);
  });
});
