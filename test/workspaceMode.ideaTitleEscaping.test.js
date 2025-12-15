import { jest } from '@jest/globals';

describe('Workspace UI - idea title escaping and save', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    global.testHelpers.mockChromeRuntime();
  });

  test('idea title with quotes does not break publish-info DOM and can be edited/saved', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const badTitle = '20 더보기 베스트순 최신순 모든 별점 오순이라네 2025.11.08 판매자: 쿠팡(주) [10f삼성전자 Bespoke AI LCD 콤보 세탁기 109.2mm WD80';

    const idea = {
      id: 'card-bad-title',
      title: badTitle,
      status: 'ideas',
      publishInfo: {},
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // wait and open publish-info
    await global.testHelpers.waitForMs(300);
    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    expect(tabBtn).toBeTruthy();
    tabBtn.click();
    await global.testHelpers.waitForMs(50);

    // idea-title input should exist and contain the original string (unaltered)
    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();
    expect(input.value).toBe(badTitle);

    // simulate edit -> save button should appear
    const saveBtn = container.querySelector('#save-idea-title-btn');
    expect(saveBtn).toBeTruthy();

    // mock sendMessage to always succeed for this save
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    input.value = badTitle + ' X';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(20);
    expect(saveBtn.style.display).not.toBe('none');

    // trigger blur to perform save and wait
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(50);

    // header display should be updated
    const header = container.querySelector('#workspace-title-display');
    expect(header).toBeTruthy();
    expect(header.textContent).toBe(badTitle + ' X');

    sendSpy.mockRestore();
    container.remove();
  });
});
