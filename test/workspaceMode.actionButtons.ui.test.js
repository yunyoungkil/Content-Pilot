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

    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-thumbnail-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#delete-draft-in-workspace')).toBeTruthy();
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeFalsy();

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
    await new Promise((r) => setTimeout(r, 120));
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
    await new Promise((r) => setTimeout(r, 20));
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
    await new Promise((r) => setTimeout(r, 20));
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });
});
