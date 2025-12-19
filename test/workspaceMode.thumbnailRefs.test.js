/* test/workspaceMode.thumbnailRefs.test.js */

jest.dontMock('fs');

describe('WorkspaceMode - updateThumbnailModalReferences', () => {
  beforeAll(() => {
    // Ensure DOM container exists
    document.body.innerHTML = '<div id="tm-ref-images"></div>';
  });

  afterAll(() => {
    document.body.innerHTML = '';
  });

  test('renders images from cardData formattedDraft and linked/affiliate sources', () => {
    const { updateThumbnailModalReferences } = require('../js/ui/workspaceMode.js');

    const cardData = {
      formattedDraft: '<p>Some text <img src="https://images.test/ed1.png"/></p>',
      currentDraft: '',
      linkedScrapsContent: [{ title: 's1', image: 'https://images.test/s1.png' }],
      affiliateLinks: [{ id: 'a1', cardData: { imageUrl: 'https://images.test/a1.png' } }],
    };

    updateThumbnailModalReferences(cardData, 5);

    const wrapper = document.querySelector('#tm-ref-images');
    expect(wrapper).toBeTruthy();
    const imgs = wrapper.querySelectorAll('img');
    expect(imgs.length).toBeGreaterThanOrEqual(1);
    const srcs = Array.from(imgs).map((i) => i.src);
    expect(
      srcs.some((s) => s.includes('ed1.png') || s.includes('s1.png') || s.includes('a1.png'))
    ).toBe(true);
  });
});
