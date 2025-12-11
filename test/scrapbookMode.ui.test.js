import { jest } from '@jest/globals';

import { renderScrapbook } from '../js/ui/scrapbookMode.js';

describe('scrapbookMode UI', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    // minimal chrome mock used by renderScrapbook
    global.chrome = {
      storage: {
        local: {
          get: jest.fn((keys, cb) => cb({ googleUserEmail: 'test@user', activeChannelId: null })),
        },
        onChanged: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      runtime: {
        sendMessage: jest.fn(
          (msg, cb) =>
            cb &&
            cb({
              data: [
                {
                  id: 'scrap-1',
                  title: '제목',
                  text: '본문',
                  url: 'http://example.com',
                  timestamp: Date.now(),
                  image: null,
                  allImages: [],
                },
              ],
            })
        ),
        onMessage: { addListener: jest.fn(), removeListener: jest.fn() },
      },
      tabs: { query: jest.fn(([, cb]) => cb([])) },
    };
  });

  test('renders the detail view with convert-to-idea button at the top', (done) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    // render
    renderScrapbook(container);

    setTimeout(() => {
      // should have a scrap list
      const card = container.querySelector('.scrap-card');
      expect(card).toBeTruthy();

      // simulate click to render detail
      card.click();

      setTimeout(() => {
        const detailCard = container.querySelector('.scrapbook-detail-card');
        expect(detailCard).toBeTruthy();
        const actionBtn = detailCard.querySelector('.scrap-to-idea-btn');
        const title = detailCard.querySelector('.scrapbook-detail-title');
        expect(actionBtn).toBeTruthy();
        expect(title).toBeTruthy();

        // Verify the action button is positioned at the top (inside the header row)
        const headerRow = detailCard.firstElementChild;
        expect(headerRow.contains(actionBtn)).toBeTruthy();
        expect(headerRow.contains(title)).toBeTruthy();
        done();
      }, 20);
    }, 20);
  });

  test('updates scrap list when scraps_data_updated is received', (done) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderScrapbook(container);

    setTimeout(() => {
      const listContainer = container.querySelector('.scrapbook-list-cards');
      expect(listContainer).toBeTruthy();
      // initially, a single scrap was loaded by our runtime.sendMessage mock
      expect(listContainer.querySelectorAll('.scrap-card').length).toBeGreaterThanOrEqual(1);

      // create a new scrap to simulate an update
      const newScrap = {
        id: 'scrap-2',
        title: '새로 저장된 스크랩',
        text: '본문2',
        url: 'http://example2/',
        timestamp: Date.now(),
        image: null,
        allImages: [],
      };

      // get the registered onMessage listener and invoke it with 'scraps_data_updated'
      const addedListeners = chrome.runtime.onMessage.addListener.mock.calls;
      const lastListener = addedListeners[addedListeners.length - 1][0];
      // call listener
      lastListener({ action: 'scraps_data_updated', scraps: [newScrap] }, {}, () => {});

      setTimeout(() => {
        // list should be updated
        const cards = listContainer.querySelectorAll('.scrap-card');
        expect(cards.length).toBeGreaterThanOrEqual(1);
        expect(Array.from(cards).some((c) => c.dataset.id === 'scrap-2')).toBeTruthy();
        done();
      }, 20);
    }, 20);
  });
});
