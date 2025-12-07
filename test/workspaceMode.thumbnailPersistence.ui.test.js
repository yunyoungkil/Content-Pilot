import { jest } from '@jest/globals';

describe('Workspace thumbnail persistence', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
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
    await new Promise((resolve) => setTimeout(resolve, 50));

    const workspaceEl2 = container2.querySelector('.workspace-container');
    expect(workspaceEl2).toBeTruthy();

    // button exists but there should be no <img> preview appended when URL is empty
    const btn2 = workspaceEl2.querySelector('#btn-create-thumbnail');
    expect(btn2).toBeTruthy();
    expect(btn2.querySelector('img')).toBeFalsy();
    container2.remove();
  });
});
