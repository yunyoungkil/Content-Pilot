const { applyDraftResponseToIdea, renderWorkspace } = require('../js/ui/workspaceMode.js');

describe('Workspace UI - AI metaDescription auto-apply', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    global.testHelpers.mockChromeRuntime();
  });

  test('applyDraftResponseToIdea applies metaDescription directly to description and persists via update_kanban_card', async () => {
    const idea = { id: 'card-save-meta', title: 'Save Meta', status: 'ideas', publishInfo: {} };
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    const meta = 'AI meta to be saved';
    const resp = { draft: '## content', metaDescription: meta };
    applyDraftResponseToIdea(idea, resp);

    // allow async message
    await global.testHelpers.waitForMs(20);

    const calls = chrome.runtime.sendMessage.mock.calls;
    const upd = calls.find((c) => c && c[0] && c[0].action === 'update_kanban_card');
    expect(upd).toBeTruthy();
    expect(upd[0].data.updates.description).toBe(meta);

    // UI should reflect description immediately
    const descEl = container.querySelector('#seo-description-input');
    expect(descEl).toBeTruthy();
    expect(String(descEl.value || '').trim()).toBe(meta);

    container.remove();
  });
});