import { updateCardBadgesInPlace, renderKanban, addKanbanEventListeners } from '../js/ui/kanbanMode.js';

describe('KanbanMode - Realtime Progress Update', () => {
  let container;
  let messageListener;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    
    // Mock chrome API
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, cb) => {
              const data = { googleUserEmail: 'test@example.com', activeChannelId: 'test-channel' };
              if (typeof cb === 'function') cb(data);
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
                        'card-progress-1': { title: 'Progress Test Card', briefingStatus: 'processing', briefingProgress: 0 }
                    }
                }});
            }
        }),
        onMessage: { 
            addListener: jest.fn((fn) => {
                messageListener = fn;
            }) 
        }
      }
    };
  });

  afterEach(() => {
    document.body.innerHTML = '';
    jest.clearAllMocks();
    messageListener = null;
  });

  test('responds to kanban_card_progress_updated message', async () => {
    // 1. Render Kanban
    renderKanban(container);
    
    // 2. Simulate initial render completion (manually inject card since loadKanbanData is async/mocked)
    container.innerHTML = `
      <div id="cp-kanban-board-root">
        <div class="cp-kanban-col" data-status="ideas">
            <div class="cp-kanban-card" data-id="card-progress-1">
                <div class="kanban-card-meta">
                    <span class="briefing-status-tag processing">🔄 0%</span>
                </div>
            </div>
        </div>
      </div>
    `;

    // 3. Trigger the message listener with a progress update
    if (messageListener) {
        messageListener({
            action: 'kanban_card_progress_updated',
            cardId: 'card-progress-1',
            progress: 50
        });
    }

    // 4. Verify DOM update
    const card = container.querySelector('[data-id="card-progress-1"]');
    const badge = card.querySelector('.briefing-status-tag');
    
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('50%');
    expect(badge.querySelector('.briefing-progress-bar').style.width).toBe('50%');
  });
});
