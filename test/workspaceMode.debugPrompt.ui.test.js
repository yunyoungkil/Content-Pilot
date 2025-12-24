// test/workspaceMode.debugPrompt.ui.test.js

describe('Workspace UI - AI debug prompt modal', () => {
  beforeEach(() => {
    // Ensure the module is (re)loaded to attach listeners
    jest.isolateModules(() => {
      require('../js/ui/workspaceMode.js');
    });
  });

  afterEach(() => {
    // Clean DOM
    document.body.innerHTML = '';
  });

  test('shows debug modal when runtime message received', () => {
    // Ensure no modal initially
    expect(document.querySelector('#ai-debug-prompt-modal')).toBeNull();

    // Grab the listener registered by workspaceMode
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalled();
    // Find the listener that references 'debug_show_prompt' in its source
    const calls = chrome.runtime.onMessage.addListener.mock.calls;
    let listener = null;
    for (const c of calls) {
      if (c && typeof c[0] === 'function' && c[0].toString().includes('debug_show_prompt')) {
        listener = c[0];
        break;
      }
    }
    expect(typeof listener).toBe('function');

    // Simulate incoming runtime message
    try {
      listener({ action: 'debug_show_prompt', promptType: 'imageGeneration.input', prompt: 'Test image prompt' });
    } catch (e) {
      // Show any error to test output
      console.error('listener threw', e);
    }

    // Modal should be present
    const modal = document.querySelector('#ai-debug-prompt-modal');
    expect(modal).not.toBeNull();

    const typeEl = modal.querySelector('#ai-debug-prompt-type');
    const textEl = modal.querySelector('#ai-debug-prompt-text');

    expect(typeEl.textContent).toBe('imageGeneration.input');
    expect(textEl.value).toBe('Test image prompt');
  });
});