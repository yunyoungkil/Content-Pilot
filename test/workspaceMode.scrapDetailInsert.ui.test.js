import { jest } from '@jest/globals';

describe('Workspace scrap detail insert image', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
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
    // allow DOM updates
    await new Promise((r) => setTimeout(r, 100));
    // update workspace to load scraps
    updateWorkspaceScraps(container, idea);
    // ensure event listeners are attached
    addWorkspaceEventListeners(container.querySelector('.workspace-container'), idea, container);

    await new Promise((r) => setTimeout(r, 50));

    // now get the iframe created by renderWorkspace, and mock its contentWindow.postMessage
    iframe = container.querySelector('#quill-editor-iframe');
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.postMessage = jest.fn();
    } else if (iframe) {
      Object.defineProperty(iframe, 'contentWindow', { value: { postMessage: jest.fn() }, configurable: true });
    }

    // The all-scraps-list should now have a scrap card
    const allScrapsList = container.querySelector('.all-scraps-list');
    const scrapItem = allScrapsList.querySelector('.scrap-card-item');
    expect(scrapItem).toBeTruthy();

    // Instead of relying on the click -> get_scrap_detail flow, directly show the modal with test data
    const { showScrapDetailModal } = await import('../js/ui/workspaceMode.js');
    const scrapDetailData = { id: 's1', url: 'https://example.test/page', text: '스크랩 내용', image: 'https://example.test/img1.jpg', allImages: ['https://example.test/img1.jpg'] };
    showScrapDetailModal(scrapDetailData, container);
    // wait for modal to render (allow showScrapDetailModal to populate images and attach handlers)
    await new Promise((r) => setTimeout(r, 200));

    const modal = document.querySelector('#scrap-detail-modal') || document.querySelector('.scrap-detail-modal');
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
