import { jest } from '@jest/globals';

describe('Workspace action buttons dynamic update', () => {
  beforeEach(() => {
    jest.resetModules();
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
});
