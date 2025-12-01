import { isTrueReadyMessage } from '../js/services/offscreenService.js';

describe('Offscreen readiness helper', () => {
  test('recognizes explicit offscreen_ready as true', () => {
    expect(isTrueReadyMessage({ action: 'offscreen_ready' })).toBe(true);
  });

  test('does not treat offscreen_ready_beacon as true', () => {
    expect(isTrueReadyMessage({ action: 'offscreen_ready_beacon' })).toBe(false);
  });

  test('rejects unrelated messages', () => {
    expect(isTrueReadyMessage({ action: 'something_else' })).toBe(false);
    expect(isTrueReadyMessage(null)).toBe(false);
  });
});
