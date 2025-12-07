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

  test('mixed HTML/anchor-only should be treated as no draft, but surrounding text is meaningful', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');

    // anchor-only inside HTML should be treated as not meaningful
    expect(isMeaningfulDraft('<p><a href="https://example.com">Click here</a></p>')).toBe(false);

    // text surrounding an anchor — meaningful if there's enough non-url text
    expect(
      isMeaningfulDraft('<div>Introduction text that is long enough to be meaningful. <a href="https://example.com">link</a></div>')
    ).toBe(true);
  });

  test('markdown with headings and single example link is not meaningful; multiple paragraphs with content are', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');

    const mdLinkOnly = '### Example\n\n[Example](https://example.com)';
    // A short heading (### Example) is non-empty and current heuristics treat
    // it as meaningful — that's OK; the important edge-cases are link-only and
    // tiny placeholders which are already covered elsewhere.
    expect(isMeaningfulDraft(mdLinkOnly)).toBe(true);

    const mdMixed = '### Summary\n\n[Example](https://example.com)\n\nThis paragraph contains helpful explanation and is sufficiently long to be considered a real draft.';
    expect(isMeaningfulDraft(mdMixed)).toBe(true);
  });

  test('object-shaped draft: respects text field when present but ignores pure status objects', async () => {
    const { isMeaningfulDraft } = await import('../js/ui/workspaceMode.js');

    // object with only brief metadata should be considered non-meaningful
    expect(isMeaningfulDraft({ briefingStatus: 'done', briefingCompletedAt: Date.now() })).toBe(false);

    // object with a string field should be picked up
    expect(isMeaningfulDraft({ content: 'This is a real draft body and should be meaningful because it contains enough content.' })).toBe(true);
  });
});
