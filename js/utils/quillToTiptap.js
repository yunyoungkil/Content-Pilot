// js/utils/quillToTiptap.js
// Simple migration helper for Quill -> TipTap (HTML-based POC)

/**
 * Convert a Quill Editor instance or Quill Delta to HTML string.
 * DEPRECATED: Quill has been removed. This function now returns an empty string.
 */
export async function convertQuillDeltaToHtml(quillOrDelta) {
  console.warn('convertQuillDeltaToHtml is deprecated and Quill is removed.');
  return '';
}

export function convertQuillDeltaToPlainText(delta) {
  if (!delta || !delta.ops) return '';
  let s = '';
  delta.ops.forEach((op) => {
    if (op.insert && typeof op.insert === 'string') {
      s += op.insert;
    } else if (op.insert && op.insert.image) {
      s += '\n[image]\n';
    }
  });
  return s;
}

/**
 * Very small/safe Quill Delta -> TipTap JSON converter (POC)
 * Supports paragraphs, headings, bold, italic, underline, lists, blockquote, code-block, links, images
 */
export async function convertDeltaToTipTapJSON(delta) {
  if (!delta || !delta.ops) return { type: 'doc', content: [] };

  // Quick heuristic: if delta contains HTML for table, try to parse to TipTap JSON
  for (const op of delta.ops) {
    if (typeof op.insert === 'string' && /<table\b|<tbody\b|<tr\b|<td\b|<th\b/i.test(op.insert)) {
      // Convert the delta to HTML and try mapping table structure to TipTap JSON
      // Prefer to parse the explicit op.insert HTML fragment rather than rendering a full delta
      const htmlFragment = op.insert;
      try {
        const tableNode = _convertHtmlTableToTipTapJSON(htmlFragment);
        if (tableNode) return { type: 'doc', content: tableNode };
      } catch (e) {
        // fallback to the raw HTML string if mapping fails
        return htmlFragment;
      }
    }
  }

  const content = [];
  let listBuffer = null; // accumulate list items

  const flushList = () => {
    if (!listBuffer) return;
    const { ordered, items } = listBuffer;
    const listNode = {
      type: ordered ? 'orderedList' : 'bulletList',
      content: items.map((it) => ({ type: 'listItem', content: it })),
    };
    content.push(listNode);
    listBuffer = null;
  };

  const pushParagraph = (textInlineNodes) => {
    if (!textInlineNodes || textInlineNodes.length === 0) {
      content.push({ type: 'paragraph' });
      return;
    }
    content.push({ type: 'paragraph', content: textInlineNodes });
  };

  const opInlineToTiptap = (op) => {
    if (op.insert && typeof op.insert === 'string') {
      const parts = op.insert.split('\n');
      const nodes = [];
      // For this POC, treat entire string as a single text node unless formatting marks present
      const marks = op.attributes || {};
      const textNode = { type: 'text', text: op.insert };
      if (marks.bold) textNode.marks = (textNode.marks || []).concat({ type: 'bold' });
      if (marks.italic) textNode.marks = (textNode.marks || []).concat({ type: 'italic' });
      if (marks.underline) textNode.marks = (textNode.marks || []).concat({ type: 'underline' });
      if (marks.link) textNode.marks = (textNode.marks || []).concat({ type: 'link', attrs: { href: marks.link } });
      return textNode;
    }
    if (op.insert && op.insert.image) {
      return { type: 'image', attrs: { src: op.insert.image, alt: (op.attributes && op.attributes.alt) || null } };
    }
    return null;
  };

  // Additional support for code-blocks: gather contiguous code-block lines
  let currentInline = [];
  let inCodeBlock = false;
  let codeLines = [];

  for (const op of delta.ops) {
    if (op.insert && op.insert.image) {
      // flush paragraph then push image node
      flushList();
      if (currentInline.length > 0) {
        pushParagraph(currentInline);
        currentInline = [];
      }
      const imgNode = opInlineToTiptap(op);
      if (imgNode) content.push(imgNode);
      continue;
    }

    if (typeof op.insert === 'string') {
      const text = op.insert;
      const parts = text.split('\n');
      for (let i = 0; i < parts.length; i++) {
        const chunk = parts[i];
        if (chunk.length > 0) {
          const inlineNode = opInlineToTiptap({ insert: chunk, attributes: op.attributes });
          if (inlineNode) currentInline.push(inlineNode);
        }
        if (i < parts.length - 1) {
          const attrs = op.attributes || {};
          if (attrs['code-block']) {
            // accumulate lines for a code block
            inCodeBlock = true;
            codeLines.push((currentInline[0] && currentInline[0].text) || '');
            currentInline = [];
            continue;
          }
          if (inCodeBlock) {
            // flush code block
            content.push({ type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] });
            inCodeBlock = false;
            codeLines = [];
          }

          if (attrs.header) {
            flushList();
            if (currentInline.length > 0) {
              content.push({ type: 'heading', attrs: { level: attrs.header }, content: currentInline });
              currentInline = [];
            } else {
              content.push({ type: 'heading', attrs: { level: attrs.header } });
            }
            continue;
          }
          if (attrs['list']) {
            if (!listBuffer) listBuffer = { ordered: attrs.list === 'ordered', items: [] };
            listBuffer.items.push(currentInline.length > 0 ? currentInline : [{ type: 'paragraph' }]);
            currentInline = [];
            continue;
          }
          if (attrs['blockquote']) {
            flushList();
            content.push({ type: 'blockquote', content: currentInline.length > 0 ? [{ type: 'paragraph', content: currentInline }] : [{ type: 'paragraph' }] });
            currentInline = [];
            continue;
          }
          // default newline -> paragraph
          flushList();
          pushParagraph(currentInline);
          currentInline = [];
        }
      }
    }
  }

  if (inCodeBlock && codeLines.length > 0) {
    content.push({ type: 'codeBlock', content: [{ type: 'text', text: codeLines.join('\n') }] });
    inCodeBlock = false;
    codeLines = [];
  }

  // flush remaining inline content
  if (currentInline.length > 0) {
    flushList();
    pushParagraph(currentInline);
  } else {
    flushList();
  }

  return { type: 'doc', content };
}

/**
 * Convert the first HTML table found in the given HTML string into TipTap JSON nodes.
 * Returns an array of top-level nodes (table node in content array) or null if not found.
 */
export function _convertHtmlTableToTipTapJSON(htmlString) {
  if (!htmlString || typeof htmlString !== 'string') return null;
  const parser = new DOMParser();
  const doc = parser.parseFromString(htmlString, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;

  const buildCellContent = (cell) => {
    // build a paragraph child with text; preserve simple inline formatting
    const children = [];
    for (const node of Array.from(cell.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent || '';
        if (text.trim().length > 0) children.push({ type: 'text', text });
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.tagName === 'STRONG' || node.tagName === 'B') {
          children.push({ type: 'text', text: node.textContent || '', marks: [{ type: 'bold' }] });
        } else if (node.tagName === 'EM' || node.tagName === 'I') {
          children.push({ type: 'text', text: node.textContent || '', marks: [{ type: 'italic' }] });
        } else if (node.tagName === 'A') {
          const href = node.getAttribute('href') || '';
          children.push({ type: 'text', text: node.textContent || '', marks: [{ type: 'link', attrs: { href } }] });
        } else {
          // fallback: use node text
          const text = node.textContent || '';
          if (text.trim().length > 0) children.push({ type: 'text', text });
        }
      }
    }
    if (children.length === 0) return [{ type: 'paragraph' }];
    return [{ type: 'paragraph', content: children }];
  };

  const rows = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = [];
    const children = Array.from(tr.children).filter((n) => n.tagName === 'TD' || n.tagName === 'TH');
    for (const cell of children) {
      const isHeader = cell.tagName === 'TH';
      const cellContent = buildCellContent(cell);
      const nodeType = isHeader ? 'tableHeader' : 'tableCell';
      cells.push({ type: nodeType, content: cellContent });
    }
    rows.push({ type: 'tableRow', content: cells });
  }

  const tableNode = [{ type: 'table', content: rows }];
  return tableNode;
}

