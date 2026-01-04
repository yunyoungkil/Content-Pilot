const fs = require('fs');
const path = require('path');

describe('Link prompt content', () => {
  test('aiService.js contains concise INTERNAL LINKS block', () => {
    const filePath = path.resolve(__dirname, '../js/services/aiService.js');
    const content = fs.readFileSync(filePath, 'utf8');
    expect(content).toMatch(/\[INTERNAL LINKS - REQUIRED\]/);
    expect(content).toMatch(/Select 4–5 internal posts/);
    expect(content).toMatch(/\[AFFILIATE LINKS\]/);
    expect(content).toMatch(/2 \(minimum\) and up to 3 affiliate links/);
  });
});