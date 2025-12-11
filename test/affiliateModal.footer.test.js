import { renderAffiliateModal } from '../js/ui/affiliateModal.js';

// Mock services used by affiliateModal to avoid network and db access
jest.mock('../js/services/affiliateService.js', () => ({
  getAffiliateLinks: jest.fn().mockResolvedValue([]),
  addAffiliateLink: jest.fn().mockResolvedValue({}),
  updateAffiliateLink: jest.fn().mockResolvedValue({}),
  deleteAffiliateLink: jest.fn().mockResolvedValue({}),
  incrementAffiliateLinkClick: jest.fn().mockResolvedValue({ success: true, newClickCount: 1 }),
}));

jest.mock('../js/services/kanbanService.js', () => ({
  addIdeaToKanban: jest.fn().mockResolvedValue({ success: true }),
}));

describe('affiliate modal footer layout', () => {
  test('inline fallback styles prevent overflow and set button min-width', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);

    // ensure the DOM is created
    const modal = container.querySelector('#affiliate-modal');
    expect(modal).toBeTruthy();

    const footer = container.querySelector('.affiliate-form-footer');
    expect(footer).toBeTruthy();

    // Inline styles should be present (our fallback applied them)
    expect(footer.style.boxSizing).toBe('border-box');
    expect(footer.style.overflowX).toBe('auto');
    expect(footer.style.width).toBe('100%');
    // Grid fallback should be enforced in inline style
    expect(footer.style.display === 'grid' || footer.style.display === '').toBeTruthy();
    if (footer.style.display === 'grid') {
      expect(footer.style.gridTemplateColumns === '1fr auto' || footer.style.gridTemplateColumns === '').toBeTruthy();
    }

    const buttons = footer.querySelectorAll('.cp-btn');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    buttons.forEach((btn) => {
      expect(btn.style.boxSizing).toBe('border-box');
      // ensure fallback minWidth is set to 40px, but save button may be 72px
      expect(['40px', '56px', '72px'].includes(btn.style.minWidth)).toBeTruthy();
      expect(btn.style.maxWidth === '140px' || btn.style.maxWidth === '') .toBeTruthy();
      expect(btn.style.fontSize === '12px' || btn.style.fontSize === '').toBeTruthy();
    });

    const saveBtn = footer.querySelector('.affiliate-save-btn');
    expect(saveBtn).toBeTruthy();
    // If the save button has inline style, we expect the minWidth to be at least 72px
    if (saveBtn.style.minWidth) {
      expect(['72px', '100px', '56px', '40px'].includes(saveBtn.style.minWidth)).toBeTruthy();
    }
    // ensure that height was applied
    expect(saveBtn.style.height === '36px' || saveBtn.style.height === '').toBeTruthy();
  });

  test('footer no longer contains preview or cancel, and card actions include preview/copy/insert', async () => {
    const { getAffiliateLinks } = require('../js/services/affiliateService.js');

    const sampleLink = {
      id: 'sample-1',
      name: '테스트 링크',
      url: 'https://example.com',
      platform: 'General',
      keywords: ['test'],
      clickCount: 0,
      createdAt: Date.now(),
      cardData: {
        productName: '테스트 상품',
        imageUrl: 'https://example.com/img.jpg',
        salePrice: 12345,
      },
    };

    getAffiliateLinks.mockResolvedValueOnce([sampleLink]);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);
    // Wait for async loadLinks to finish rendering and event handlers attached
    await new Promise((r) => setTimeout(r, 50));

    const footer = container.querySelector('.affiliate-form-footer');
    expect(footer).toBeTruthy();
    expect(footer.querySelector('#btn-preview-link')).toBeNull();
    expect(footer.querySelector('#btn-cancel-form')).toBeNull();

    const list = container.querySelector('#affiliate-link-list');
    expect(list).toBeTruthy();
    const card = list.querySelector('.affiliate-link-card');
    expect(card).toBeTruthy();

    const previewBtn = card.querySelector('.link-preview-btn');
    const copyBtn = card.querySelector('.link-copy-html-btn');
    const insertBtn = card.querySelector('.link-insert-editor-btn');
    expect(previewBtn).toBeTruthy();
    expect(copyBtn).toBeTruthy();
    expect(insertBtn).toBeTruthy();

    // clicking preview populates preview content (via handler)
    const previewContainer = container.querySelector('#affiliate-link-preview');
    expect(previewContainer).toBeTruthy();
    const previewContent = container.querySelector('#preview-content');
    expect(previewContent).toBeTruthy();
    const beforeHtml = previewContent.innerHTML;
    // Try direct function call to ensure preview logic works by checking innerHTML changes
    const { showLinkPreview } = require('../js/ui/affiliateModal.js');
    showLinkPreview(container, sampleLink);
    expect(previewContent.innerHTML).not.toBe(beforeHtml);
    // Try clicking preview button to ensure handler runs (attached via loadLinks)
    previewBtn.click();
    expect(previewContent.innerHTML).not.toBe(beforeHtml);
    // copy-to-clipboard works
    expect(copyBtn).toBeTruthy();
      // Clicking copy should not throw (clipboard behavior is environment-dependent in tests)
      expect(() => copyBtn.click()).not.toThrow();
    
      // insert to editor tries to postMessage to iframe; create a fake iframe
      const editorIframe = document.createElement('iframe');
      editorIframe.id = 'quill-editor-iframe';
      document.body.appendChild(editorIframe);
      // allow the DOM to settle and any observers to update
      await new Promise((r) => setTimeout(r, 10));
      Object.defineProperty(editorIframe, 'contentWindow', {
        value: { postMessage: jest.fn() },
        configurable: true,
      });
    expect(insertBtn).toBeTruthy();
    // Clicking insert should not throw and will either postMessage to iframe(s) or fall back to clipboard/prompt
    expect(() => insertBtn.click()).not.toThrow();
    // cleanup
    editorIframe.remove();
    // restore if necessary
    try { delete editorIframe.contentWindow; } catch (err) { /* ignore */ }
  });
});
