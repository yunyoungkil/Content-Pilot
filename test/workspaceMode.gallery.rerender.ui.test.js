import { jest } from '@jest/globals';

describe('Workspace gallery rerender robustness', () => {
  beforeEach(() => {
    jest.resetModules();
    // storage.get uses callback form
    chrome.storage.local.get.mockImplementation((k, cb) => {
      if (typeof cb === 'function') cb({ activeChannelId: 'channel-1' });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });

    // runtime.sendMessage stub: respond to get_all_scraps and get_unified_gallery
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({ success: true, scraps: [{ id: 's1', url: 'https://example.test/a.png', source: 'SCRAP' }] });
        return;
      }
      if (message && message.action === 'get_unified_gallery') {
        if (cb)
          cb({ success: true, images: [{ id: 'i1', url: 'https://example.test/a.png', source: 'SCRAP' }] });
        return;
      }
      if (cb) cb({ success: true });
    });
  });

  test('re-rendering gallery multiple times does not attach duplicate click listeners', async () => {
    const { updateWorkspaceScraps } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-1', title: 'Re-render Test', status: 'ideas', linkedScraps: [] };
    const container = document.createElement('div');
    document.body.appendChild(container);

    const workspaceWrapper = document.createElement('div');
    workspaceWrapper.className = 'cp-workspace-container';
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

    // create editor iframe so sendCommand will postMessage
    const iframe = document.createElement('iframe');
    iframe.id = 'editor-iframe';
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: jest.fn() },
      configurable: true,
    });
    // place the iframe inside the workspace
    workspaceWrapper.appendChild(iframe);

    // call update multiple times to simulate re-renders
    updateWorkspaceScraps(container, idea);
    updateWorkspaceScraps(container, idea);
    updateWorkspaceScraps(container, idea);

    // allow async gallery load to complete
    await new Promise((r) => setTimeout(r, 200));

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // should have rendered a single gallery thumb
    const thumbs = Array.from(workspaceEl.querySelectorAll('.image-gallery-grid .gallery-thumb'));
    expect(thumbs.length).toBe(1);

    // Since the mocked gallery item does not have usedInDraft, badge should be absent
    const usedBadges = Array.from(workspaceEl.querySelectorAll('.image-gallery-grid .used-badge'));
    expect(usedBadges.length).toBe(0);

    // Now mock a used-in-draft scrap and re-render to verify the badge
    chrome.runtime.sendMessage.mockImplementation((message, cb) => {
      if (message && message.action === 'get_all_scraps') {
        if (cb)
          cb({ success: true, scraps: [{ id: 's1', image: 'https://example.test/a.png', usedInDraft: true, originData: { usedInDraft: true } }] });
        return;
      }
      if (message && message.action === 'get_unified_gallery') {
        if (cb) cb({ success: true, images: [] });
        return;
      }
      if (cb) cb({ success: true });
    });

    // re-render (this will fetch get_all_scraps)
    updateWorkspaceScraps(container, idea);
    await new Promise((r) => setTimeout(r, 200));

    // debug: output gallery HTML
    // eslint-disable-next-line no-console
    console.log('[TEST DEBUG] imageGalleryGrid innerHTML:', workspaceEl.querySelector('.image-gallery-grid').innerHTML);

    const usedBadgesAfter = Array.from(workspaceEl.querySelectorAll('.image-gallery-grid .used-badge'));
    expect(usedBadgesAfter.length).toBe(1);

    // click once -> should send one insert-image + focus
    thumbs[0].click();
    const calls = iframe.contentWindow.postMessage.mock.calls;
    const insertCalls = calls.filter((c) => c[0] && c[0].action === 'insert-image');
    expect(insertCalls.length).toBe(1);

    // click again -> should add exactly one more insert-image (no duplicate handlers)
    thumbs[0].click();
    const callsAfter = iframe.contentWindow.postMessage.mock.calls;
    const insertCallsAfter = callsAfter.filter((c) => c[0] && c[0].action === 'insert-image');
    expect(insertCallsAfter.length).toBe(2);
  }, 5000);
});