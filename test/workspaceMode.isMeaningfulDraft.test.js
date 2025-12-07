import { jest } from '@jest/globals';

describe('workspaceMode.isMeaningfulDraft helper', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('returns false for empty or placeholder html', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');
    expect(isMeaningfulDraft('')).toBe(false);
    expect(isMeaningfulDraft('<p><br></p>')).toBe(false);
    expect(isMeaningfulDraft('    \n  ')).toBe(false);
  });

  test('returns false for markdown link only and bare urls', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');
    expect(isMeaningfulDraft('[Example](https://example.com)')).toBe(false);
    expect(isMeaningfulDraft('https://example.com')).toBe(false);
    expect(isMeaningfulDraft('www.example.com')).toBe(false);
  });

  test('correctly handles short text combined with url', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');
    // short text + url should not be considered meaningful
    expect(isMeaningfulDraft('Note: https://example.com')).toBe(false);
    // longer text with url should be considered meaningful
    expect(isMeaningfulDraft('This is a meaningful sentence with https://example.com in it.')).toBe(true);
  });

  test('strips JSON-LD and fenced code blocks and still recognizes meaningful content', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');
    const jsonLd = '<script type="application/ld+json">{"headline":"ignore me"}</script>Visible content here that is long enough.';
    expect(isMeaningfulDraft(jsonLd)).toBe(true);

    const fenced = "```js\nconsole.log('hello')\n```\nThis sentence is long enough to be meaningful.";
    expect(isMeaningfulDraft(fenced)).toBe(true);
  });

  test('image markdown alone is not meaningful', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');
    expect(isMeaningfulDraft('![alt](https://example.com/a.png)')).toBe(false);
  });
});
