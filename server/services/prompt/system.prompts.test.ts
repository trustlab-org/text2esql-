import { SYSTEM_PROMPT, SYSTEM_PROMPT_VERSION } from './system.prompts';

describe('SYSTEM_PROMPT', () => {
  it('is a non-empty string of meaningful length', () => {
    expect(typeof SYSTEM_PROMPT).toBe('string');
    expect(SYSTEM_PROMPT.length).toBeGreaterThan(200);
  });

  it('mentions KQL and Elastic Security', () => {
    const lower = SYSTEM_PROMPT.toLowerCase();
    expect(lower).toContain('kql');
    expect(lower).toContain('elastic security');
  });

  it('instructs the exact JSON output shape', () => {
    expect(SYSTEM_PROMPT).toContain('"kql"');
    expect(SYSTEM_PROMPT).toContain('"explanation"');
    expect(SYSTEM_PROMPT).toContain('"fieldsUsed"');
    expect(SYSTEM_PROMPT).toContain('"filtersApplied"');
    expect(SYSTEM_PROMPT).toContain('"investigationReasoning"');
  });

  it('forbids Markdown and code fences', () => {
    expect(SYSTEM_PROMPT).toContain('Markdown');
    expect(SYSTEM_PROMPT).toContain('code fences');
  });

  it('instructs exact, case-sensitive field-name usage', () => {
    expect(SYSTEM_PROMPT).toContain('EXACTLY as provided');
    expect(SYSTEM_PROMPT).toContain('case-sensitive');
  });

  it('instructs to use only the provided field names', () => {
    expect(SYSTEM_PROMPT).toContain('ONLY field names');
  });

  it('makes the available index fields authoritative over the ECS reference', () => {
    expect(SYSTEM_PROMPT).toContain('AUTHORITATIVE');
    expect(SYSTEM_PROMPT).toContain('NAMING GUIDE ONLY');
  });

  it('warns against assuming ECS auth fields exist when they may not', () => {
    // The exact failure mode that produced event.outcome/event.category against
    // web-access logs: the prompt must steer the model off absent ECS fields.
    expect(SYSTEM_PROMPT).toContain('event.outcome');
    expect(SYSTEM_PROMPT).toContain('http.response.status_code');
  });

  it('instructs the model to validate the KQL before answering', () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain('validate');
  });

  it('does not itself contain a Markdown code-fence sequence', () => {
    const fence = String.fromCharCode(96).repeat(3);
    expect(SYSTEM_PROMPT.includes(fence)).toBe(false);
  });
});

describe('SYSTEM_PROMPT_VERSION', () => {
  it('matches a semver-like pattern', () => {
    expect(SYSTEM_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
