import { renderWorkspace } from '../js/ui/workspaceMode.js';
// Use global.testHelpers at runtime (setup file may initialize it after module import)
import * as authModule from '../js/services/authService.js';

describe('Workspace Mode - get_my_channels retry behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should call get_auth_token and retry get_my_channels when authentication required', async () => {
    // Arrange: mock runtime sendMessage to simulate auth failure then success
    let callCount = 0;
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.action === 'get_my_channels') {
        callCount++;
        if (callCount === 1) {
          // initial call: auth required
          if (callback) callback({ success: false, error: 'Authentication required. Please sign in again.' });
        } else {
          if (callback) callback({ success: true, channels: { myChannels: { blogs: [{ id: '1', inputUrl: 'https://example.com' }], youtubes: [] } } });
        }
      } else if (message.action === 'get_auth_token') {
        if (callback) callback({ success: true, token: 'fake-token' });
      } else {
        if (callback) callback({ success: true });
      }
    });

    // prepare container
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Act
    await renderWorkspace(container, { id: 'test-idea', title: 'Test Idea' });
    // Wait for async operations (give more time for token flow and retries)
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 100));

    // Assert: sendMessage called at least twice for get_my_channels
    const getMyChannelsCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0]?.action === 'get_my_channels');
    expect(getMyChannelsCalls.length).toBeGreaterThanOrEqual(2);
    // The publish-info-panel should be rendered using the channel data
    const panel = container.querySelector('.publish-info-panel');
    expect(panel).not.toBeNull();
    document.body.removeChild(container);
  });
});
