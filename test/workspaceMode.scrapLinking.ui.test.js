import { jest } from '@jest/globals';

describe('Workspace scrap drag/drop linking', () => {
  beforeEach(() => {
    jest.resetModules();
    // ensure callback-style chrome.storage works
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
  });

  test('dragging an unlinked scrap and dropping into linked list calls link_scrap_to_idea and updates DOM', async () => {
    let linkedCall = null;
    // Mock get_all_scraps and link_scrap_to_idea
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({
            success: true,
            scraps: [
              { id: 'scrap-1', text: 'Scrap One', image: '', allImages: [], url: '', tags: [] },
            ],
          });
        return;
      }
      if (message && message.action === 'link_scrap_to_idea') {
        // capture the message payload for assertion
        linkedCall = message;
        if (cb) cb({ success: true });
        return;
      }
      if (cb) cb({ success: true });
    });

    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'idea-1', title: 'Link Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    // click the all-scraps tab to populate the all-scraps list
    const allTabBtn = container.querySelector('.resource-tab-btn[data-tab="all-scraps"]');
    expect(allTabBtn).toBeTruthy();
    allTabBtn.click();

    // wait for async population
    await new Promise((r) => setTimeout(r, 50));

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    const allScrapsList = workspaceEl.querySelector('.all-scraps-list');
    expect(allScrapsList).toBeTruthy();

    // there should be one scrap card
    const scrapItem = allScrapsList.querySelector('[data-scrap-id="scrap-1"]');
    expect(scrapItem).toBeTruthy();

    // simulate dragstart — the app's handler will write application/json into dataTransfer
    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: '' };
    const dragStartEvt = new Event('dragstart', { bubbles: true });
    dragStartEvt.dataTransfer = dt;
    scrapItem.dispatchEvent(dragStartEvt);

    // ensure dataTransfer got application/json
    expect(dt.getData('application/json')).toBeTruthy();

    // drop into linked-scraps list
    const linkedList = workspaceEl.querySelector('.linked-scraps-list');
    expect(linkedList).toBeTruthy();

    const dropEvt = new Event('drop', { bubbles: true });
    dropEvt.dataTransfer = dt;
    linkedList.dispatchEvent(dropEvt);

    // wait for the link_scrap_to_idea callback handling
    await new Promise((r) => setTimeout(r, 20));

    // ensure background API was invoked to link the scrap
    expect(linkedCall).toBeTruthy();
    expect(linkedCall.action).toBe('link_scrap_to_idea');
    expect(linkedCall.data).toBeTruthy();
    expect(linkedCall.data.ideaId).toBe('idea-1');
    expect(linkedCall.data.scrapId).toBe('scrap-1');

    // ensure the linked-scraps-list received a new linked card element
    const newLinkedItem = linkedList.querySelector('[data-scrap-id="scrap-1"]');
    expect(newLinkedItem).toBeTruthy();

    container.remove();
  });
});
