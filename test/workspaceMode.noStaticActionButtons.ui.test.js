import { jest } from '@jest/globals';

describe('Workspace static action buttons absence', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (typeof cb === 'function') cb({ channels: { myChannels: { blogs: [{ inputUrl: 'https://example.test' }] } } });
    });
  });

  test('does not render static #workspace-action-buttons by default', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-static-1',
      title: 'No Static Container Test',
      status: 'ideas',
    };

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // Ensure the static element is not present in the DOM
    const staticEl = workspaceEl.querySelector('#workspace-action-buttons');
    expect(staticEl).toBeFalsy();

    container.remove();
  });
});
