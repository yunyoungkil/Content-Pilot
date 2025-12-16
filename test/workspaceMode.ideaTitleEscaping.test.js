import { jest } from '@jest/globals';

describe('Workspace UI - idea title escaping and save', () => {
  beforeEach(() => {
    jest.resetModules();
    chrome.storage.local.get.mockResolvedValue({ activeChannelId: 'channel-1' });
    global.testHelpers.mockChromeRuntime();
    // Ensure DOM is clean between tests
    document.body.innerHTML = '';
  });

  test('idea title with quotes does not break publish-info DOM and can be edited/saved', async () => {
    const { renderWorkspace } = await import('../js/ui/workspaceMode.js');

    const badTitle = '20 더보기 베스트순 최신순 모든 별점 오순이라네 2025.11.08 판매자: 쿠팡(주) [10f삼성전자 Bespoke AI LCD 콤보 세탁기 109.2mm WD80';

    const idea = {
      id: 'card-bad-title',
      title: badTitle,
      status: 'ideas',
      publishInfo: {},
    };

    // create a fake kanban card in the DOM so workspace save updates can be observed
    const fakeKanbanCard = document.createElement('div');
    fakeKanbanCard.className = 'cp-kanban-card';
    fakeKanbanCard.dataset.id = idea.id;
    fakeKanbanCard.dataset.title = idea.title;
    fakeKanbanCard.innerHTML = `<span class="kanban-card-title">${idea.title}</span>`;
    document.body.appendChild(fakeKanbanCard);

    const container = document.createElement('div');
    document.body.appendChild(container);
    renderWorkspace(container, idea);

    // wait and open publish-info (poll for availability to avoid timing issues)
    let tabBtn = null;
    for (let i = 0; i < 40; i++) {
      tabBtn = container.querySelector('.resource-tab-btn[data-tab="publish-info"]');
      if (tabBtn) break;
      await global.testHelpers.waitForMs(25);
    }
    expect(tabBtn).toBeTruthy();
    tabBtn.click();
    await global.testHelpers.waitForMs(150);

    // idea-title input should exist and contain the original string (unaltered)
    const input = container.querySelector('#idea-title-input');
    expect(input).toBeTruthy();
    expect(input.value).toBe(badTitle);

    // mock sendMessage to always succeed for this save
    const sendSpy = jest.spyOn(chrome.runtime, 'sendMessage').mockImplementation((msg, cb) => cb({ success: true }));

    input.value = badTitle + ' X';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await global.testHelpers.waitForMs(50);

    // trigger blur to perform save and poll until the underlying data/kanban card is updated
    input.dispatchEvent(new Event('blur', { bubbles: true }));

    let kanbanCard = null;
    for (let i = 0; i < 40; i++) {
      if (idea.title === badTitle + ' X') break;
      await global.testHelpers.waitForMs(25);
    }

    // Verify underlying data and kanban card updated instead of header
    kanbanCard = document.querySelector(`.cp-kanban-card[data-id="${idea.id}"]`);
    expect(idea.title).toBe(badTitle + ' X');
    expect(kanbanCard).toBeTruthy();
    if (kanbanCard) {
      // poll for dataset/title text update too
      for (let i = 0; i < 40; i++) {
        if (kanbanCard.dataset.title === badTitle + ' X') break;
        await global.testHelpers.waitForMs(25);
      }
      expect(kanbanCard.dataset.title).toBe(badTitle + ' X');
      const kTitle = kanbanCard.querySelector('.kanban-card-title');
      if (kTitle) expect(kTitle.textContent).toBe(badTitle + ' X');
    }

    sendSpy.mockRestore();
    container.remove();
  });
});
