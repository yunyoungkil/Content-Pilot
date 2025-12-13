import { jest } from '@jest/globals';

describe('Quill -> TipTap converter', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  test('converts code-block delta to TipTap codeBlock node', async () => {
    const { convertDeltaToTipTapJSON } = await import('../js/utils/quillToTiptap.js');
    const delta = { ops: [{ insert: 'console.log(1)\nconsole.log(2)\n', attributes: { 'code-block': true } }] };
    const result = await convertDeltaToTipTapJSON(delta);
    expect(result).toBeTruthy();
    expect(result.type).toBe('doc');
    // Should include a codeBlock node with combined lines
    const codeNode = result.content.find((n) => n.type === 'codeBlock');
    expect(codeNode).toBeTruthy();
    expect(codeNode.content[0].text).toContain('console.log(1)');
    expect(codeNode.content[0].text).toContain('console.log(2)');
  });

  test('converts table HTML from delta to TipTap JSON table node', async () => {
    const { convertDeltaToTipTapJSON } = await import('../js/utils/quillToTiptap.js');
    const delta = { ops: [{ insert: '<table><tr><td>Foo</td></tr></table>' }] };
    const result = await convertDeltaToTipTapJSON(delta);
    // Now we expect a JSON doc with a table node
    expect(result).toBeTruthy();
    expect(result.type).toBe('doc');
    const tableNode = result.content && result.content.find && result.content.find((n) => n.type === 'table');
    expect(tableNode).toBeTruthy();
    // Table should have a single row and a single cell with text 'Foo'
    expect(tableNode.content.length).toBeGreaterThan(0);
    const firstRow = tableNode.content[0];
    expect(firstRow.type).toBe('tableRow');
    expect(firstRow.content.length).toBe(1);
    const cell = firstRow.content[0];
    expect(cell.type === 'tableCell' || cell.type === 'tableHeader').toBeTruthy();
    const paragraph = cell.content && cell.content[0];
    expect(paragraph.type).toBe('paragraph');
    const textNode = paragraph.content && paragraph.content[0];
    expect(textNode.text).toBe('Foo');
  });
});
