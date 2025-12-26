const { applyThumbnailInfoUpdate } = require('../js/ui/workspaceMode.js');

describe('workspaceMode.applyThumbnailInfoUpdate', () => {
  test('updates only the selected index and breaks shared references', () => {
    const shared = { type: 'curiosity', thumbnailText: 'T', bgImage: null };
    const ideaData = { publishInfo: { thumbnailInfo: [shared, shared, shared] } };

    applyThumbnailInfoUpdate(ideaData, { bgImage: 'https://images.test/gen.png', selectedThumbnailIndex: 1 });

    expect(Array.isArray(ideaData.publishInfo.thumbnailInfo)).toBe(true);
    expect(ideaData.publishInfo.thumbnailInfo.length).toBe(3);

    // only index 1 updated
    expect(ideaData.publishInfo.thumbnailInfo[0].bgImage).toBeNull();
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImage).toBe('https://images.test/gen.png');
    expect(ideaData.publishInfo.thumbnailInfo[2].bgImage).toBeNull();

    // ensure references are broken (not all the same object)
    expect(ideaData.publishInfo.thumbnailInfo[0]).not.toBe(ideaData.publishInfo.thumbnailInfo[1]);
    expect(ideaData.publishInfo.thumbnailInfo[1]).not.toBe(ideaData.publishInfo.thumbnailInfo[2]);
  });

  test('accumulates bgImages history when multiple updates applied to same concept', () => {
    const ideaData = { publishInfo: { thumbnailInfo: [ { type: 'curiosity' }, { type: 'informative' }, { type: 'empathy' } ] } };
    applyThumbnailInfoUpdate(ideaData, { bgImage: 'https://images.test/gen.png', selectedThumbnailIndex: 1 });
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImage).toBe('https://images.test/gen.png');
    expect(Array.isArray(ideaData.publishInfo.thumbnailInfo[1].bgImages)).toBe(true);
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImages[0]).toBe('https://images.test/gen.png');

    // apply second update
    applyThumbnailInfoUpdate(ideaData, { bgImage: 'https://images.test/gen-second.png', selectedThumbnailIndex: 1 });
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImage).toBe('https://images.test/gen-second.png');
    expect(Array.isArray(ideaData.publishInfo.thumbnailInfo[1].bgImages)).toBe(true);
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImages[0]).toBe('https://images.test/gen-second.png');
    expect(ideaData.publishInfo.thumbnailInfo[1].bgImages[1]).toBe('https://images.test/gen.png');
  });
});