import { jest } from '@jest/globals';

describe('Workspace action buttons dynamic update', () => {
  beforeEach(() => {
    jest.resetModules();
    // reset potentially leaked global TUI/workspace flags
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_tui_shadow_listener_attached = false;
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    // Ensure get_my_channels callback runs synchronously in tests
    chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (typeof cb === 'function')
        cb({ channels: { myChannels: { blogs: [{ inputUrl: 'https://example.test' }] } } });
    });
  });

  test('generate button replaced by regenerate + delete when draft exists', async () => {
    const { renderWorkspace, updateWorkspaceActionButtons } = await import(
      '../js/ui/workspaceMode.js'
    );

    const idea = { id: 'card-action-1', title: 'Action Test', status: 'ideas' };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // initial state: generate button present
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();

    // simulate draft applied and update action buttons
    await updateWorkspaceActionButtons(workspaceEl, true);

    // regenerate/delete buttons should be moved out of the main action bar
    const buttonContainer = workspaceEl.querySelector('#workspace-action-buttons');
    expect(buttonContainer.querySelector('#regenerate-draft-btn')).toBeFalsy();
    expect(buttonContainer.querySelector('#regenerate-thumbnail-btn')).toBeFalsy();
    expect(buttonContainer.querySelector('#delete-draft-in-workspace')).toBeFalsy();
    expect(buttonContainer.querySelector('#generate-draft-btn')).toBeFalsy();

    const publishArea = workspaceEl.querySelector('#publish-info-content');
    expect(publishArea.querySelector('#regenerate-draft-btn')).toBeTruthy();
    expect(publishArea.querySelector('#regenerate-thumbnail-btn')).toBeTruthy();
    expect(publishArea.querySelector('#delete-draft-in-workspace')).toBeTruthy();

    // now clear draft and ensure it switches back
    await updateWorkspaceActionButtons(workspaceEl, false);

    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });

  test('empty/placeholder draft is treated as no draft (generate button remains)', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-action-2', title: 'Empty Draft Test', status: 'ideas', workspace: { draft: '<p><br></p>' } };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // placeholder draft should not be treated as a real draft
    async function waitForSelector(container, selector, timeout = 1000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container, '#workspace-action-buttons');
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });

  test('link-only or markdown-link-only draft is treated as no draft', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-action-3',
      title: 'Link Only Draft Test',
      status: 'ideas',
      workspace: { draft: '[Example](https://example.com)' },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // link-only content should not be treated as a real draft
    async function waitForSelector(container, selector, timeout = 1000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container, '#workspace-action-buttons');
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });

  test('draft object with only status metadata should not be treated as a draft', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-action-4',
      title: 'Status-Only Draft Test',
      status: 'ideas',
      workspace: { draft: { briefingStatus: 'done', briefingCompletedAt: Date.now() } },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);

    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    // object-only draft should not be considered as having content
    async function waitForSelector(container, selector, timeout = 1000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container, '#workspace-action-buttons');
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });
});
