import { renderAffiliateModal } from '../js/ui/affiliateModal.js';

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

describe('affiliate modal platform options and mapping', () => {
  test('platform select includes NaverShoppingConnect option', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);

    const select = container.querySelector('#aff-platform');
    expect(select).toBeTruthy();

    const option = Array.from(select.options).find((o) => o.value === 'NaverShoppingConnect');
    expect(option).toBeTruthy();
    expect(option.text).toContain('네이버');
  });

  test('card shows correct icon and label for NaverShoppingConnect', async () => {
    const { getAffiliateLinks } = require('../js/services/affiliateService.js');

    const sampleLink = {
      id: 'naver-1',
      name: '네이버 샘플',
      url: 'https://search.shopping.naver.com',
      platform: 'NaverShoppingConnect',
      keywords: ['naver'],
      clickCount: 0,
      createdAt: Date.now(),
    };

    getAffiliateLinks.mockResolvedValueOnce([sampleLink]);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);
    // wait for loadLinks
    await new Promise((r) => setTimeout(r, 20));

    const card = container.querySelector('.affiliate-link-card');
    expect(card).toBeTruthy();

    const platformIcon = card.querySelector('.link-platform-icon');
    const platformLabel = card.querySelector('.link-platform');
    expect(platformIcon).toBeTruthy();
    expect(platformLabel).toBeTruthy();

    expect(platformIcon.textContent).toContain('🟢');
    expect(platformLabel.textContent).toContain('네이버');
  });
});
