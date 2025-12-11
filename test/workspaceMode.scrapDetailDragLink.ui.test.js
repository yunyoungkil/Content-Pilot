import { jest } from '@jest/globals';

describe('Workspace scrap detail image drag/drop linking', () => {
  jest.setTimeout(10000);
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.resetAllMocks();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_tui_shadow_listener_attached = false;

    global.testHelpers.mockChromeRuntime();
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
    // use testHelpers.mockChromeRuntime to setup sendMessage and onMessage
  });

  test('dragging a scrap detail image and dropping into linked list links the scrap', async () => {
    let linkedCall = null;
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          setTimeout(() =>
            cb({
              success: true,
              scraps: [
                {
                  id: 'scrap-1',
                  text: 'Scrap One',
                  image: 'https://example.test/img1.jpg',
                  allImages: ['https://example.test/img1.jpg'],
                  url: 'https://example.test/page',
                  tags: [],
                },
              ],
            }),
            0
          );
        return;
      }
      if (message && message.action === 'get_scrap_detail') {
        if (cb) setTimeout(() => cb({ success: true, data: { id: 'scrap-1', text: 'Scrap One', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] } }), 0);
        return;
      }
      if (message && message.action === 'link_scrap_to_idea') {
        linkedCall = message;
        if (cb) setTimeout(() => cb({ success: true }), 0);
        return;
      }
      if (cb) setTimeout(() => cb({ success: true }), 0);
    });

    const { renderWorkspace, updateWorkspaceScraps, addWorkspaceEventListeners, showScrapDetailModal } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'idea-3', title: 'Scrap Detail Drag Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    await new Promise((r) => setTimeout(r, 50));

    updateWorkspaceScraps(container, idea);
    addWorkspaceEventListeners(container.querySelector('.workspace-container'), idea, container);
    await new Promise((r) => setTimeout(r, 150));

    // Now show scrap detail modal with scrapData
    const scrapDetailData = { id: 'scrap-1', text: 'Scrap One', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] };
    showScrapDetailModal(scrapDetailData, container);
    let modal = null;
    for (let i = 0; i < 20; i++) {
      modal = document.querySelector('#scrap-detail-modal') || document.querySelector('.scrap-detail-modal');
      if (modal) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(modal).toBeTruthy();

    const wrapper = modal.querySelector('#scrap-detail-images > div');
    expect(wrapper).toBeTruthy();

    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: '' };

    const dragStartEvt = new Event('dragstart', { bubbles: true });
    dragStartEvt.dataTransfer = dt;
    wrapper.dispatchEvent(dragStartEvt);

    expect(dt.getData('application/json')).toBeTruthy();

    const linkedList = container.querySelector('.linked-scraps-list');
    const dropEvt = new Event('drop', { bubbles: true });
    dropEvt.dataTransfer = dt;
    linkedList.dispatchEvent(dropEvt);

    // poll for linkedCall to be set and linked item to appear
    for (let i = 0; i < 20; i++) {
      const linkedItem = container.querySelector('.linked-scraps-list [data-scrap-id="scrap-1"]');
      if (linkedCall && linkedItem) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(linkedCall).toBeTruthy();
    expect(linkedCall.action).toBe('link_scrap_to_idea');
    expect(linkedCall.data.scrapId).toBe('scrap-1');

    container.remove();
  });
});
