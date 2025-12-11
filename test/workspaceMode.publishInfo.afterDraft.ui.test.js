import { jest } from '@jest/globals';

describe('Workspace UI - publish info after draft generation', () => {
  beforeEach(() => {
    jest.resetModules();
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
    await global.testHelpers.waitForMs(250);
    const initialSeo = container.querySelector('#seo-title-input');
    expect(initialSeo).toBeTruthy();
    expect(initialSeo.value).toBe('');

    // apply a draft response that contains seoTitle
    const response = { draft: '## content', seoTitle: 'SEO From Draft' };
    applyDraftResponseToIdea(idea, response);

    // Poll until the seo-title input reflects the draft response
    async function waitForValue(selector, expected, timeout = 2000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el && el.value === expected) return el;
        await global.testHelpers.waitForMs(30);
      }
      return null;
    }

    const seoInput = await waitForValue('#seo-title-input', 'SEO From Draft', 2000);
    expect(seoInput).toBeTruthy();
    expect(seoInput.value).toBe('SEO From Draft');
    container.remove();
  });
});
