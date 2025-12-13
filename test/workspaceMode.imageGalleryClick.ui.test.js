import { jest } from '@jest/globals';

describe('Workspace image gallery click', () => {
  beforeEach(() => {
    jest.resetModules();
    // updateWorkspaceScraps uses the callback form of chrome.storage.local.get
    // so mock it to call the callback immediately with the activeChannelId
    chrome.storage.local.get.mockImplementation((key, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });
  });

  test('clicking gallery image triggers single insert (no duplicate listeners)', async () => {
    // Mock get_all_scraps response
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({
            success: true,
            scraps: [{ id: 's1', url: 'https://example.test/a.png', source: 'SCRAP' }],
          });
        return;
      }
      if (message && message.action === 'get_unified_gallery') {
        if (cb)
          cb({ success: true, images: [{ id: 'i1', url: 'https://example.test/a.png', source: 'SCRAP' }] });
        return;
      }
      if (cb) cb({ success: true });
    });

    const { renderWorkspace, updateWorkspaceScraps } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-1', title: 'Galler Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    // create editor iframe so sendCommand will postMessage
    const iframe = document.createElement('iframe');
    iframe.id = 'editor-iframe';
    // jsdom exposes contentWindow as a read-only getter — override via defineProperty
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: jest.fn() },
      configurable: true,
    });
    // ensure the editor iframe is inside the workspace container so
    // updateWorkspaceScraps' sendCommand finds it via workspaceEl.querySelector
    // (we'll append it into the workspace wrapper after it is created)

    // renderWorkspace might not create cp-workspace-container in this env,
    // so create a minimal workspace structure that updateWorkspaceScraps expects
    const workspaceWrapper = document.createElement('div');
    workspaceWrapper.className = 'cp-workspace-container';
    // add a minimal all-scraps-list so updateWorkspaceScraps will run the get_all_scraps path
    workspaceWrapper.innerHTML = `
      <div class="workspace-container">
        <div class="all-scraps-list"></div>
        <div id="resource-library-panel" class="workspace-column">
          <div class="resource-content-area image-gallery-area">
            <div class="image-gallery-grid"></div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(workspaceWrapper);

    // append iframe inside the workspace so sendCommand can postMessage
    workspaceWrapper.appendChild(iframe);

    // First update pass
    updateWorkspaceScraps(container, idea);
    // second update pass (simulate multiple refreshes)
    updateWorkspaceScraps(container, idea);

    // wait for async operations (allow render and async loadUnifiedGallery to complete)
    await new Promise((r) => setTimeout(r, 200));

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // ensure we actually queried unified gallery
    const calledForGallery = chrome.runtime.sendMessage.mock.calls.some(
      (c) => c[0] && c[0].action === 'get_unified_gallery'
    );
    expect(calledForGallery).toBeTruthy();

    // find the gallery grid image element(s)
    const thumbs = Array.from(workspaceEl.querySelectorAll('.image-gallery-grid .gallery-thumb'));
    // should render a single thumb for our single-image response
    expect(thumbs.length).toBe(1);
    const image = thumbs[0];
    expect(image).toBeTruthy();

    // simulate click
    image.click();

    // click triggers an 'insert-image' and a 'focus' message from one handler
    // ensure there is exactly one 'insert-image' message (no duplicate listeners)
    const calls = iframe.contentWindow.postMessage.mock.calls;
    const insertCalls = calls.filter((c) => c[0] && c[0].action === 'insert-image');
    expect(insertCalls.length).toBe(1);
    // and total postMessage calls should be 2 (insert-image + focus)
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledTimes(2);
  });
});
