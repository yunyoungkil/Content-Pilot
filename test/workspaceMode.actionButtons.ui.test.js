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

    // initial state: generate button present (wait for actions to render)
    async function waitForSelector(container, selector, timeout = 1000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el) return el;
        await new Promise((r) => setTimeout(r, 20));
      }
      return null;
    }
    await waitForSelector(container, '#generate-draft-btn');
    // generate may be placed near header or inside publish-info; check container first for robustness
    expect(container.querySelector('#generate-draft-btn') || workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();

    // simulate draft applied and update action buttons
    // ensure global idea data reflects a real draft so showPublishInfo
    window.__cp_workspace_idea_data = window.__cp_workspace_idea_data || {};
    window.__cp_workspace_idea_data.workspace = window.__cp_workspace_idea_data.workspace || {};
    window.__cp_workspace_idea_data.workspace.draft = 'This is a meaningful draft.';
    await updateWorkspaceActionButtons(workspaceEl, true);

    // generate button should be removed from workspace and regen/delete should appear in publish area
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeFalsy();

    const publishArea = workspaceEl.querySelector('#publish-info-content');
    expect(publishArea.querySelector('#regenerate-draft-btn')).toBeTruthy();
    expect(publishArea.querySelector('#regenerate-thumbnail-btn')).toBeTruthy();
    expect(publishArea.querySelector('#delete-draft-in-workspace')).toBeTruthy();

    // now clear draft and ensure it switches back (generate button reappears)
    await updateWorkspaceActionButtons(workspaceEl, false);

    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });

  test('regenerate/thumbnail/delete buttons hidden until meaningful draft exists', async () => {
    const { renderWorkspace, updateWorkspaceActionButtons } = await import(
      '../js/ui/workspaceMode.js'
    );

    const idea = { id: 'card-action-5', title: 'Regenerate Hidden Test', status: 'ideas' };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    const workspaceEl = container.querySelector('.workspace-container');
    expect(workspaceEl).toBeTruthy();

    let pubArea = workspaceEl.querySelector('#publish-info-content');
    // publish-info may not be present in this test harness; create a container
    // so the publish-info panel (and its actions) have a place to render into.
    if (!pubArea) {
      const pubAreaContainer = document.createElement('div');
      pubAreaContainer.id = 'publish-info-content';
      const publishAreaParent = workspaceEl.querySelector('#publish-info-area') || workspaceEl;
      publishAreaParent.appendChild(pubAreaContainer);
      pubArea = workspaceEl.querySelector('#publish-info-content');
    }
    // Ensure the actions container is created (generate button insertion creates it)
    await updateWorkspaceActionButtons(workspaceEl, false);
    const pubActions = pubArea && pubArea.querySelector('#publish-info-actions');
    // With no draft, regenerate/thumbnail/delete should not exist
    expect(pubActions).toBeTruthy();
    expect(pubActions.querySelector('#regenerate-draft-btn')).toBeFalsy();
    expect(pubActions.querySelector('#regenerate-thumbnail-btn')).toBeFalsy();
    expect(pubActions.querySelector('#delete-draft-in-workspace')).toBeFalsy();

    // Now simulate a meaningful draft
    window.__cp_workspace_idea_data = window.__cp_workspace_idea_data || {};
    window.__cp_workspace_idea_data.workspace = window.__cp_workspace_idea_data.workspace || {};
    window.__cp_workspace_idea_data.workspace.draft = 'Meaningful content to be treated as a draft';

    await updateWorkspaceActionButtons(workspaceEl, true);

    // buttons should now appear in publish area
    expect(pubArea.querySelector('#regenerate-draft-btn')).toBeTruthy();
    expect(pubArea.querySelector('#regenerate-thumbnail-btn')).toBeTruthy();
    expect(pubArea.querySelector('#delete-draft-in-workspace')).toBeTruthy();

    // the compose-thumbnail-text checkbox should be inside a controls wrapper
    const regenThumb = pubArea.querySelector('#regenerate-thumbnail-btn');
    const controls = regenThumb && regenThumb.parentElement;
    expect(controls).toBeTruthy();
    expect(controls.classList.contains('compose-thumbnail-controls')).toBeTruthy();

    const input = workspaceEl.querySelector('#compose-thumbnail-text-checkbox');
    expect(input).toBeTruthy();
    // tooltip should be provided via title attribute
    expect(input.title).toBe('썸네일 텍스트 오버레이 적용');
    // Basic structural checks (avoid brittle style assertions)
    expect(controls.contains(input)).toBeTruthy();
    expect(regenThumb.parentElement).toBe(controls);
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
    await waitForSelector(container, '#generate-draft-btn');
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
    await waitForSelector(container, '#generate-draft-btn');
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
    await waitForSelector(container, '#generate-draft-btn');
    expect(workspaceEl.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(workspaceEl.querySelector('#regenerate-draft-btn')).toBeFalsy();
  });
});
