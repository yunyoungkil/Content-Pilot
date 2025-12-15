import { jest } from '@jest/globals';

describe('Workspace UI - save title on leave', () => {
  beforeEach(() => {
    jest.resetModules();
    global.testHelpers.mockChromeRuntime();
  });

  test('unsaved title is saved and reflected on idea card when leaving workspace', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = {
      id: 'card-save-leave',
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
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    // change title but do NOT blur/click save
    input.value = 'New Title Before Leave';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(20);
    expect(saveBtn.disabled).toBe(false);

    // simulate leaving workspace by rendering another idea
    const otherIdea = { id: 'other-1', title: 'Other', status: 'ideas' };
    renderWorkspace(container, otherIdea);
    await global.testHelpers.waitForMs(100);

    // the kanban card should be updated
    const updatedCard = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
    expect(updatedCard).toBeTruthy();
    expect(updatedCard.dataset.title).toBe('New Title Before Leave');
    const kTitle = updatedCard.querySelector('.kanban-card-title');
    expect(kTitle.textContent).toBe('New Title Before Leave');

    sendSpy.mockRestore();
    container.remove();
    kanbanCard.remove();
  });
});
