jest.mock('../js/services/firebaseService.js', () => ({
  signInToFirebaseWithGoogleToken: jest.fn(async () => ({ success: true })),
}));

import * as authService from '../js/services/authService.js';

describe('restoreAuthSession user info persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Provide stored token (validateStoredToken will check this and our global.fetch mock)
    jest.spyOn(global.chrome.storage.local, 'get').mockImplementation(async (keys) => {
      return { googleAuthToken: 'valid-token', googleAuthTokenExpiry: Date.now() + 1000000, googleAuthTokenIssued: Date.now() };
    });

    // mock fetch for userinfo endpoint
    global.fetch = jest.fn(async (url, opts) => {
      if (url.includes('oauth2.googleapis.com') || url.includes('/userinfo')) {
        return {
          ok: true,
          json: async () => ({ email: 'test@example.com', sub: 'unique-id-123', id: 'unique-id-123', name: 'Test User' }),
        };
      }
      return { ok: false, status: 404 };
    });
  });

  test('restoreAuthSession stores googleUserEmail and googleUserId when token valid', async () => {
    const setSpy = jest.spyOn(global.chrome.storage.local, 'set');

    const res = await authService.restoreAuthSession();

    expect(res).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(expect.objectContaining({ googleUserEmail: 'test@example.com', googleUserId: 'unique-id-123' }));
  });
});
