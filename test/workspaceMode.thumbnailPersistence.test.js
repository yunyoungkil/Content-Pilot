import { jest } from '@jest/globals';

describe('Thumbnail persistence across workspace render', () => {
  beforeEach(() => {
    jest.resetModules();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test('renders thumbnail button when publishInfo.thumbnailUrls exists on ideaData', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'thumb-1',
      title: 'Thumb Test',
      status: 'ideas',
      publishInfo: { thumbnailUrls: { url_16x9: 'https://example.test/a.jpg' } },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // renderThumbnailButton may run as part of renderWorkspace; ensure button exists
    const btn = workspaceEl.querySelector('#btn-create-thumbnail');
    expect(btn).toBeTruthy();
  });

  test('syncs top-level thumbnailUrls into publishInfo and renders button', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'thumb-2',
      title: 'Thumb Test 2',
      status: 'ideas',
      thumbnailUrls: { url_16x9: 'https://example.test/b.jpg' },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // publishInfo should be populated with thumbnailUrls and button shown
    expect(idea.publishInfo).toBeTruthy();
    expect(idea.publishInfo.thumbnailUrls).toBeTruthy();
    const btn = workspaceEl.querySelector('#btn-create-thumbnail');
    expect(btn).toBeTruthy();
  });
});
