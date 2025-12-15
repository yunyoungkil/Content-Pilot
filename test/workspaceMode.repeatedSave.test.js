
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

    await global.testHelpers.waitForMs(300);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(50);

    const input = container.querySelector('#idea-title-input');
    const saveBtn = container.querySelector('#save-idea-title-btn');
    expect(input).toBeTruthy();
    expect(saveBtn).toBeTruthy();

    // mock sendMessage to succeed
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
        if (msg.action === 'update_kanban_card') {
            cb({ success: true });
        }
    });

    // 1. First Save
    input.value = 'First Edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(20);
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    await global.testHelpers.waitForMs(20);

    const calls1 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls1.length).toBe(1);
    expect(calls1[0][0]).toEqual(
      expect.objectContaining({
        action: 'update_kanban_card',
        data: expect.objectContaining({ updates: { title: 'First Edit' } }),
      })
    );
    expect(saveBtn.disabled).toBe(true);
    expect(idea.title).toBe('First Edit');

    // 2. Second Save
    input.value = 'Second Edit';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(20);
    expect(saveBtn.disabled).toBe(false);

    saveBtn.click();
    await global.testHelpers.waitForMs(20);

    const calls2 = sendSpy.mock.calls.filter(args => args[0].action === 'update_kanban_card');
    expect(calls2.length).toBe(2);
    expect(calls2[1][0]).toEqual(
      expect.objectContaining({
        action: 'update_kanban_card',
        data: expect.objectContaining({ updates: { title: 'Second Edit' } }),
      })
    );
    expect(saveBtn.disabled).toBe(true);
    expect(idea.title).toBe('Second Edit');
  });
});
