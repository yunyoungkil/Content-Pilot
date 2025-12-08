const fs = require('fs');
const path = require('path');
const statsPath = path.resolve(__dirname, '..', 'stats.json');
const buf = fs.readFileSync(statsPath);
// Detect BOM for UTF-16 LE (FF FE) — webpack on Windows sometimes emits UTF-16 JSON.
let raw;
if (buf[0] === 0xFF && buf[1] === 0xFE) {
  raw = buf.toString('utf16le');
} else {
  raw = buf.toString('utf8');
}
// strip non-JSON prefix if present
const jsonStart = raw.indexOf('{');
const clean = jsonStart > 0 ? raw.slice(jsonStart) : raw;
const stats = JSON.parse(clean);
const chunks = stats.chunks || [];
const modulesByChunk = {};
for (const chunk of chunks) {
  const name = (chunk.names && chunk.names[0]) || chunk.id || chunk.hash;
  modulesByChunk[name] = (chunk.modules || []).map(m => ({name: m.name, size: m.size})).sort((a,b)=>b.size - a.size).slice(0,30);
}
for (const k of Object.keys(modulesByChunk)) {
  console.log(`\n=== CHUNK: ${k} (top modules)`);
  modulesByChunk[k].forEach(m => console.log(`${(m.size/1024).toFixed(2)} KiB  ${m.name}`));
}
