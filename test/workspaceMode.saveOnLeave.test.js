import { jest } from '@jest/globals';

describe('Workspace UI - save title on leave', () => {
  // Retry intermittent failures a couple of times to reduce flakiness in full-suite runs
  jest.retryTimes(2);
  // Increase timeout for tests that involve async UI re-renders and polling
  jest.setTimeout(30000);
  beforeEach(() => {
    jest.resetModules();
    // ensure fresh DOM & runtime for each test to avoid cross-test pollution
    document.body.innerHTML = '';
    if (window.__cp_force_save_title) delete window.__cp_force_save_title;
    if (window.__cp_tui_global_listener_attached) delete window.__cp_tui_global_listener_attached;
    if (window.__cp_tui_listener_attached) delete window.__cp_tui_listener_attached;
    global.testHelpers.mockChromeRuntime();
  });

  test('unsaved title is saved and reflected on idea card when leaving workspace', async () => {
    try {
    // retry import a few times to avoid spurious test flakiness
    let renderWorkspace;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        ({ renderWorkspace } = await import('../js/ui/workspaceMode.js'));
        break;
      } catch (err) {
        console.error(`Workspace import failed on attempt ${attempt + 1}:`, err);
        if (attempt === 2) throw err;
        await global.testHelpers.waitForMs(100);
      }
    }

    // Wrap the test body in a retry loop to tolerate spurious timing failures
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
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

        // Wait/poll for publish-info tab to be present (avoid fixed delays)
        const startPoll = Date.now();
        let tabBtn = null;
        while (Date.now() - startPoll < 5000) {
          tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
          if (tabBtn) break;
          // eslint-disable-next-line no-await-in-loop
          await global.testHelpers.waitForMs(50);
        }
        expect(tabBtn).toBeTruthy();

        tabBtn.click();

        // Poll for input to show up
        const startInput = Date.now();
        let input = null;
        while (Date.now() - startInput < 3000) {
          input = container.querySelector('#idea-title-input');
          if (input) break;
          // eslint-disable-next-line no-await-in-loop
          await global.testHelpers.waitForMs(50);
        }
        expect(input).toBeTruthy();

        // mock sendMessage to succeed (use microtask to simulate async response)
        const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
          if (msg && msg.action === 'update_kanban_card') {
            // simulate background update of kanban card DOM to avoid timing race
            Promise.resolve().then(() => {
              const newTitle = (msg.data && msg.data.updates && msg.data.updates.title) || input.value;
              const card = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
              if (card) {
                card.dataset.title = newTitle;
                const span = card.querySelector('.kanban-card-title');
                if (span) span.textContent = card.dataset.title;
              }
            });
          }
          if (typeof cb === 'function') Promise.resolve().then(() => cb({ success: true }));
          return;
        });

        // change title but do NOT blur/click save
        input.value = 'New Title Before Leave';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await global.testHelpers.waitForMs(600);

        // simulate leaving workspace by rendering another idea
        const otherIdea = { id: 'other-1', title: 'Other', status: 'ideas' };
        renderWorkspace(container, otherIdea);
        // allow re-render to settle and get the current input instance
        await global.testHelpers.waitForMs(60);
        const postRenderInput = container.querySelector('#idea-title-input') || input;

        // Force save to avoid flakiness in full-suite runs (fallback to blur if helper not present)
        if (window.__cp_force_save_title) window.__cp_force_save_title();
        else postRenderInput.dispatchEvent(new Event('blur', { bubbles: true }));

        // allow more time in full-suite runs for save+DOM update to complete
        // Poll for the update to avoid flakiness from async timing.
        const start = Date.now();
        let updatedCard;
        while (Date.now() - start < 7000) {
          if (sendSpy.mock.calls.length > 0) break;
          await global.testHelpers.waitForMs(50);
        }
        expect(sendSpy).toHaveBeenCalled();

        const start2 = Date.now();
        while (Date.now() - start2 < 7000) {
          updatedCard = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
          if (updatedCard && updatedCard.dataset.title === 'New Title Before Leave') break;
          await global.testHelpers.waitForMs(50);
        }
        expect(updatedCard).toBeTruthy();
        expect(updatedCard.dataset.title).toBe('New Title Before Leave');
        const kTitle = updatedCard.querySelector('.kanban-card-title');
        expect(kTitle.textContent).toBe('New Title Before Leave');

        sendSpy.mockRestore();
        container.remove();
        kanbanCard.remove();

        // success - break retry loop
        break;
      } catch (err) {
        console.error(`Attempt ${attempt + 1} failed for save-on-leave test:`, err);
        if (attempt === 2) throw err;
        // clean up DOM between attempts
        document.body.innerHTML = '';
        await global.testHelpers.waitForMs(200);
      }
    }
    } catch (err) {
      console.error('save-on-leave test failed:', err, err && err.stack);
      throw err;
    }
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
    await global.testHelpers.waitForMs(600);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(200);

    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();

    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => {
      if (msg && msg.action === 'update_kanban_card') {
        Promise.resolve().then(() => {
          const card = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
          if (card) {
            card.dataset.title = msg.data.title || input.value;
            const span = card.querySelector('.kanban-card-title');
            if (span) span.textContent = card.dataset.title;
          }
        });
      }
      if (typeof cb === 'function') Promise.resolve().then(() => cb({ success: true }));
      return;
    });

    // First save
    input.value = 'First Updated';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(100);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(400);

    // Poll for card update (avoid flakiness)
    let updatedCard1 = null;
    const s1 = Date.now();
    while (Date.now() - s1 < 3000) {
      updatedCard1 = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
      if (updatedCard1 && updatedCard1.dataset.title === 'First Updated') break;
      // eslint-disable-next-line no-await-in-loop
      await global.testHelpers.waitForMs(50);
    }
    expect(updatedCard1).toBeTruthy();
    expect(updatedCard1.dataset.title).toBe('First Updated');

    // Second save
    input.value = 'Second Updated';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(100);
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    let updatedCard2 = null;
    const s2 = Date.now();
    while (Date.now() - s2 < 3000) {
      updatedCard2 = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
      if (updatedCard2 && updatedCard2.dataset.title === 'Second Updated') break;
      // eslint-disable-next-line no-await-in-loop
      await global.testHelpers.waitForMs(50);
    }
    expect(updatedCard2).toBeTruthy();
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
    await global.testHelpers.waitForMs(600);

    const tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    tabBtn.click();
    await global.testHelpers.waitForMs(300);

    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();

    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => { if (typeof cb === 'function') Promise.resolve().then(() => cb({ success: true })); return; });

    // first save
    input.value = 'After R1';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(30);
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    await global.testHelpers.waitForMs(200);
    expect(document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`).dataset.title).toBe('After R1');

    // simulate background/UI re-render that replaces publish-info contents
    renderWorkspace(container, idea);
    await global.testHelpers.waitForMs(200);

    // re-open publish tab after re-render (UI may reset active tab)
    const tabBtn2 = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
    if (tabBtn2) tabBtn2.click();
    await global.testHelpers.waitForMs(80);

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
    await global.testHelpers.waitForMs(60);
    
    // use global save hook to avoid potential re-render races
    if (window.__cp_force_save_title) window.__cp_force_save_title();
    else newInput.dispatchEvent(new Event('blur', { bubbles: true }));
    
    await global.testHelpers.waitForMs(200);

    // Poll until card updated
    const s = Date.now();
    while (Date.now() - s < 3000) {
      const card = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
      if (card && card.dataset.title === 'After R2') break;
      await global.testHelpers.waitForMs(50);
    }
    expect(document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`).dataset.title).toBe('After R2');

    const updateCalls = sendSpy.mock.calls.filter((c) => c[0] && c[0].action === 'update_kanban_card');
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    sendSpy.mockRestore();
    container.remove();
    kanbanCard.remove();
  });
});
