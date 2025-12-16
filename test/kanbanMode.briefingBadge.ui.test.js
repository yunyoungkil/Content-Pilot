import { updateCardBadgesInPlace, renderKanban } from '../js/ui/kanbanMode.js';

describe('KanbanMode - Briefing Badge Update', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // Mock chrome API
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, cb) => {
              const data = { googleUserEmail: 'test@example.com', activeChannelId: 'test-channel' };
              if (typeof cb === 'function') {
                  cb(data);
              }
              return Promise.resolve(data);
          }),
          set: jest.fn(),
        },
        onChanged: { addListener: jest.fn() }
      },
      runtime: {
        sendMessage: jest.fn((msg, cb) => {
            if (msg.action === 'get_kanban_data') {
                if (cb) cb({ success: true, data: {
                    ideas: {
                        'card-1': { title: 'Test Card', briefingStatus: 'queued' }
                    }
                }});
            }
        }),
        onMessage: { addListener: jest.fn() }
      }
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
  });

  test('updateCardBadgesInPlace updates the badge correctly', async () => {
    // Manually inject the card structure that matches what renderKanban produces
    // We need to set the global kanbanContainer variable in kanbanMode.js by calling renderKanban first
    // or by mocking it if it was exported (it's not).
    // However, renderKanban sets the module-level variable `kanbanContainer`.
    
    renderKanban(container);
    
    // Overwrite innerHTML to ensure we have the card we want to test
    container.innerHTML = `
      <div id="cp-kanban-board-root">
        <div class="cp-kanban-col" data-status="ideas">
            <div class="cp-kanban-card" data-id="card-1">
                <div class="kanban-card-meta">
                    <span class="briefing-status-tag queued">⏳ 브리핑 대기</span>
                </div>
            </div>
        </div>
      </div>
    `;
    
    // Call updateCardBadgesInPlace
    updateCardBadgesInPlace('card-1', { briefingStatus: 'processing', briefingProgress: 50 });
    
    const card = container.querySelector('[data-id="card-1"]');
    const badge = card.querySelector('.briefing-status-tag');
    
    expect(badge).toBeTruthy();
    expect(badge.classList.contains('processing')).toBe(true);
    expect(badge.textContent).toContain('50%');
  });
});
