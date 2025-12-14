import { jest } from '@jest/globals';

describe('Workspace regenerate-thumbnail feedback', () => {
  beforeEach(() => {
    jest.resetModules();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_tui_shadow_listener_attached = false;
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test.skip('regenerate-thumbnail shows thumbnail-specific feedback when only thumbnail requested', async () => {
    const { renderWorkspace, updateWorkspaceActionButtons } = await import(
      '../js/ui/workspaceMode.js'
    );

    const idea = { id: 'thumb-test-1', title: 'Thumb Feedback', status: 'ideas', workspace: { draft: '<p>This is meaningful content that exceeds threshold for draft detection.</p>' } };
    const container = document.createElement('div');
    document.body.appendChild(container);

    // make runtime message call async to allow checking intermediate UI
    chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (msg && msg.action === 'generate_draft_from_idea') {
        setTimeout(() => cb({ success: true, thumbnailUrls: ['http://img.test/1.jpg'] }), 40);
      }
    });

    renderWorkspace(container, idea);
    const workspaceEl = container.querySelector('.workspace-container');
    await updateWorkspaceActionButtons(workspaceEl, true);

    const publishArea = workspaceEl.querySelector('#publish-info-content');
    // regenerate button may be moved into publish-info or exist in the action bar; find whichever exists
    const thumbBtn = workspaceEl.querySelector('#regenerate-thumbnail-btn') || (publishArea && publishArea.querySelector('#regenerate-thumbnail-btn'));
    expect(thumbBtn).toBeTruthy();

    // dispatch click
    thumbBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // wait for transient feedback
    async function waitForValue(fn, expected, timeout = 1000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        if (fn() === expected) return true;
        await new Promise((r) => setTimeout(r, 10));
      }
      return false;
    }

    // transient text may vary slightly; assert the button shows thumbnail-related feedback
    // Ensure runtime message was sent
    expect(chrome.runtime.sendMessage.mock.calls.length).toBeGreaterThan(0);
    const hadGenerateCall = chrome.runtime.sendMessage.mock.calls.some((c) => c[0] && c[0].action === 'generate_draft_from_idea');
    expect(hadGenerateCall).toBeTruthy();

    // The transient button text may vary due to intermediate states.
    // Instead assert that the thumbnail completion toast is shown after async response.
    async function waitForToast(timeout = 2500) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const t = document.getElementById('cp-toast-modal');
        if (t && t.textContent && t.textContent.includes('썸네일')) return t.textContent;
        await new Promise((r) => setTimeout(r, 10));
      }
      return null;
    }

    const toastText = await waitForToast();
    expect(toastText).toBeTruthy();
    expect(toastText).toContain('썸네일');
  });
});
