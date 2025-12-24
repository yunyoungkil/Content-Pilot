import { jest } from '@jest/globals';

describe('Workspace UI - publish info after draft generation', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.resetAllMocks();
    if (window.__cp_tui_global_listener_attached) window.__cp_tui_global_listener_attached = false;
    if (window.__cp_tui_listener_attached) window.__cp_tui_listener_attached = false;
    window.__cp_workspace_idea_id = undefined;
    window.__cp_workspace_idea_data = undefined;
    window.__cp_tui_shadow_listener_attached = false;
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    global.testHelpers.mockChromeRuntime();
  });

  test('shows seoTitle in publish-info after draft response is applied', async () => {
    const { renderWorkspace, applyDraftResponseToIdea } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-draft-1',
      title: 'Draft Publish Test',
      status: 'ideas',
      seoTitle: '',
      publishInfo: {},
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // ensure initial render contains empty seo input (we now always render the field)
    await global.testHelpers.waitForMs(500);
    const initialSeo = container.querySelector('#seo-title-input');
    expect(initialSeo).toBeTruthy();
    expect(initialSeo.value).toBe('');

    // apply a draft response that contains seoTitle
    const response = { draft: '## content', seoTitle: 'SEO From Draft' };
    applyDraftResponseToIdea(idea, response);

    // Poll until the seo-title input reflects the draft response
    async function waitForValue(selector, expected, timeout = 4000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el && el.value === expected) return el;
        await global.testHelpers.waitForMs(50);
      }
      return null;
    }

    const seoInput = await waitForValue('#seo-title-input', 'SEO From Draft', 2000);
    expect(seoInput).toBeTruthy();
    expect(seoInput.value).toBe('SEO From Draft');

    // Now apply a response that includes an AI meta description suggestion
    const meta = 'AI generated meta summary for this draft.';
    const resp2 = { draft: '## content', metaDescription: meta };
    applyDraftResponseToIdea(idea, resp2);

    // DEBUG: dump publish area HTML (removed)

    // Wait for the suggested description area to show the AI suggestion
    async function waitForSuggestedText(expected, timeout = 2000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector('#ai-suggested-desc-text');
        if (el && el.textContent && el.textContent.trim() === expected) return el;
        await global.testHelpers.waitForMs(50);
      }
      return null;
    }

    const suggestedEl = await waitForSuggestedText(meta, 2000);
    // console.log('SUGGESTED EL:', suggestedEl);
    expect(suggestedEl).toBeTruthy();

    // Click apply and assert the description is saved and UI updated
    const applyBtn = container.querySelector('#apply-suggested-desc-btn');
    expect(applyBtn).toBeTruthy();

    // Clear previous sendMessage calls and simulate click
    chrome.runtime.sendMessage.mockClear();
    global.testHelpers.simulateClick(applyBtn);

    // allow async save to happen
    await global.testHelpers.waitForMs(50);

    const seoDesc = container.querySelector('#seo-description-input');
    expect(seoDesc).toBeTruthy();
    expect(seoDesc.value.trim()).toBe(meta);

    // ensure update_kanban_card was requested with the new description
    const calls = chrome.runtime.sendMessage.mock.calls;
    const updateCall = calls.find((c) => c && c[0] && c[0].action === 'update_kanban_card');
    expect(updateCall).toBeTruthy();
    expect(updateCall[0].data.updates.description).toBe(meta);

    container.remove();
  });
});
