import { renderKanban, addKanbanEventListeners } from "../js/ui/kanbanMode.js";

// Ensure we have a mock chrome global for these UI tests
beforeEach(() => {
  global.chrome = {
    runtime: {
      sendMessage: jest.fn((msg, cb) => {
        // default fallback - respond success
        if (typeof cb === 'function') cb({ success: true });
        return true;
      }),
      onMessage: {
        addListener: jest.fn(),
      },
    },
    storage: {
      local: {
        get: jest.fn((keyOrKeys, cb) => {
          // respond with a default activeChannelId if requested
          if (typeof keyOrKeys === 'string') {
            const k = keyOrKeys;
            const res = {};
            if (k === 'activeChannelId') res.activeChannelId = 'test-channel';
            cb(res);
          } else cb({ activeChannelId: 'test-channel' });
        }),
      },
      onChanged: {
        addListener: jest.fn(),
      },
    },
  };

  // reset document body
  document.body.innerHTML = '';
});

describe('Kanban add card — AI SEO suggestions', () => {
  test('AI button generates suggestions and submitting includes them in payload', async () => {
    // Replace runtime.sendMessage with a test-friendly mock to handle call_gemini and add_idea_to_kanban
    const capturedMessages = [];
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      capturedMessages.push(msg);

      if (msg.action === 'call_gemini') {
        // Return a JSON response text
        const resText = JSON.stringify({
          recommendedSearches: ['seo-key1', 'seo-key2'],
          longTailKeywords: ['how to seo-key1 for beginners', 'best seo-key2 tips'],
          outline: ['도입부', '핵심 포인트', '결론'],
        });
        if (typeof cb === 'function') cb({ success: true, text: resText });
        return true;
      }

      if (msg.action === 'add_idea_to_kanban') {
        // Ensure the payload was passed
        if (typeof cb === 'function') cb({ success: true });
        return true;
      }

      // default
      if (typeof cb === 'function') cb({ success: true });
      return true;
    });

    // Render the kanban UI
    const container = document.createElement('div');
    document.body.appendChild(container);

    renderKanban(container);
    // attach delegated listeners used for add-card clicks
    addKanbanEventListeners(container);

    // Wait for any initial async steps
    await new Promise((r) => setTimeout(r, 0));

    // Find the add card button for ideas and click it
    const addBtn = container.querySelector('.kanban-add-card-btn[data-status="ideas"]');
    expect(addBtn).toBeTruthy();
    addBtn.click();

    // Input should appear
    const inputWrapper = container.querySelector('.kanban-add-card-input-wrapper');
    expect(inputWrapper).toBeTruthy();

    const textarea = inputWrapper.querySelector('.kanban-add-card-input');
    const aiBtn = inputWrapper.querySelector('.kanban-add-card-ai-btn');
    const submitBtn = inputWrapper.querySelector('.kanban-add-card-submit-btn');
    expect(textarea).toBeTruthy();
    expect(aiBtn).toBeTruthy();
    expect(submitBtn).toBeTruthy();

    // Enter a title
    textarea.value = '테스트 아이디어 제목';

    // Click AI generate
    aiBtn.click();

    // Allow async callback to finish
    await new Promise((r) => setTimeout(r, 0));

    // After AI call, suggestions UI should be visible and stored on wrapper
    expect(inputWrapper._aiSuggestions).toBeTruthy();
    expect(inputWrapper._aiSuggestions.recommendedSearches).toEqual(['seo-key1', 'seo-key2']);

    // Click submit and ensure add_idea_to_kanban is sent with suggestion fields
    submitBtn.click();

    // Wait for submit async
    await new Promise((r) => setTimeout(r, 0));

    const addIdeaCalls = capturedMessages.filter((m) => m.action === 'add_idea_to_kanban');
    expect(addIdeaCalls.length).toBeGreaterThan(0);

    // Data was sent as JSON string in msg.data
    const lastAdd = addIdeaCalls[addIdeaCalls.length - 1];
    const payload = JSON.parse(lastAdd.data);
    expect(payload.title).toBe('테스트 아이디어 제목');
    expect(payload.recommendedSearches).toEqual(['seo-key1', 'seo-key2']);
    expect(payload.longTailKeywords).toEqual(['how to seo-key1 for beginners', 'best seo-key2 tips']);
    expect(payload.outline).toEqual(['도입부', '핵심 포인트', '결론']);
  });
});
