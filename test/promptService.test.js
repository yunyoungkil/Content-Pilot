const { PROMPT_CONFIG, PromptBuilder, detectPersona } = require('../js/services/promptService.js');

describe('PromptService', () => {
  describe('PROMPT_CONFIG', () => {
    test('should have all required persona configurations', () => {
      expect(PROMPT_CONFIG.personas).toHaveProperty('professional');
      expect(PROMPT_CONFIG.personas).toHaveProperty('friendly');
      expect(PROMPT_CONFIG.personas).toHaveProperty('viral');

      expect(PROMPT_CONFIG.personas.professional).toHaveProperty('name', '전문가형');
      expect(PROMPT_CONFIG.personas.friendly).toHaveProperty('name', '친근한형');
      expect(PROMPT_CONFIG.personas.viral).toHaveProperty('name', '바이럴형');
    });

    test('should have all required tone configurations', () => {
      expect(PROMPT_CONFIG.tones).toHaveProperty('logical');
      expect(PROMPT_CONFIG.tones).toHaveProperty('emotional');
      expect(PROMPT_CONFIG.tones).toHaveProperty('impact');
    });

    test('should have all required skill configurations', () => {
      expect(PROMPT_CONFIG.skills).toHaveProperty('questioning');
      expect(PROMPT_CONFIG.skills).toHaveProperty('statistics');
      expect(PROMPT_CONFIG.skills).toHaveProperty('storytelling');
      expect(PROMPT_CONFIG.skills).toHaveProperty('comparison');
      expect(PROMPT_CONFIG.skills).toHaveProperty('cliffhanger');
    });
  });

  describe('PromptBuilder', () => {
    let builder;

    beforeEach(() => {
      builder = new PromptBuilder();
    });

    test('should initialize with default persona', () => {
      expect(builder.getPersonaName()).toBe('전문가형');
      expect(builder.getToneName()).toBe('logical');
    });

    test('should initialize with specified persona', () => {
      const friendlyBuilder = new PromptBuilder('friendly');
      expect(friendlyBuilder.getPersonaName()).toBe('친근한형');
      expect(friendlyBuilder.getToneName()).toBe('emotional');
    });

    test('should handle invalid persona gracefully', () => {
      const invalidBuilder = new PromptBuilder('invalid');
      expect(invalidBuilder.getPersonaName()).toBe('전문가형'); // fallback to professional
    });

    test('should set tone correctly', () => {
      builder.setTone('impact');
      expect(builder.getToneName()).toBe('impact');
    });

    test('should ignore invalid tone', () => {
      builder.setTone('invalid');
      expect(builder.getToneName()).toBe('logical'); // remains default
    });

    test('should add skills correctly', () => {
      builder.addSkill('questioning');
      builder.addSkill('statistics');

      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('[스킬: 질문 던지기]');
      expect(prompt).toContain('[스킬: 수치 증명]');
    });

    test('should ignore invalid skills', () => {
      builder.addSkill('invalidSkill');

      const prompt = builder.buildSystemPrompt();
      expect(prompt).not.toContain('invalidSkill');
    });

    test('should set trend context correctly', () => {
      const keywords = ['AI', '기술'];
      const trends = ['머신러닝', '자동화'];

      builder.setTrendContext(keywords, trends);

      const prompt = builder.buildSystemPrompt();
      expect(prompt).toContain('핵심 키워드: AI, 기술');
      expect(prompt).toContain('연관 트렌드: 머신러닝, 자동화');
    });

    test('should handle empty trend context', () => {
      builder.setTrendContext([], []);

      const prompt = builder.buildSystemPrompt();
      expect(prompt).not.toContain('Trend Data & Context');
    });

    test('should build complete system prompt', () => {
      builder.setTone('emotional');
      builder.addSkill('storytelling');
      builder.setTrendContext(['테스트'], ['트렌드']);

      const prompt = builder.buildSystemPrompt();

      expect(prompt).toContain('[System Instruction]');
      expect(prompt).toContain('10년 차 권위 있는 전문가'); // persona instruction
      expect(prompt).toContain('감성적이고 따뜻한 어조'); // emotional tone
      expect(prompt).toContain('[스킬: 스토리텔링]');
      expect(prompt).toContain('핵심 키워드: 테스트');
    });
  });

  describe('detectPersona', () => {
    test('should detect friendly persona for casual content', () => {
      const content = '맛집 후기 솔직 리뷰 내돈내산 추천';
      expect(detectPersona(content)).toBe('friendly');
    });

    test('should detect professional persona for analytical content', () => {
      const content = '시장 분석 데이터 통계 가이드 사용법';
      expect(detectPersona(content)).toBe('professional');
    });

    test('should detect viral persona for sensational content', () => {
      const content = '비밀 꿀팁 충격 놀라운 반드시 공개';
      expect(detectPersona(content)).toBe('viral');
    });

    test('should detect professional for comparison content', () => {
      const content = '장단점 비교 분석 vs 차이점';
      expect(detectPersona(content)).toBe('professional');
    });

    test('should default to professional when scores are equal', () => {
      const content = '일반적인 내용';
      expect(detectPersona(content)).toBe('professional');
    });

    test('should handle empty content', () => {
      expect(detectPersona('')).toBe('professional');
    });

    test('should be case insensitive', () => {
      const content = '맛집 후기 VS 통계 분석 충격';
      expect(detectPersona(content)).toBe('professional'); // 모든 점수가 같아 professional 우선
    });
  });
});