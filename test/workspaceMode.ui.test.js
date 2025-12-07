import { jest } from '@jest/globals';

describe('Workspace UI - briefing status and retry', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test('shows top-level "done" when nested draft remained queued', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-1',
      title: 'Test Idea',
      status: 'ideas',
      // nested draft still shows queued
      workspace: { draft: { briefingStatus: 'queued', briefingQueuedAt: Date.now() } },
      // top-level status changed to done
      briefingStatus: 'done',
      briefingCompletedAt: Date.now(),
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // open ai-briefing area manually by switching tab
    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="ai-briefing"]');
    expect(tabBtn).toBeTruthy();
    tabBtn.click();

    const area = container.querySelector('#ai-briefing-area');
    expect(area).toBeTruthy();

    const doneBadge = area.querySelector('.briefing-status-badge.done');
    expect(doneBadge).toBeTruthy();
    expect(doneBadge.textContent).toContain('브리핑 완료');
  });

  test('shows processing progress and retry button triggers runtime', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-2',
      title: 'Progress Test',
      status: 'ideas',
      briefingStatus: 'processing',
      briefingProgress: 33,
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // open ai-briefing tab
    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="ai-briefing"]');
    tabBtn.click();

    const area = container.querySelector('#ai-briefing-area');
    expect(area).toBeTruthy();

    const procBar = area.querySelector('.briefing-progress-bar');
    expect(procBar).toBeTruthy();
    expect(procBar.style.width).toContain('33%');

    // simulate failed -> show retry
    // re-render with failed state
    const ideaFailed = { ...idea, briefingStatus: 'failed', briefingError: 'Err' };
    renderWorkspace(container, ideaFailed);

    const retryBtn = container.querySelector('.workspace-briefing-retry-btn');
    expect(retryBtn).toBeTruthy();

    // attach event listeners so handler is set
    const { addWorkspaceEventListeners } = await import('../js/ui/workspaceMode.js');
    addWorkspaceEventListeners(container, ideaFailed, container);

    retryBtn.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const calledWithRetry = chrome.runtime.sendMessage.mock.calls.some(
      (c) => c[0] && c[0].action === 'retry_idea_briefing'
    );
    expect(calledWithRetry).toBeTruthy();
  });
});
