import { jest } from '@jest/globals';

describe('Workspace thumbnail persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    // Ensure get_my_channels callback runs synchronously in tests
    chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (typeof cb === 'function')
        cb({ channels: { myChannels: { blogs: [{ inputUrl: 'https://example.test' }] } } });
    });
  });

  test('thumbnail button / preview persists when thumbnailUrls exist in publishInfo', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-thumb-1',
      title: 'Thumb Test',
      status: 'ideas',
      publishInfo: {
        thumbnailUrls: { url_16x9: 'https://example.test/16x9.png' },
      },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    // updateWorkspaceActionButtons is async; wait for thumbnail button to be created (polling)
    async function waitForSelector(container, selector, timeout = 8000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container, '#btn-create-thumbnail');

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // after initial render, thumbnail button should be present because thumbnailUrls exist
    const btn = workspaceEl.querySelector('#btn-create-thumbnail');
    expect(btn).toBeTruthy();

    // preview image should be present and have the expected src and alt attributes
    const previewImg = btn.querySelector('img');
    expect(previewImg).toBeTruthy();
    expect(previewImg.src).toBe('https://example.test/16x9.png');
    expect(previewImg.alt).toBe('Thumb Test');

    // simulate leaving and re-entering: re-render workspace with same idea object
    // ensure the thumbnail button still exists (persistence)
    renderWorkspace(container, idea);
    await waitForSelector(container, '#btn-create-thumbnail');
    expect(container.querySelector('#btn-create-thumbnail')).toBeTruthy();
    // cleanup this test's DOM
    container.remove();
  });

  test('does not create broken preview when thumbnail url is empty', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const ideaEmpty = {
      id: 'card-thumb-2',
      title: 'Empty Thumb Test',
      status: 'ideas',
      publishInfo: {
        thumbnailUrls: { url_16x9: '' },
      },
    };

    const container2 = document.createElement('div');
    document.body.appendChild(container2);

    renderWorkspace(container2, ideaEmpty);

    // wait for thumbnail button to appear (polling for robustness)
    async function waitForSelector(container, selector, timeout = 2000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container2, '#btn-create-thumbnail');

    const workspaceEl2 = container2.querySelector('.workspace-container');
    expect(workspaceEl2).toBeTruthy();

    // button exists but there should be no <img> preview appended when URL is empty
    const btn2 = workspaceEl2.querySelector('#btn-create-thumbnail');
    expect(btn2).toBeTruthy();
    expect(btn2.querySelector('img')).toBeFalsy();
    container2.remove();
  });

  test('compose-thumbnail-text-checkbox appears and respects stored state', async () => {
    // Simulate stored preference: text overlay should be ON
    chrome.storage.local.get = jest.fn((key) => {
      if (key === 'composeThumbnailText') return Promise.resolve({ composeThumbnailText: true });
      return Promise.resolve({ activeChannelId: 'channel-1' });
    });

    const { renderWorkspace, updateWorkspaceActionButtons } = await import('../js/ui/workspaceMode.js');

    const ideaWithDraft = {
      id: 'card-draft-1',
      title: 'Draft Checkbox Test',
      status: 'ideas',
      draftContent: 'This is a real draft content that is meaningful',
    };

    const container3 = document.createElement('div');
    document.body.appendChild(container3);

    renderWorkspace(container3, ideaWithDraft);

    const workspaceEl = container3.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // Force an update to ensure checkbox logic runs after our mocked storage value
    await updateWorkspaceActionButtons(workspaceEl, true);

    // Ensure the checkbox exists and regenerate actions are available in publish-info panel
    const checkbox = workspaceEl.querySelector('#compose-thumbnail-text-checkbox');
    expect(checkbox).toBeTruthy();
    // Should reflect the persisted setting from storage.get
    expect(checkbox.checked).toBe(true);
    const publishArea = workspaceEl.querySelector('#publish-info-content');
    expect(publishArea.querySelector('#regenerate-draft-btn')).toBeTruthy();

    // cleanup
    container3.remove();
  });

  test('compose-thumbnail-text-checkbox is placed adjacent to regenerate-draft-btn', async () => {
    chrome.storage.local.get.mockResolvedValueOnce({
      composeThumbnailText: false,
      activeChannelId: 'channel-1',
    });
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const ideaWithDraft = {
      id: 'card-draft-2',
      title: 'Draft Checkbox Position Test',
      status: 'ideas',
      draftContent: 'Meaningful content here',
    };

    const container4 = document.createElement('div');
    document.body.appendChild(container4);

    renderWorkspace(container4, ideaWithDraft);
    const workspaceEl4 = container4.querySelector('.workspace-container');
    expect(workspaceEl4).toBeTruthy();

    // Force update to ensure buttons and checkbox are rendered
    const { updateWorkspaceActionButtons } = await import('../js/ui/workspaceMode.js');
    await updateWorkspaceActionButtons(workspaceEl4, true);

    const publishArea = workspaceEl4.querySelector('#publish-info-content');
    const regenBtn = publishArea.querySelector('#regenerate-draft-btn');
    expect(regenBtn).toBeTruthy();

    // wrapper should be the first child in the publish-info button container
    const container = regenBtn.parentNode;
    const firstChild = container.firstElementChild;
    expect(firstChild).toBeTruthy();
    expect(firstChild.id).toBe('compose-thumbnail-text-wrapper');

    container4.remove();
  });
});
