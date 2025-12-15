
import { jest } from '@jest/globals';

describe('Workspace UI - repeated save', () => {
  beforeEach(() => {
    jest.resetModules();
    global.testHelpers.mockChromeRuntime();
    document.body.innerHTML = '';
  });

  test('can save title multiple times', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-repeated-save',
      title: 'Original Title',
      status: 'ideas',
      publishInfo: {},
    };

    // create a fake kanban card in the DOM
    const kanbanCard = document.createElement('div');
    kanbanCard.className = 'cp-kanban-card';
    kanbanCard.dataset.id = idea.id;
    kanbanCard.dataset.title = idea.title;
    kanbanCard.innerHTML = `<span class="kanban-card-title">${idea.title}</span>`;
    document.body.appendChild(kanbanCard);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    await global.testHelpers.waitForMs(600);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(200);

    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();

    // mock sendMessage to succeed
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
        if (msg.action === 'update_kanban_card') {
            cb({ success: true });
        }
    });

    // 1. First Save
    input.value = 'First Edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(100);
    
    // Trigger save via blur
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(200);

    const calls1 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls1.length).toBe(1);
    expect(calls1[0][0]).toEqual(
      expect.objectContaining({
        action: 'update_kanban_card',
        data: expect.objectContaining({ updates: { title: 'First Edit' } }),
      })
    );
    expect(idea.title).toBe('First Edit');

    // 2. Second Save
    input.value = 'Second Edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(100);
    
    // Trigger save via blur
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(200);

    const calls2 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls2.length).toBe(2);
    expect(calls2[1][0]).toEqual(
      expect.objectContaining({
        action: 'update_kanban_card',
        data: expect.objectContaining({ updates: { title: 'Second Edit' } }),
      })
    );
    expect(idea.title).toBe('Second Edit');
  });

  test('resets _isSaving flag after timeout if callback is not called', async () => {
    jest.useFakeTimers();
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-timeout-save',
      title: 'Original Title',
      status: 'ideas',
      publishInfo: {},
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    jest.advanceTimersByTime(300); // Wait for showPublishInfo

    const input = container.querySelector('#idea-title-input');

    // mock sendMessage to NOT call callback
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
        // Do nothing (simulate timeout/no response)
    });

    // 1. Trigger Save
    input.value = 'Timeout Edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(20);
    
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    
    // Check that save was attempted
    expect(sendSpy).toHaveBeenCalled();
    
    // Try to trigger again immediately - should be blocked
    sendSpy.mockClear();
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(sendSpy).not.toHaveBeenCalled(); // Blocked by _isSaving

    // Advance time by 5000ms
    jest.advanceTimersByTime(5000);

    // Try to trigger again - should work now
    // We need to make sure _titleChanged is true, so fire input again
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    expect(sendSpy).toHaveBeenCalled();

    jest.useRealTimers();
  });

  test('can save title after re-rendering workspace (simulate exit/re-enter)', async () => {
    jest.useFakeTimers();
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-rerender-save',
      title: 'Original Title',
      status: 'ideas',
      publishInfo: {},
    };

    const container = document.createElement('div');
    document.body.appendChild(container);

    // --- First Render ---
    renderWorkspace(container, idea);
    jest.advanceTimersByTime(300); // Wait for showPublishInfo

    let input = container.querySelector('#idea-title-input');
    
    // mock sendMessage
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
        if (msg.action === 'update_kanban_card') {
            cb({ success: true });
        } else if (msg.action === 'get_my_channels') {
            cb({ channels: { myChannels: { blogs: [] } } });
        } else if (cb) {
            cb({ success: true });
        }
    });

    // Save 1
    input.value = 'Edit 1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(20);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    
    const calls1 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls1.length).toBe(1);
    expect(idea.title).toBe('Edit 1');

    // --- Re-Render (Simulate Exit/Enter) ---
    container.innerHTML = ''; // Clear DOM
    renderWorkspace(container, idea); // Re-render with same object (now updated)
    jest.advanceTimersByTime(300);

    input = container.querySelector('#idea-title-input');
    expect(input.value).toBe('Edit 1'); // Should show updated title

    // Save 2
    input.value = 'Edit 2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    jest.advanceTimersByTime(20);
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    const calls2 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls2.length).toBe(2);
    expect(idea.title).toBe('Edit 2');

    jest.useRealTimers();
  });
});
