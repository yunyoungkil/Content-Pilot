import { jest } from '@jest/globals';

describe('Kanban UI - briefing status badges', () => {
  beforeEach(() => {
    jest.resetModules();
    // Ensure active channel exists so updateKanbanUI renders cards
    // updateKanbanUI uses promise-style chrome.storage.local.get in this module
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test('renders briefing status badges for queued/processing/done/failed', async () => {
    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    // Create container and render basic kanban DOM
    // Ensure storage change listeners exist (some UI modules register these)
    chrome.storage.onChanged = { addListener: jest.fn(), removeListener: jest.fn() };
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    const allCards = {
      ideas: {
        'card-queued': {
          title: 'Queued card',
          workspace: { draft: { briefingStatus: 'queued', briefingQueuedAt: Date.now() } },
        },
        'card-processing': {
          title: 'Processing card',
          workspace: { draft: { briefingStatus: 'processing', briefingProgress: 42 } },
        },
      },
      'in-progress': {},
      done: {
        'card-done': {
          title: 'Done card',
          workspace: { draft: { briefingStatus: 'done', briefingCompletedAt: Date.now() } },
        },
        'card-failed': {
          title: 'Failed card',
          workspace: { draft: { briefingStatus: 'failed', briefingError: 'Test error' } },
        },
      },
    };

    await updateKanbanUI(allCards);

    // queued
    const queuedEl = container.querySelector('[data-id="card-queued"] .briefing-status-tag.queued');
    expect(queuedEl).toBeTruthy();
    expect(queuedEl.textContent).toContain('브리핑');

    // processing
    const procEl = container.querySelector(
      '[data-id="card-processing"] .briefing-status-tag.processing'
    );
    expect(procEl).toBeTruthy();
    expect(procEl.textContent).toContain('생성 중');

    // done
    const doneEl = container.querySelector('[data-id="card-done"] .briefing-status-tag.done');
    expect(doneEl).toBeTruthy();
    expect(doneEl.textContent).toContain('브리핑 완료');

    // failed
    const failedEl = container.querySelector('[data-id="card-failed"] .briefing-status-tag.failed');
    expect(failedEl).toBeTruthy();
    expect(failedEl.title).toBe('Test error');
    expect(failedEl.textContent).toContain('브리핑 실패');

    // retry button should be present and should trigger retry message
    const retryBtn = container.querySelector('[data-id="card-failed"] .briefing-retry-btn');
    expect(retryBtn).toBeTruthy();

    // attach event listeners so click handler exists
    const { addKanbanEventListeners } = await import('../js/ui/kanbanMode.js');
    addKanbanEventListeners(container);

    // simulate click and assert runtime sendMessage called
    retryBtn.click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    // check that one of the calls contained retry_idea_briefing action
    const calledWithRetry = chrome.runtime.sendMessage.mock.calls.some(
      (c) => c[0] && c[0].action === 'retry_idea_briefing'
    );
    expect(calledWithRetry).toBeTruthy();

    // processing progress: check progress bar width
    const procBar = container.querySelector('[data-id="card-processing"] .briefing-progress-bar');
    expect(procBar).toBeTruthy();
    expect(procBar.style.width).toContain('42%');
  });

  test('does not show draft badge when draft content is empty or placeholder', async () => {
    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    const allCards = {
      ideas: {
        'card-empty-draft': {
          title: 'Empty draft card',
          draftContent: '',
          workspace: { draft: '<p><br></p>' },
        },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(allCards);

    const draftBadge = container.querySelector('[data-id="card-empty-draft"] .draft-status-count');
    expect(draftBadge).toBeFalsy();
  });

  test('does not show draft badge for link-only or markdown-link-only drafts', async () => {
    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    const allCards = {
      ideas: {
        'card-markdown-link': {
          title: 'Markdown link only',
          workspace: { draft: '[Example](https://example.com)' },
        },
        'card-bare-url': {
          title: 'Bare url only',
          workspace: { draft: 'https://example.com' },
        },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(allCards);

    const mdBadge = container.querySelector('[data-id="card-markdown-link"] .draft-status-count');
    const urlBadge = container.querySelector('[data-id="card-bare-url"] .draft-status-count');

    expect(mdBadge).toBeFalsy();
    expect(urlBadge).toBeFalsy();
  });

  test('does not show draft badge for draft object that only contains status metadata', async () => {
    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    const allCards = {
      ideas: {
        'card-status-only': {
          title: 'Status only draft',
          workspace: { draft: { briefingStatus: 'done', briefingCompletedAt: Date.now() } },
        },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(allCards);

    const badge = container.querySelector('[data-id="card-status-only"] .draft-status-count');
    expect(badge).toBeFalsy();
  });

  test('updates briefing badge when only briefing meta changes (queued -> processing)', async () => {
    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    const initial = {
      ideas: {
        'card-1': {
          title: 'Card 1',
          workspace: { draft: { briefingStatus: 'queued', briefingQueuedAt: Date.now() } },
        },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(initial);

    const queuedEl = container.querySelector('[data-id="card-1"] .briefing-status-tag.queued');
    expect(queuedEl).toBeTruthy();

    // Now update only briefing meta to processing with progress
    const updated = {
      ideas: {
        'card-1': {
          title: 'Card 1',
          workspace: { draft: { briefingStatus: 'processing', briefingProgress: 55 } },
        },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(updated);

    // queued badge should be gone, processing badge should appear
    const procEl = container.querySelector('[data-id="card-1"] .briefing-status-tag.processing');
    expect(procEl).toBeTruthy();
    const procBar = container.querySelector('[data-id="card-1"] .briefing-progress-bar');
    expect(procBar).toBeTruthy();
    expect(procBar.style.width).toContain('55%');
  });
});
