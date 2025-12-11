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

describe('affiliate modal: Ohouse (오늘의집) platform support', () => {
  test('select includes Ohouse option', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);

    const select = container.querySelector('#aff-platform');
    expect(select).toBeTruthy();
    const option = Array.from(select.options).find((o) => o.value === 'Ohouse');
    expect(option).toBeTruthy();
    expect(option.text).toContain('오늘의집');
  });

  test('card shows Ohouse icon and label', async () => {
    const { getAffiliateLinks } = require('../js/services/affiliateService.js');

    const sampleLink = {
      id: 'ohouse-1',
      name: '오늘의집 샘플',
      url: 'https://ohou.se',
      platform: 'Ohouse',
      keywords: ['ohouse'],
      clickCount: 0,
      createdAt: Date.now(),
    };

    getAffiliateLinks.mockResolvedValueOnce([sampleLink]);

    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);
    await new Promise((r) => setTimeout(r, 20));

    const card = container.querySelector('.affiliate-link-card');
    expect(card).toBeTruthy();
    const platformIcon = card.querySelector('.link-platform-icon');
    const platformLabel = card.querySelector('.link-platform');
    expect(platformIcon).toBeTruthy();
    expect(platformLabel).toBeTruthy();
    expect(platformIcon.textContent).toContain('🏠');
    expect(platformLabel.textContent).toContain('오늘의집');
  });
});
