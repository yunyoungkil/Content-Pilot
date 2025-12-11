const { mergeBlogsPreservePlatform } = require('../js/services/channelUtils.js');

describe('channelUtils.mergeBlogsPreservePlatform', () => {
  test('preserves platformType from existing when incoming omits it', () => {
    const existing = [ { id: 'ch1', inputUrl: 'https://example.tistory.com/mine', apiUrl: 'https://example.tistory.com/rss', platformType: 'tistory' } ];
    const incoming = [ { id: 'ch1', inputUrl: 'https://example.tistory.com/mine', apiUrl: 'https://example.tistory.com/rss' } ];
    const merged = mergeBlogsPreservePlatform(existing, incoming);
    expect(merged.length).toBe(1);
    expect(merged[0].platformType).toBe('tistory');
  });
});
