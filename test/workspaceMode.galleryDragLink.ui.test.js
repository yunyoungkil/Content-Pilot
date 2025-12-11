import { jest } from '@jest/globals';

describe('Workspace gallery image drag/drop linking', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.resetAllMocks();
    // reset global workspace flags to avoid cross-test interference
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_tui_shadow_listener_attached = false;

    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
    // ensure runtime sendMessage is a fresh mock
    chrome.runtime.sendMessage = jest.fn();
  });

  test('dragging a gallery image for a scrap and dropping into linked list links the scrap', async () => {
    let linkedCall = null;
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({
            success: true,
            scraps: [
              {
                id: 'scrap-1',
                text: 'Scrap with images',
                image: 'https://example.test/img1.jpg',
                allImages: ['https://example.test/img1.jpg'],
                url: 'https://example.test/page',
                tags: [],
              },
            ],
          });
        return;
      }
      if (message && message.action === 'get_unified_gallery') {
        if (cb)
          cb({
            success: true,
            images: [
              {
                url: 'https://example.test/img1.jpg',
                scrapId: 'scrap-1',
                source: 'SCRAP',
                timestamp: Date.now(),
              },
            ],
          });
        return;
      }
      if (message && message.action === 'link_scrap_to_idea') {
        linkedCall = message;
        if (cb) cb({ success: true });
        return;
      }
      if (cb) cb({ success: true });
    });

    const { renderWorkspace, updateWorkspaceScraps, addWorkspaceEventListeners } = await import(
      '../js/ui/workspaceMode.js'
    );

    const idea = { id: 'idea-2', title: 'Gallery Drag Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    await new Promise((r) => setTimeout(r, 50));

    // populate scraps
    updateWorkspaceScraps(container, idea);
    addWorkspaceEventListeners(container.querySelector('.workspace-container'), idea, container);
    await new Promise((r) => setTimeout(r, 150));

    // wait for gallery to populate
    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();
    const galleryGrid = workspaceEl.querySelector('.image-gallery-grid');
    expect(galleryGrid).toBeTruthy();
    // wait until a gallery thumb appears (up to 500ms)
    let galleryWrap = null;
    for (let i = 0; i < 10; i++) {
      galleryWrap = workspaceEl.querySelector('.image-gallery-grid .gallery-thumb-wrap');
      if (galleryWrap) break;
      // short wait
      await new Promise((r) => setTimeout(r, 50));
    }
    const galleryWrapExist = !!galleryWrap;
    expect(galleryWrapExist).toBeTruthy();

    // galleryWrap is set above

    // create dataTransfer and simulate dragstart
    const dt = {
      data: {},
      setData(k, v) {
        this.data[k] = v;
      },
      getData(k) {
        return this.data[k];
      },
      effectAllowed: '',
    };

    const dragStartEvt = new Event('dragstart', { bubbles: true });
    dragStartEvt.dataTransfer = dt;
    galleryWrap.dispatchEvent(dragStartEvt);

    expect(dt.getData('application/json')).toBeTruthy();

    // drop into linked-scraps
    const linkedList = workspaceEl.querySelector('.linked-scraps-list');
    const dropEvt = new Event('drop', { bubbles: true });
    dropEvt.dataTransfer = dt;
    linkedList.dispatchEvent(dropEvt);

    await new Promise((r) => setTimeout(r, 50));

    expect(linkedCall).toBeTruthy();
    expect(linkedCall.action).toBe('link_scrap_to_idea');
    expect(linkedCall.data.scrapId).toBe('scrap-1');

    // ensure linked scrap card contains the thumbnail of dragged image
    const newLinkedItem = linkedList.querySelector('[data-scrap-id="scrap-1"]');
    expect(newLinkedItem).toBeTruthy();
    const imgEl = newLinkedItem.querySelector('.scrap-card-img-wrap img');
    expect(imgEl).toBeTruthy();
    expect(imgEl.src).toContain('img1.jpg');

    container.remove();
  });
});
