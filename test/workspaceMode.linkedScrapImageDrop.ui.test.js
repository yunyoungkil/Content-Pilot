import { jest } from '@jest/globals';

describe('Workspace drop image into already linked scrap', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
  });

  test('dropping an image that belongs to an already-linked scrap updates linked scrap display/gallery', async () => {
    let linkedCall = null;
    let addImageCall = null;
    let updateCardCall = null;
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          setTimeout(() => cb({
            success: true,
            scraps: [
              { id: 'scrap-1', text: 'Scrap One', image: '', allImages: [], url: 'https://example.test/page', tags: [] },
            ],
          }), 0);
        return;
      }
      if (message && message.action === 'get_scrap_detail') {
        if (cb) setTimeout(() => cb({ success: true, data: { id: 'scrap-1', text: 'Scrap One', image: '', allImages: [], url: 'https://example.test/page' } }), 0);
        return;
      }
      if (message && message.action === 'link_scrap_to_idea') {
        linkedCall = message;
        if (cb) setTimeout(() => cb({ success: true }), 0);
        return;
      }
      if (message && message.action === 'add_image_to_scrap') {
        addImageCall = message;
        // simulate DB update returning allImages
        if (cb) setTimeout(() => cb({ success: true, allImages: [imageUrl] }), 0);
        return;
      }
      if (message && message.action === 'get_unified_gallery') {
        if (cb) setTimeout(() => cb({ success: true, images: [] }), 0);
        return;
      }
      if (cb) setTimeout(() => cb({ success: true }), 0);
    });

    const { renderWorkspace, updateWorkspaceScraps, addWorkspaceEventListeners, showScrapDetailModal } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'idea-4', title: 'Linked Scrap Image Drop', status: 'ideas', linkedScraps: ['scrap-1'] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    await new Promise((r) => setTimeout(r, 50));

    updateWorkspaceScraps(container, idea);
    // small delay to avoid race with module initialization in tests
    await new Promise((r) => setTimeout(r, 250));
    addWorkspaceEventListeners(container.querySelector('.workspace-container'), idea, container);
    await new Promise((r) => setTimeout(r, 200));

    // Show scrap detail modal and simulate drag of an image from it
    const imageUrl = 'https://example.test/newimg.jpg';
    const scrapDetailData = { id: 'scrap-1', text: 'Scrap One', image: imageUrl, allImages: [imageUrl] };
    showScrapDetailModal(scrapDetailData, container);
    await new Promise((r) => setTimeout(r, 100));

    const modal = document.querySelector('#scrap-detail-modal') || document.querySelector('.scrap-detail-modal');
    expect(modal).toBeTruthy();
    const wrap = modal.querySelector('#scrap-detail-images > div');
    expect(wrap).toBeTruthy();

    // simulate dragstart
    const dt = { data: {}, setData(k, v) { this.data[k] = v; }, getData(k) { return this.data[k]; }, effectAllowed: '' };
    const dragStartEvt = new Event('dragstart', { bubbles: true });
    dragStartEvt.dataTransfer = dt;
    wrap.dispatchEvent(dragStartEvt);

    // ensure data includes application/json
    expect(dt.getData('application/json')).toBeTruthy();

    // drop onto linked-scraps list
    const linkedList = container.querySelector('.linked-scraps-list');
    const dropEvt = new Event('drop', { bubbles: true });
    dropEvt.dataTransfer = dt;
    linkedList.dispatchEvent(dropEvt);

    await new Promise((r) => setTimeout(r, 200));

    // linked scrap item should exist and should show the new image
    const linkedCard = linkedList.querySelector('[data-scrap-id="scrap-1"]');
    expect(linkedCard).toBeTruthy();
    const linkedCardImg = linkedCard.querySelector('.scrap-card-img-wrap img');
    expect(linkedCardImg).toBeTruthy();
    expect(linkedCardImg.src).toContain('newimg.jpg');
    expect(linkedCard.classList.contains('has-thumbnail')).toBeTruthy();

    // verify add_image_to_scrap was called
    expect(addImageCall).toBeTruthy();
    expect(addImageCall.action).toBe('add_image_to_scrap');
    expect(addImageCall.data.scrapId).toBe('scrap-1');

    // update_kanban_card should have been requested to persist linkedScrapsData
    // There may be multiple messages; search mock calls
    const sentMessages = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]);
    const foundUpdate = sentMessages.find((m) => m && m.action === 'update_kanban_card');
    expect(foundUpdate).toBeTruthy();
    expect(foundUpdate.data).toBeTruthy();
    expect(foundUpdate.data.cardId).toBe('idea-4');

    // gallery should now contain the image as well (resource-library panel)
    const workspaceEl = container.querySelector('.workspace-container');
    const imageGalleryGrid = workspaceEl.querySelector('.image-gallery-grid');
    expect(imageGalleryGrid).toBeTruthy();
    const addedThumb = imageGalleryGrid.querySelector('[data-image-url="https://example.test/newimg.jpg"]');
    expect(addedThumb).toBeTruthy();

    container.remove();
  });
});
