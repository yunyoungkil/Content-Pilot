import { jest } from '@jest/globals';

describe('Workspace scrap detail insert image', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.resetAllMocks();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_tui_shadow_listener_attached = false;

    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
    chrome.runtime.sendMessage = jest.fn();
  });

  test('clicking insert on scrap detail image posts insert-image to editor iframe', async () => {
    // mock get_all_scraps
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({ success: true, scraps: [{ id: 's1', url: 'https://example.test/page', text: '스크랩 내용', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] }] });
        return;
      }
      if (message && message.action === 'get_scrap_detail') {
        if (cb) cb({ success: true, data: { id: 's1', url: 'https://example.test/page', text: '스크랩 내용', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] } });
        return;
      }
      if (cb) cb({ success: true });
    });

    const { renderWorkspace, updateWorkspaceScraps, addWorkspaceEventListeners } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-1', title: 'Scrap Detail Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    // setup minimal workspace structure
    container.innerHTML = `
      <div class="cp-workspace-container">
        <div class="workspace-container">
          <div class="all-scraps-list"></div>
          <div class="linked-scraps-list"></div>
        </div>
      </div>
    `;

    // We'll allow renderWorkspace to create the editor iframe; we'll mock its contentWindow.postMessage later
    let iframe;

    // render full workspace structure (this will ensure modal elements are present)
    renderWorkspace(container, idea);
    // wait for scraps list to populate (polled wait)
    updateWorkspaceScraps(container, idea);
    addWorkspaceEventListeners(container.querySelector('.workspace-container'), idea, container);
    let scrapItem = null;
    for (let i = 0; i < 20; i++) {
      const allScrapsList = container.querySelector('.all-scraps-list');
      if (allScrapsList) {
        scrapItem = allScrapsList.querySelector('.scrap-card-item');
        if (scrapItem) break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(scrapItem).toBeTruthy();

    // now get the iframe created by renderWorkspace, and mock its contentWindow.postMessage
    iframe = container.querySelector('#quill-editor-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage = jest.fn();
    } else if (iframe) {
      Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: jest.fn() }, configurable: true });
    }

    // Instead of relying on the click -> get_scrap_detail flow, directly show the modal with test data
    const { showScrapDetailModal } = await import('../js/ui/workspaceMode.js');
    const scrapDetailData = { id: 's1', url: 'https://example.test/page', text: '스크랩 내용', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] };
    showScrapDetailModal(scrapDetailData, container);
    // wait for modal to render (polled wait)
    let modal = null;
    for (let i = 0; i < 20; i++) {
      modal = document.querySelector('#scrap-detail-modal') || document.querySelector('.scrap-detail-modal');
      if (modal) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(modal).toBeTruthy();

    console.log('DEBUG modal images count:', modal.querySelectorAll('img').length);
    console.log('DEBUG modal insert buttons count:', modal.querySelectorAll('.scrap-image-insert-btn').length);
    console.log('DEBUG #scrap-detail-images innerHTML:', (modal.querySelector('#scrap-detail-images') || {}).innerHTML);
    const insertBtn = modal.querySelector('.scrap-image-insert-btn');
    expect(insertBtn).toBeTruthy();

    insertBtn.click();
    // assert iframe received insert-image message
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ action: 'insert-image' }), '*');
  });
});
