const { execFile } = require('child_process');
const path = require('path');

const CLI = path.resolve(__dirname, '..', 'tools', 'offscreen-cli.js');
const SAMPLE = path.resolve(__dirname, '..', 'tools', 'sample-input.html');

describe('offscreen-cli tool', () => {
  jest.setTimeout(15000);
  test('sanitize mode removes scripts and dangerous attributes', (done) => {
    execFile('node', [CLI, '--mode', 'sanitize', '--file', SAMPLE], (err, stdout, stderr) => {
      expect(err).toBeNull();
      expect(stderr).toBe('');
      // Should not include <script> or onerror attribute
      expect(stdout).not.toMatch(/<script/);
      expect(stdout).not.toMatch(/onerror=/);
      expect(stdout).toMatch(/<h1>Title<\/h1>/);
      done();
    });
  });

  test('parse mode returns JSON with expected fields', (done) => {
    execFile('node', [CLI, '--mode', 'parse', '--file', SAMPLE], (err, stdout, stderr) => {
      expect(err).toBeNull();
      expect(stderr).toBe('');
      let parsed = null;
      try {
        parsed = JSON.parse(stdout);
      } catch (e) {
        // fail the test
      }
      expect(parsed).toBeTruthy();
      expect(parsed).toHaveProperty('thumbnail');
      expect(parsed).toHaveProperty('description');
      expect(parsed.cleanText).toMatch(/Title/);
      done();
    });
  });
});
