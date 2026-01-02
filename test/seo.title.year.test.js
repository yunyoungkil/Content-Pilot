// test/seo.title.year.test.js

import { removeDuplicateYears } from '../js/services/aiService.js';

describe('removeDuplicateYears', () => {
  it('연속된 동일 년도 중복 제거 (한글 년 포함)', () => {
    const inTitle = '2024년 2024년 최고의 스마트홈 가이드';
    expect(removeDuplicateYears(inTitle)).toBe('2024년 최고의 스마트홈 가이드');
  });

  it('비연속 중복 년도 제거 (숫자만 존재)', () => {
    const inTitle = '스마트홈 2024 추천 - 2024 리뷰';
    expect(removeDuplicateYears(inTitle)).toBe('스마트홈 2024 추천 - 리뷰');
  });

  it('여러 연도가 등장하면 각 연도는 첫 등장만 유지', () => {
    const inTitle = '2023년/2024년 비교 - 2024 트렌드';
    expect(removeDuplicateYears(inTitle)).toBe('2023년/2024년 비교 - 트렌드');
  });

  it('공백 및 구두점 정리', () => {
    const inTitle = '2024  , 2024  스마트폰 리뷰  ,';
    expect(removeDuplicateYears(inTitle)).toBe('2024 스마트폰 리뷰,');
  });
});