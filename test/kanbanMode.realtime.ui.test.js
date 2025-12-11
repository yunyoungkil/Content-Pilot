import { jest } from '@jest/globals';

describe('Kanban UI - realtime updates from background', () => {
  beforeEach(() => {
    jest.resetModules();
    // Ensure active channel exists so updateKanbanUI renders cards
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test('update via runtime.onMessage applies DOM diffs (add/update/remove)', async () => {
    const runtime = testHelpers.mockChromeRuntime();

    const { renderKanban, updateKanbanUI } = await import('../js/ui/kanbanMode.js');

    // Create container and render basic kanban DOM
    chrome.storage.onChanged = { addListener: jest.fn(), removeListener: jest.fn() };
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderKanban(container);

    // initial data: one card
    const baseCards = {
      ideas: {
        'card-old': { title: 'Old Title', workspace: { draft: '' }, channelId: 'channel-1' },
      },
      'in-progress': {},
      done: {},
    };

    await updateKanbanUI(baseCards);

    // sanity check: initial card exists
    expect(container.querySelector('[data-id="card-old"]')).toBeTruthy();

    // now simulate background push with changes: update card title and add a new card
    const updatedCards = {
      ideas: {
        'card-old': { title: 'New Title', workspace: { draft: '' }, channelId: 'channel-1' },
        'card-new': { title: 'Brand New', workspace: { draft: '' }, channelId: 'channel-1' },
      },
      'in-progress': {},
      done: {},
    };

    // Trigger runtime message as background would do
    runtime.triggerMessage({ action: 'kanban_data_updated', data: updatedCards });

    // wait a tick for listeners to process
    await testHelpers.waitForNextTick();

    // the old card should be updated (title changed)
    const oldCard = container.querySelector('[data-id="card-old"]');
    expect(oldCard).toBeTruthy();
    expect(oldCard.dataset.title).toContain('New Title');

    // the new card should be added
    const newCard = container.querySelector('[data-id="card-new"]');
    expect(newCard).toBeTruthy();
    expect(newCard.dataset.title).toContain('Brand New');
  });
});
