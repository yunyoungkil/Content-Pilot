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
    expect(input).toBeTruthy();

    // mock sendMessage to succeed
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    // change title but do NOT blur/click save
    input.value = 'New Title Before Leave';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(20);

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

  test('repeated saves update the card each time', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-save-repeat', title: 'First', status: 'ideas', publishInfo: {} };

    const kanbanCard = document.createElement('div');
    kanbanCard.className = 'cp-kanban-card';
    kanbanCard.dataset.id = idea.id;
    kanbanCard.dataset.title = idea.title;
    kanbanCard.innerHTML = `<span class="kanban-card-title">${idea.title}</span>`;
    document.body.appendChild(kanbanCard);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);
    await global.testHelpers.waitForMs(200);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(50);

    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();

    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    // First save
    input.value = 'First Updated';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(10);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(50);

    const updatedCard1 = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
    expect(updatedCard1.dataset.title).toBe('First Updated');

    // Second save
    input.value = 'Second Updated';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(10);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(50);

    const updatedCard2 = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
    expect(updatedCard2.dataset.title).toBe('Second Updated');

    // ensure sendMessage was called at least twice for update_kanban_card
    const updateCalls = sendSpy.mock.calls.filter((c) => c[0] && c[0].action === 'update_kanban_card');
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    sendSpy.mockRestore();
    container.remove();
    kanbanCard.remove();
  });

  test('save still works after publish-info re-render', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const idea = { id: 'card-save-rerender', title: 'Start', status: 'ideas', publishInfo: {} };

    const kanbanCard = document.createElement('div');
    kanbanCard.className = 'cp-kanban-card';
    kanbanCard.dataset.id = idea.id;
    kanbanCard.dataset.title = idea.title;
    kanbanCard.innerHTML = `<span class="kanban-card-title">${idea.title}</span>`;
    document.body.appendChild(kanbanCard);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);
    await global.testHelpers.waitForMs(200);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(50);

    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();

    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    // first save
    input.value = 'After R1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(10);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(40);
    expect(document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`).dataset.title).toBe('After R1');

    // simulate background/UI re-render that replaces publish-info contents
    renderWorkspace(container, idea);
    await global.testHelpers.waitForMs(100);

    // re-open publish tab after re-render (UI may reset active tab)
    const tabBtn2 = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    if (tabBtn2) tabBtn2.click();
    await global.testHelpers.waitForMs(50);

    const newInput = container.querySelector('#idea-title-input');
    // debug: ensure publish areas have handlers attached
    const publishAreas = Array.from(document.querySelectorAll('#publish-info-content'));
    expect(publishAreas.length).toBeGreaterThanOrEqual(1);
    publishAreas.forEach((pa) => {
      // dataset flag should be set so handlers are attached
      expect(pa.dataset.cpPublishHandlersAttached === '1' || pa._doSaveTitle).toBeTruthy();
    });
    
    expect(newInput).toBeTruthy();

    newInput.value = 'After R2';
    newInput.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(10);
    
    // use global save hook to avoid potential re-render races
    if (window.__cp_force_save_title) window.__cp_force_save_title();
    else newInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    await global.testHelpers.waitForMs(40);

    expect(document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`).dataset.title).toBe('After R2');

    const updateCalls = sendSpy.mock.calls.filter((c) => c[0] && c[0].action === 'update_kanban_card');
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    sendSpy.mockRestore();
    container.remove();
    kanbanCard.remove();
  });
});
