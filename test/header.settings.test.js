import { renderPanelHeader, addHeaderEventListeners } from '../js/ui/header.js';

describe('Header settings button', () => {
  test('toggles settings menu when clicked and continues to work after header re-render', async () => {
    const shadowRoot = document.createElement('div');
    // ensure requestAnimationFrame runs immediately in tests
    if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => cb();

    // initial render
    shadowRoot.innerHTML = renderPanelHeader();

    document.body.appendChild(shadowRoot);

    // ensure chrome.storage.get won't throw when awaited inside init
    chrome.storage.local.get = jest.fn(() => Promise.resolve({ activeChannelId: null }));

    // attach listeners (the function uses requestAnimationFrame internally)
    addHeaderEventListeners(shadowRoot);

    // wait for RAF / next tick
    await global.testHelpers.waitForNextTick();

    const btn = shadowRoot.querySelector('#cp-settings-btn');
    const menu = shadowRoot.querySelector('#cp-settings-menu');

    expect(btn).toBeTruthy();
    expect(menu).toBeTruthy();

    // should be hidden initially
    expect(menu.style.display === '' || menu.style.display === 'none').toBeTruthy();

    // click to open
    btn.click();
    expect(menu.style.display === 'block').toBeTruthy();

    // click to close
    btn.click();
    expect(menu.style.display === 'none').toBeTruthy();

    // Now re-render header (simulate header replacement) - keep same shadowRoot
    shadowRoot.innerHTML = renderPanelHeader();

    // The delegated handler should still work since it queries the DOM dynamically
    await global.testHelpers.waitForNextTick();

    const btn2 = shadowRoot.querySelector('#cp-settings-btn');
    const menu2 = shadowRoot.querySelector('#cp-settings-menu');

    expect(btn2).toBeTruthy();
    expect(menu2).toBeTruthy();

    // open after re-render
    btn2.click();
    expect(menu2.style.display === 'block').toBeTruthy();

    // ensure close also works
    btn2.click();
    expect(menu2.style.display === 'none').toBeTruthy();
  });
});
