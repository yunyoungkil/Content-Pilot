import { ensureGalleryGridClickHandler } from '../js/ui/workspaceMode';

describe('ensureGalleryGridClickHandler', () => {
  let grid;
  beforeEach(() => {
    // ensure clean DOM
    document.body.innerHTML = '';
    grid = document.createElement('div');
    grid.className = 'image-gallery-grid';
    document.body.appendChild(grid);
  });

  test('attaches delegated click handler only once (idempotent)', () => {
    const img = document.createElement('img');
    img.className = 'gallery-thumb';
    img.dataset.src = 'https://example.com/a.jpg';
    grid.appendChild(img);

    const sendCommand = jest.fn();

    // call twice; handler should only be attached once
    ensureGalleryGridClickHandler(grid, sendCommand);
    ensureGalleryGridClickHandler(grid, sendCommand);

    const clickEvent = new MouseEvent('click', { bubbles: true });
    img.dispatchEvent(clickEvent);

    // Since handler calls sendCommand twice per click (insert-image + focus), total should be 2
    expect(sendCommand).toHaveBeenCalledTimes(2);
    expect(sendCommand.mock.calls[0][0]).toBe('insert-image');
    expect(sendCommand.mock.calls[1][0]).toBe('focus');
  });
});
