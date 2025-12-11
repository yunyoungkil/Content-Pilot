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

    chrome.runtime.sendMessage.mockImplementation((msg, cb) => {
      if (msg && msg.action === 'get_channels_and_key') {
        cb(responsePayload);
      } else if (msg && msg.action === 'migrate_channel') {
        cb({
          success: true,
          dryRunResult: {
            totalItems: 2,
            groups: {
              kanban: { count: 1, sample: ['ideas/card-1'] },
              scraps: { count: 1, sample: ['scrap-1'] },
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

    const runBtn = modal.querySelector('#migration-run');
    expect(runBtn).toBeTruthy();
    runBtn.click();

    await testHelpers.waitForNextTick();
    await testHelpers.waitForMs(10);

    const resultEl = modal.querySelector('#migration-result');
    expect(resultEl).toBeTruthy();
    expect(resultEl.textContent).toContain('총 2개 항목');
    expect(resultEl.textContent).toContain('- 칸반: 1개');
    expect(resultEl.textContent).toContain('- 스크랩: 1개');
  });
});
