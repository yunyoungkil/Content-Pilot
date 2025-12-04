import { renderAffiliateModal } from '../js/ui/affiliateModal.js';

describe('Affiliate Modal layout and scrolling', () => {
  beforeAll(() => {
    // Ensure a clean DOM
    document.body.innerHTML = '';
  });

  test('affiliate-link-list should be a flex child and have overflow-y:auto and a min-height fallback', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderAffiliateModal(container);

    const listEl = container.querySelector('#affiliate-link-list');
    expect(listEl).toBeTruthy();

    const style = window.getComputedStyle(listEl);

    // Check overflow-y is set to auto (fallback rule)
    expect(style.overflowY === 'auto' || style.overflow === 'auto').toBeTruthy();

    // minHeight should be set to allow shrink inside flexbox
    expect(style.minHeight && style.minHeight !== 'auto').toBeTruthy();

    // flex should be set for stable height management
    expect(style.flex && style.flex !== '').toBeTruthy();
  });
});
