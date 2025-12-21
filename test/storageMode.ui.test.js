/* test/storageMode.ui.test.js */

describe('Storage Mode - multi-select delete', () => {
  beforeAll(() => {
    global.chrome = global.chrome || {};
    global.chrome.runtime = global.chrome.runtime || {};
  });

  afterAll(() => {
    delete global.chrome;
  });

  test('select multiple stored images and delete them via batch API', async () => {
    // load module under test
    const { renderDraftMode } = require('../js/ui/storageMode.js');

    // mock runtime responses
    global.chrome.runtime.sendMessage = jest.fn((msg, cb) => {
      if (msg && msg.action === 'get_unified_gallery') {
        // return two storage images only (mark first as published)
        if (typeof cb === 'function') cb({ success: true, images: [
          { id: 's1', url: 'https://images.test/u1.png', timestamp: 1, originData: { storagePath: 'gs://bucket/u1.png' }, published: true },
          { id: 's2', url: 'https://images.test/u2.png', timestamp: 2, originData: { storagePath: 'gs://bucket/u2.png' } }
        ]});
        return;
      }

      if (msg && msg.action === 'delete_storage_images') {
        // verify payload
        if (typeof cb === 'function') cb({ success: true, results: (msg.data && msg.data.items || []).map(i => ({ id: i.id, success: true })) });
        return;
      }

      if (typeof cb === 'function') cb({ success: true });
    });

    // stub confirm to always accept
    const originalConfirm = global.confirm;
    global.confirm = () => true;

    // render UI
    const container = document.createElement('div');
    document.body.appendChild(container);
    renderDraftMode(container);

    // wait for loadUnifiedGallery async callback
    await new Promise((r) => setTimeout(r, 50));

    // ensure items rendered
    expect(document.querySelector('#storage-s1')).toBeTruthy();
    expect(document.querySelector('#storage-s2')).toBeTruthy();

    // published badge should exist for s1
    const badge = document.querySelector('#storage-s1 .storage-published-badge');
    expect(badge).toBeTruthy();
    expect(badge.title).toBe('발행됨');


    // select both checkboxes
    const cb1 = document.querySelector('#storage-s1 .storage-select-checkbox') || document.querySelector('#storage-s1 input.storage-select-checkbox');
    const cb2 = document.querySelector('#storage-s2 .storage-select-checkbox') || document.querySelector('#storage-s2 input.storage-select-checkbox');
    expect(cb1).toBeTruthy();
    expect(cb2).toBeTruthy();

    cb1.checked = true;
    cb1.dispatchEvent(new Event('change'));
    cb2.checked = true;
    cb2.dispatchEvent(new Event('change'));

    // click delete selected
    const delBtn = document.querySelector('#storage-delete-selected-btn');
    expect(delBtn).toBeTruthy();
    delBtn.click();

    // wait for async deletion
    await new Promise((r) => setTimeout(r, 50));

    // ensure sendMessage called for batch delete
    const calls = global.chrome.runtime.sendMessage.mock.calls.filter(c => c[0] && c[0].action === 'delete_storage_images');
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const payload = calls[0][0];
    expect(Array.isArray(payload.data.items)).toBe(true);
    expect(payload.data.items.length).toBe(2);

    // cleanup
    global.confirm = originalConfirm;
    document.body.removeChild(container);
  });
});
