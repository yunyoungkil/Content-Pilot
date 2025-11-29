jest.mock('../js/services/firebaseService.js', () => {
  return {
    getDb: jest.fn(() => ({})),
    ref: jest.fn((db, path) => path),
    get: jest.fn(async (path) => ({ val: () => null })),
    set: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getCurrentUserId: jest.fn(async () => 'user-xyz'),
  };
});

import { fetchAllChannelData } from '../js/services/collectorService.js';
import * as firebaseService from '../js/services/firebaseService.js';

describe('collectorService dynamic userId', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('fetchAllChannelData uses getCurrentUserId when reading channels', async () => {
    await fetchAllChannelData();
    expect(firebaseService.ref).toHaveBeenCalled();
    // The first ref call should be for channels/{userId}
    const calledWith = firebaseService.ref.mock.calls[0][1];
    expect(calledWith).toBe('channels/user-xyz');
  });
});
