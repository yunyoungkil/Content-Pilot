import { jest } from '@jest/globals';

describe('Publish-info copy buttons and generate placement', () => {
  beforeEach(() => {
    jest.resetModules();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    chrome.runtime.sendMessage = jest.fn((msg, cb) => cb && cb({ channels: { myChannels: { blogs: [{ inputUrl: 'https://example.test' }] } } }));
  });

  test('copy buttons hidden until AI draft exists; generate and checkbox appear in publish-info when no draft', async () => {
    const { renderWorkspace, updateWorkspaceActionButtons } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'copy-test-1', title: 'Copy Button Test', status: 'ideas' };
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderWorkspace(container, idea);
    const workspaceEl = container.querySelector('.workspace-container');

    // Ensure initial update with no draft places generate/checkbox near copy-html
    await updateWorkspaceActionButtons(workspaceEl, false);
    let pubArea = workspaceEl.querySelector('#publish-info-content');
    // publish-info may not be present until showPublishInfo is called; ensure it's rendered
    if (!pubArea && typeof showPublishInfo === 'function') {
      showPublishInfo(workspaceEl, '', '', '', idea);
      pubArea = workspaceEl.querySelector('#publish-info-content');
    }
    const pubActions = pubArea && pubArea.querySelector('#publish-info-actions');

    const copyHtmlBtn = pubArea && pubArea.querySelector('#copy-html-btn');
    const copyTagsBtn = pubArea && pubArea.querySelector('#copy-tags-btn');

    // copy-html button should not exist before draft exists
    expect(pubArea.querySelector('#copy-html-btn')).toBeFalsy();
    if (copyTagsBtn) {
      expect(copyTagsBtn.style.display === 'none' || copyTagsBtn.style.display === '').toBeTruthy();
    }

    // generate button and checkbox should be present inside a .compose-thumbnail-controls wrapper
    expect(pubActions).toBeTruthy();
    // container should be visible (not hidden by styles)
    expect(pubActions.style.display !== 'none').toBeTruthy();
    const controls = pubActions.querySelector('.compose-thumbnail-controls');
    expect(controls).toBeTruthy();
    expect(controls.querySelector('#generate-draft-btn')).toBeTruthy();
    expect(controls.querySelector('#compose-thumbnail-text-checkbox')).toBeTruthy();
    // styles for generate and checkbox should match expectations
    const genBtn = controls.querySelector('#generate-draft-btn');
    // at minimum the generate button should flex like the controls
    expect(genBtn.style.cssText).toMatch(/flex:\s*1 1 0%/);
    const input = controls.querySelector('#compose-thumbnail-text-checkbox');
    expect(input).toBeTruthy();
    expect(input.title).toBe('썸네일 텍스트 오버레이 적용');
    expect(input.style.margin).toMatch(/8px/);

    // Now simulate having a draft
    // update global idea data so showPublishInfo can detect a draft
    window.__cp_workspace_idea_data = window.__cp_workspace_idea_data || {};
    window.__cp_workspace_idea_data.workspace = window.__cp_workspace_idea_data.workspace || {};
    window.__cp_workspace_idea_data.workspace.draft = 'This is a meaningful draft.';
    await updateWorkspaceActionButtons(workspaceEl, true);
    // re-query buttons as the publish-info panel may have been re-rendered
    const copyHtmlBtnAfter = pubArea.querySelector('#copy-html-btn');
    const copyTagsBtnAfter = pubArea.querySelector('#copy-tags-btn');
    // copy buttons should now be shown and copy-html should be inside publish actions
    expect(copyHtmlBtnAfter).toBeTruthy();
    expect(copyTagsBtnAfter).toBeTruthy();
    const pubActionsAfter = pubArea.querySelector('#publish-info-actions');
    expect(pubActionsAfter.contains(copyHtmlBtnAfter)).toBeTruthy();
    expect(copyHtmlBtnAfter.style.display === 'block' || copyHtmlBtnAfter.style.display === '').toBeTruthy();
    expect(copyTagsBtnAfter.style.display === 'inline-block' || copyTagsBtnAfter.style.display === '').toBeTruthy();

    // generate button removed from publish area
    expect(pubArea.querySelector('#generate-draft-btn')).toBeFalsy();
    // compose checkbox should be present in publish-info and positioned adjacent to the regenerate thumbnail button
    const regenThumbBtnAfter = pubArea.querySelector('#regenerate-thumbnail-btn');
    expect(regenThumbBtnAfter).toBeTruthy();
    const checkbox = pubArea.querySelector('#compose-thumbnail-text-checkbox');
    expect(checkbox).toBeTruthy();
    // ensure checkbox has tooltip/title set correctly
    expect(checkbox.title).toBe('썸네일 텍스트 오버레이 적용');
  });
});
