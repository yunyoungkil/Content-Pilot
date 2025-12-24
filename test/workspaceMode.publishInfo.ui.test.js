import { jest } from '@jest/globals';

describe('Workspace UI - publish info SEO title', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    // Ensure runtime sendMessage callbacks are handled by tests
    global.testHelpers.mockChromeRuntime();
  });

  test('renders SEO title from publishInfo when top-level seoTitle is missing', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-seo-1',
      title: 'SEO Publish Test',
      status: 'ideas',
      // top-level seoTitle empty but publishInfo has seoTitle
      seoTitle: '',
      publishInfo: {
        seoTitle: 'SEO Title from PublishInfo',
        permalink: 'test-permalink',
        tags: ['tag1', 'tag2'],
      },
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // wait for initial render / async handlers to settle then click publish-info tab to force area refresh
    await global.testHelpers.waitForMs(600);
    // click publish-info tab to force the area to refresh and call showPublishInfo
    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    expect(tabBtn).toBeTruthy();
    tabBtn.click();
    // short delay to allow click handler -> showPublishInfo to update DOM
    await global.testHelpers.waitForMs(200);
    // debug: dump publish-info-area + whole container to understand why the panel didn't appear
    // eslint-disable-next-line no-console
    console.log('[TEST] publish-info-area HTML:', container.querySelector('#publish-info-area')?.innerHTML);
    // eslint-disable-next-line no-console
    console.log('[TEST] full container HTML:', container.innerHTML);

    // Wait until the seo-title input is present with the expected value (poll to be robust)
    async function waitForValue(selector, expected, timeout = 2000) {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const el = container.querySelector(selector);
        if (el && el.value === expected) return el;
        await global.testHelpers.waitForMs(50);
      }
      return null;
    }

    const seoInput = await waitForValue('#seo-title-input', 'SEO Title from PublishInfo', 5000);
    expect(seoInput).toBeTruthy();
    expect(seoInput.value).toBe('SEO Title from PublishInfo');
    // Ensure requested style removals are effective
    const panel = container.querySelector('.publish-info-panel');
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('style')).not.toContain('align-items: flex-start');

    container.remove();
  });

  test('does NOT prefill SEO description from top-level description when creating an idea', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-desc-1',
      title: 'Desc Publish Test',
      status: 'ideas',
      // top-level description present but publishInfo.description is absent
      description: 'This is scrap text that should not prefill SEO description',
      publishInfo: {},
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    await global.testHelpers.waitForMs(600);
    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    expect(tabBtn).toBeTruthy();
    tabBtn.click();
    await global.testHelpers.waitForMs(200);

    const descEl = container.querySelector('#seo-description-input');
    expect(descEl).toBeTruthy();
    // textarea value should be empty since publishInfo.description is not set
    expect(String(descEl.value || '').trim()).toBe('');

    container.remove();
  });
});
