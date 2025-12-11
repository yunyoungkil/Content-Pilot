const fs = require('fs');
const s = fs.readFileSync('background.js', 'utf8');
const stack = [];
for (let i = 0; i < s.length; i++) {
  if (s[i] === '{') stack.push(i);
  else if (s[i] === '}') stack.pop();
}
console.log('unclosed count', stack.length);
if (stack.length) {
  const idx = stack[stack.length - 1];
  const before = s.slice(0, idx + 1).split('\n');
  const lineNum = before.length;
  console.log('last unclosed at line', lineNum);
  console.log('---context---');
  const all = s.split('\n');
  const start = Math.max(0, lineNum - 6);
  const end = Math.min(all.length, lineNum + 6);
  for (let i = start; i < end; i++) {
    console.log(String(i + 1).padStart(4) + ' | ' + all[i]);
  }
}
