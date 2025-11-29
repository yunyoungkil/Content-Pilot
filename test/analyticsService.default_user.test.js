jest.mock('../js/services/firebaseService.js', () => {
  return {
    CONSTANTS: { USER_ID: 'default_user' },
    getDb: jest.fn(() => ({})),
    ref: jest.fn((db, path) => path),
    get: jest.fn(async (path) => ({ val: () => null })),
    set: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    getCurrentUserId: jest.fn(async () => 'default_user'),
    initializeFirebase: jest.fn(() => true),
  };
});

import * as analyticsService from '../js/services/analyticsService.js';
import * as firebaseService from '../js/services/firebaseService.js';

describe('analyticsService default_user guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('updateSinglePerformanceMetric aborts when user is default_user and not write to DB', async () => {
    // We expect the function to abort without attempting database writes when
    // the resolved user ID is the placeholder 'default_user'. We don't assert
    // on sendErrorToUI directly here because of module-local references; the
    // important invariant is: no DB writes occur.
    await analyticsService.updateSinglePerformanceMetric({ id: 'c1', path: 'kanban/default_user/ideas/c1', url: 'https://example.com' });
    expect(firebaseService.update).not.toHaveBeenCalled();
  });
});
