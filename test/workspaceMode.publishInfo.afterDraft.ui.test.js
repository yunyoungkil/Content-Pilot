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

    // small wait and assert that publish-info shows updated seoTitle
    await global.testHelpers.waitForMs(50);
    const seoInput = container.querySelector('#seo-title-input');
    expect(seoInput).toBeTruthy();
    expect(seoInput.value).toBe('SEO From Draft');
  });
});
