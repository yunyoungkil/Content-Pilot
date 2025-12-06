import { renderAffiliateModal } from "../js/ui/affiliateModal.js";

// 모듈 내부에서 사용하는 서비스들 모킹하여 loadLinks가 안전하게 동작하게 함
jest.mock("../js/services/affiliateService.js", () => ({
  getAffiliateLinks: jest.fn().mockResolvedValue([]),
  addAffiliateLink: jest.fn().mockResolvedValue({}),
  updateAffiliateLink: jest.fn().mockResolvedValue({}),
  deleteAffiliateLink: jest.fn().mockResolvedValue({}),
  incrementAffiliateLinkClick: jest.fn().mockResolvedValue({ success: true, newClickCount: 1 }),
}));

jest.mock("../js/services/kanbanService.js", () => ({
  addIdeaToKanban: jest.fn().mockResolvedValue({ success: true }),
}));

// Mock AI service used by affiliateModal
jest.mock('../js/services/aiService.js', () => ({
  callGeminiAPI: jest.fn().mockResolvedValue(JSON.stringify({
    recommendedSearches: ['seo-auto-1', 'seo-auto-2'],
    longTailKeywords: ['seo-auto-long-1'],
    outline: ['섹션 1', '섹션 2']
  }))
}));

describe("affiliateModal close behavior", () => {
  test("clicking header close button hides modal", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    // 렌더링 (bindEvents 포함)
    renderAffiliateModal(container);

    // modal은 기본적으로 display:none 이므로 열어둔다
    const modal = container.querySelector("#affiliate-modal");
    expect(modal).toBeTruthy();
    modal.style.display = "block";

    const closeBtn = container.querySelector(
      ".cp-modal-close, .affiliate-close-btn"
    );
    expect(closeBtn).toBeTruthy();

    // 클릭 시 닫혀야 함
    closeBtn.click();
    expect(modal.style.display).toBe("none");
  });

  test("clicking backdrop hides modal and form", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);

    renderAffiliateModal(container);

    const modal = container.querySelector("#affiliate-modal");
    const form = container.querySelector("#affiliate-form-container");
    expect(modal).toBeTruthy();
    if (form) form.style.display = "block";

    modal.style.display = "block";
    const backdrop = container.querySelector(".cp-modal-backdrop");
    expect(backdrop).toBeTruthy();

    backdrop.click();

    expect(modal.style.display).toBe("none");
    if (form)
      expect(
        form.style.display === "none" || form.style.display === ""
      ).toBeTruthy();
  });

  test("renders card preview element when link has cardData", async () => {
    const { getAffiliateLinks } = require("../js/services/affiliateService.js");

    // prepare a link item with cardData
    const cardLink = {
      id: "test-1",
      platform: "Coupang",
      name: "테스트 상품",
      url: "https://example.com/item/1",
      createdAt: Date.now(),
      cardData: {
        productName: "테스트 상품 긴 이름",
        imageUrl: "https://example.com/img.jpg",
        salePrice: 12345,
      },
    };

    // make the mock return a single link for this test
    getAffiliateLinks.mockResolvedValueOnce([cardLink]);

    const container = document.createElement("div");
    document.body.appendChild(container);

    renderAffiliateModal(container);

    // wait for the async loadLinks to complete
    await new Promise((r) => setTimeout(r, 0));

    const preview = container.querySelector(".link-card-preview");
    expect(preview).toBeTruthy();
    const img = preview.querySelector("img");
    expect(img).toBeTruthy();
    expect(img.src).toContain("example.com/img.jpg");
  });

  test("link open button opens link in new tab and increments click count", async () => {
    // Mock window.open
    const mockWindowOpen = jest.fn();
    global.window.open = mockWindowOpen;

    // Mock affiliateService to return a link
    const mockGetAffiliateLinks = require("../js/services/affiliateService.js").getAffiliateLinks;
    const mockIncrementClick = require("../js/services/affiliateService.js").incrementAffiliateLinkClick;
    
    mockGetAffiliateLinks.mockResolvedValueOnce([{
      id: "test-link-1",
      name: "Test Link",
      url: "https://example.com",
      platform: "General",
      keywords: ["test"],
      clickCount: 0,
      createdAt: Date.now()
    }]);

    const container = document.createElement("div");
    document.body.appendChild(container);

    renderAffiliateModal(container);

    // wait for the async loadLinks to complete
    await new Promise((r) => setTimeout(r, 0));

    const openBtn = container.querySelector(".link-open-btn");
    expect(openBtn).toBeTruthy();
    expect(openBtn.title).toBe("링크 열기");

    // Click the open button
    openBtn.click();

    // Should open link in new tab
    expect(mockWindowOpen).toHaveBeenCalledWith("https://example.com", "_blank");

    // Should increment click count
    expect(mockIncrementClick).toHaveBeenCalledWith("test-link-1");
  });

  test("shift+click on card opens template selector and adds idea to kanban", async () => {
    const mockAddIdeaToKanban = require("../js/services/kanbanService.js").addIdeaToKanban;
    const mockGetAffiliateLinks = require("../js/services/affiliateService.js").getAffiliateLinks;
    
    mockGetAffiliateLinks.mockResolvedValueOnce([{
      id: "test-link-1",
      name: "Test Product",
      url: "https://example.com",
      platform: "Coupang",
      keywords: ["test", "product"],
      clickCount: 0,
      createdAt: Date.now(),
      cardData: {
        productName: "Test Product Name",
        salePrice: 10000,
        originalPrice: 12000,
        discountRate: 17,
        rating: 4.5,
        reviewCount: 100
      }
    }]);

    const container = document.createElement("div");
    document.body.appendChild(container);

    renderAffiliateModal(container);

    // wait for the async loadLinks to complete
    await new Promise((r) => setTimeout(r, 0));


    // Click the template button in card actions to open the template selector and add idea
    const templateBtn = container.querySelector('.link-template-btn');
    expect(templateBtn).toBeTruthy();
    templateBtn.click();

    // Wait for the modal and processing
    await new Promise((r) => setTimeout(r, 0));

    const templateCard = document.body.querySelector('#template-selector-modal .template-card[data-template-id="product-review"]');
    expect(templateCard).toBeTruthy();
    templateCard.click();
    await new Promise((r) => setTimeout(r, 0));

    // Should call addIdeaToKanban with converted idea data
    expect(mockAddIdeaToKanban).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "[리뷰] Test Product",
        description: expect.stringContaining("플랫폼: Coupang"),
        tags: expect.arrayContaining(["test", "product", "리뷰", "사용후기"]),
        url: "https://example.com",
        publishedUrl: "https://example.com",
        origin: expect.objectContaining({
          type: 'affiliate_link',
          platform: 'Coupang',
          affiliateLinkId: 'test-link-1'
        }),
        affiliateData: expect.objectContaining({
          platform: 'Coupang',
          salePrice: 10000,
          originalPrice: 12000,
          discountRate: 17
        }),
        template: expect.objectContaining({ id: 'product-review' })
      })
    );
  });

  test('AI generate and save stores recommendedSearches/longTail/outline and adds keywords', async () => {
    const { addAffiliateLink, getAffiliateLinks } = require('../js/services/affiliateService.js');
    const { callGeminiAPI } = require('../js/services/aiService.js');

    // Make link list empty so we can open add-form
    getAffiliateLinks.mockResolvedValueOnce([]);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);

    // open add form
    const addBtn = container.querySelector('#btn-show-add-form');
    expect(addBtn).toBeTruthy();
    addBtn.click();

    // Wait a tick
    await new Promise((r) => setTimeout(r, 0));

    const nameInput = container.querySelector('#aff-name');
    const urlInput = container.querySelector('#aff-url');
    const keywordInput = container.querySelector('#affiliate-keyword-input');
    const aiBtn = container.querySelector('#btn-generate-seo');
    const saveBtn = container.querySelector('#btn-save-link');

    nameInput.value = 'AI Product';
    urlInput.value = 'https://ai.example/item';

    // Add one temp keyword via input and Enter
    keywordInput.value = 'affiliate-key';
    const enterEvent = new KeyboardEvent('keydown', { key: 'Enter' });
    keywordInput.dispatchEvent(enterEvent);

    // Click AI generate
    expect(aiBtn).toBeTruthy();
    aiBtn.click();

    // wait for AI call
    await new Promise((r) => setTimeout(r, 0));

    // callGeminiAPI should have been called
    expect(callGeminiAPI).toHaveBeenCalled();

    // Now click save - addAffiliateLink should be called with SEO fields
    await saveBtn.click();
    // wait for async operations
    await new Promise((r) => setTimeout(r, 0));

    expect(addAffiliateLink).toHaveBeenCalled();
    const payload = addAffiliateLink.mock.calls[0][0];
    expect(payload.originalAffiliateKeywords).toEqual(['affiliate-key']);
    expect(payload.recommendedSearches).toEqual(['seo-auto-1', 'seo-auto-2']);
    expect(payload.longTailKeywords).toEqual(['seo-auto-long-1']);
    expect(payload.outline).toEqual(['섹션 1', '섹션 2']);
  });

  test('convertAffiliateLinkToIdea prefers recommendedSearches for tags when adding idea', async () => {
    const mockAddIdeaToKanban = require('../js/services/kanbanService.js').addIdeaToKanban;
    const mockGetAffiliateLinks = require('../js/services/affiliateService.js').getAffiliateLinks;

    mockGetAffiliateLinks.mockResolvedValueOnce([{
      id: 'test-link-2',
      platform: 'Coupang',
      name: 'SEO Product',
      url: 'https://example.com/product',
      createdAt: Date.now(),
      keywords: ['k1','k2'],
      recommendedSearches: ['seoA','seoB'],
      cardData: {
        productName: 'SEO Product'
      }
    }]);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);
    await new Promise((r) => setTimeout(r, 0));

    const templateBtn = container.querySelector('.link-template-btn');
    expect(templateBtn).toBeTruthy();
    templateBtn.click();

    await new Promise((r) => setTimeout(r, 0));

    const templateCard = document.body.querySelector('#template-selector-modal .template-card[data-template-id="product-review"]');
    expect(templateCard).toBeTruthy();
    templateCard.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAddIdeaToKanban).toHaveBeenCalled();
    const ideaArg = mockAddIdeaToKanban.mock.calls.pop()[0];
    // tags should use recommendedSearches when present
    expect(ideaArg.tags).toEqual(expect.arrayContaining(['seoA','seoB']));
  });
});
