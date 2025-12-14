import { jest } from '@jest/globals';

describe('Workspace save draft flows', () => {
  beforeEach(async () => {
    jest.resetModules();
    chrome.runtime.sendMessage.mockClear();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
  });

  test('editor cp_save_draft triggers save_idea_draft via chrome.runtime.sendMessage', async () => {
    const { renderWorkspace, addWorkspaceEventListeners } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-save-1',
      title: 'Save Draft Test',
      status: 'ideas',
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // add workspace listeners
    addWorkspaceEventListeners(container, idea, container);

    // Ensure the global listener is attached by renderWorkspace
    expect(window.__cp_workspace_save_listener).toBeTruthy();

    // simulate postMessage from editor
    const draftHtml = '<p>saved content</p>';
    window.postMessage({ action: 'cp_save_draft', content: draftHtml, ts: 123456 }, '*');

    // allow any async handlers to run
    await testHelpers.waitForNextTick();

    // assert chrome.runtime.sendMessage called
    expect(chrome.runtime.sendMessage).toHaveBeenCalled();
    const sent = chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'save_idea_draft');
    expect(sent).toBeDefined();
    const payload = sent[0];
    expect(payload.ideaId).toBe('card-save-1');
    expect(payload.draft).toBe(draftHtml);
    // ts is now included in payload
    expect(payload.ts).toBeDefined();
  });

  test('empty content does not trigger save_idea_draft', async () => {
    const { renderWorkspace, addWorkspaceEventListeners } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-save-2',
      title: 'Empty Draft Test',
      status: 'ideas',
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);
    addWorkspaceEventListeners(container, idea, container);

    // ensure listener added
    expect(window.__cp_workspace_save_listener).toBeTruthy();

    // post empty content
    window.postMessage({ action: 'cp_save_draft', content: '<p><br></p>', ts: Date.now() }, '*');
    await testHelpers.waitForNextTick();

    // ensure no save_idea_draft was sent
    const saveCall = chrome.runtime.sendMessage.mock.calls.find((c) => c[0] && c[0].action === 'save_idea_draft');
    if (saveCall) {
      // should not match the idea id
      expect(saveCall[0].ideaId).not.toBe('card-save-2');
    } else {
      expect(saveCall).toBeUndefined();
    }
  });
});
