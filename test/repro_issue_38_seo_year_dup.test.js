import { normalizeSeoTitle } from '../js/utils.js';

describe('normalizeSeoTitle - year duplication cases', () => {
  test('collapses duplicated years separated by space', () => {
    const ideaTitle = 'My Great Idea';
    expect(normalizeSeoTitle('My Great Idea 2025 2025', ideaTitle)).toBe('My Great Idea 2025');
  });

  test('collapses duplicated years with separators', () => {
    const ideaTitle = 'My Great Idea';
    expect(normalizeSeoTitle('My Great Idea - 2025 - 2025', ideaTitle)).toBe('My Great Idea - 2025');
    expect(normalizeSeoTitle('My Great Idea: 2025: 2025', ideaTitle)).toBe('My Great Idea: 2025');
  });

  test('does not alter titles that contain different years', () => {
    const ideaTitle = 'My Great Idea';
    expect(normalizeSeoTitle('My Great Idea 2024 2025', ideaTitle)).toBe('My Great Idea 2024 2025');
  });
});