import { renderChannelMode } from '../js/ui/channelMode.js';

describe('ChannelMode - apply/save flow', () => {
  beforeEach(() => {
    // 초기 스토리지 상태: 로그인된 상태로 가정
    testHelpers.mockChromeStorage({ googleUserEmail: 'test@example.com' });
    testHelpers.mockChromeRuntime();
    // storage.onChanged 이벤트 리스너를 사용하는 모듈이 있으므로 모크를 추가
    chrome.storage.onChanged = { addListener: jest.fn() };
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('clicking Apply in channel modal triggers save_channels_and_key', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    // Render channel mode
    renderChannelMode(container);

    // Wait a tick for initialization
    await testHelpers.waitForNextTick();

    // Open modal (simulate clicking add channel)
    const addBtn = container.querySelector('#add-my-channel-btn');
    expect(addBtn).toBeTruthy();
    addBtn.click();

    // Wait for modal render
    await testHelpers.waitForNextTick();

    const blogUrlEl = container.querySelector('#modal-blog-url');
    expect(blogUrlEl).toBeTruthy();
    // Input valid URL
    blogUrlEl.value = 'https://blog.example.com/user';

    // Click apply (로컬에 반영만 되고, 백엔드 저장은 아직 일어나지 않음)
    const applyBtn = container.querySelector('#modal-apply-btn');
    expect(applyBtn).toBeTruthy();
    applyBtn.click();
    await testHelpers.waitForMs(20);

    // 모달 적용 시에는 아직 백엔드 저장 호출이 없어야 함
    let saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(0);

    // 이제 '설정 저장하기' 버튼을 눌러 실제 저장을 수행
    const saveAllBtn = container.querySelector('#save-all-channels-btn');
    expect(saveAllBtn).toBeTruthy();
    saveAllBtn.click();
    await testHelpers.waitForMs(20);

    // 저장 요청이 한 번 발생해야 함
    saveCalls = chrome.runtime.sendMessage.mock.calls.filter((c) => c[0] && c[0].action === 'save_channels_and_key');
    expect(saveCalls.length).toBe(1);
  });
});
