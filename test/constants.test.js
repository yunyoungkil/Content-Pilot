// test/constants.test.js

import {
  MODES,
  COLLECTIONS,
  KANBAN_STATUS,
  AI_MODELS,
  VIEW_MODES,
  CLASSNAMES,
  EVENTS,
  USER_ID,
  APP_CONFIG,
  LIMITS,
} from '../js/constants.js';

/**
 * 상수 정의 검증 테스트
 */
describe('Constants', () => {
  describe('MODES', () => {
    test('should have all required mode constants', () => {
      expect(MODES.SCRAPBOOK).toBe('scrapbook');
      expect(MODES.KANBAN).toBe('kanban');
      expect(MODES.DRAFT).toBe('draft');
    });

    test('should have exactly 3 modes', () => {
      expect(Object.keys(MODES)).toHaveLength(3);
    });
  });

  describe('COLLECTIONS', () => {
    test('should have all required Firebase collection paths', () => {
      expect(COLLECTIONS.KANBAN).toBe('kanban');
      expect(COLLECTIONS.SCRAPS).toBe('scraps');
      expect(COLLECTIONS.CHANNELS).toBe('channels');
      expect(COLLECTIONS.CHANNEL_CONTENT).toBe('channel_content');
      expect(COLLECTIONS.CHANNEL_META).toBe('channel_meta');
      expect(COLLECTIONS.THUMBNAIL_TEMPLATES).toBe('thumbnail_templates');
      expect(COLLECTIONS.AFFILIATE_LINKS).toBe('affiliate_links');
      expect(COLLECTIONS.THUMBNAILS_STORAGE).toBe('thumbnails');
    });

    test('should have exactly 8 collections', () => {
      expect(Object.keys(COLLECTIONS)).toHaveLength(8);
    });
  });

  describe('KANBAN_STATUS', () => {
    test('should have all required kanban status values', () => {
      expect(KANBAN_STATUS.IDEAS).toBe('ideas');
      expect(KANBAN_STATUS.IN_PROGRESS).toBe('in-progress');
      expect(KANBAN_STATUS.DONE).toBe('done');
      expect(KANBAN_STATUS.PUBLISHED).toBe('published');
    });

    test('should have exactly 4 status values', () => {
      expect(Object.keys(KANBAN_STATUS)).toHaveLength(4);
    });
  });

  describe("AI_MODELS", () => {
    test("should have all required AI model versions", () => {
      expect(AI_MODELS.TEXT).toBe("gemini-2.0-flash");
      expect(AI_MODELS.IMAGE).toBe("gemini-3.0-pro-image-preview");
      expect(AI_MODELS.VISION).toBe("gemini-3.0-pro-image-preview");
    });

    test('should have exactly 3 AI models', () => {
      expect(Object.keys(AI_MODELS)).toHaveLength(3);
    });
  });

  describe('VIEW_MODES', () => {
    test('should have all required view modes', () => {
      expect(VIEW_MODES.DASHBOARD).toBe('dashboard');
      expect(VIEW_MODES.KANBAN).toBe('kanban');
      expect(VIEW_MODES.SCRAPBOOK).toBe('scrapbook');
      expect(VIEW_MODES.CHANNELS).toBe('channels');
      expect(VIEW_MODES.PERFORMANCE).toBe('performance');
      expect(VIEW_MODES.ADMIN).toBe('admin');
    });

    test('should have exactly 6 view modes', () => {
      expect(Object.keys(VIEW_MODES)).toHaveLength(6);
    });
  });

  describe('CLASSNAMES', () => {
    test('should have required CSS class names', () => {
      expect(CLASSNAMES.PANEL).toBe('content-pilot-panel');
      expect(CLASSNAMES.HEADER).toBe('content-pilot-header');
    });

    test('should have at least 2 class names', () => {
      expect(Object.keys(CLASSNAMES).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('EVENTS', () => {
    test('should have required event names', () => {
      expect(EVENTS.TOGGLE_PANEL).toBe('cp-toggle-panel');
    });

    test('should have at least 1 event', () => {
      expect(Object.keys(EVENTS).length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('USER_ID', () => {
    test('should be a string', () => {
      expect(typeof USER_ID).toBe('string');
      expect(USER_ID).toBe('default_user');
    });
  });

  describe('APP_CONFIG', () => {
    test('should have all required app configuration', () => {
      expect(APP_CONFIG.APP_NAME).toBe('Content Pilot');
      expect(APP_CONFIG.VERSION).toBe('1.0.0');
      expect(APP_CONFIG.USER_ID).toBe('yunyoungkil');
    });

    test('should have exactly 3 config properties', () => {
      expect(Object.keys(APP_CONFIG)).toHaveLength(3);
    });
  });

  describe('LIMITS', () => {
    test('should have all required limit values', () => {
      expect(LIMITS.MAX_SCRAPS).toBe(100);
      expect(LIMITS.MAX_HISTORY).toBe(50);
      expect(LIMITS.ITEMS_PER_PAGE).toBe(5);
    });

    test('should have exactly 3 limits', () => {
      expect(Object.keys(LIMITS)).toHaveLength(3);
    });

    test('should have positive limit values', () => {
      expect(LIMITS.MAX_SCRAPS).toBeGreaterThan(0);
      expect(LIMITS.MAX_HISTORY).toBeGreaterThan(0);
    });
  });
});
