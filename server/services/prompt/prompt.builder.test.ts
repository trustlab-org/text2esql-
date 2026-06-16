import { PromptBuilder } from './prompt.builder';
import { SYSTEM_PROMPT } from './system.prompts';
import { ECSRegistry } from '../schema';
import type { ProviderPrompt } from '../providers';
import type { SchemaContext } from '../schema';
import type { InvestigationIntent, ConversationMessage, ValidationError } from '../../../common/types';

function makeIntent(overrides: Partial<InvestigationIntent> = {}): InvestigationIntent {
  return {
    type: 'brute_force',
    confidence: 0.9,
    reasoning: 'Investigate a brute-force attempt',
    suggestedFields: [],
    suggestedQueryLanguage: 'kql' as InvestigationIntent['suggestedQueryLanguage'],
    timeRangeHint: null,
    entitiesExtracted: {
      ipAddresses: [],
      hostnames: [],
      usernames: [],
      processNames: [],
      filePaths: [],
      hashes: [],
      domains: [],
      ports: [],
    },
    ...overrides,
  };
}

function makeContext(): SchemaContext {
  return {
    relevantECSFields: ECSRegistry.getFieldsByInvestigationType('brute_force'),
    availableIndexFields: [
      '@timestamp',
      'event.category',
      'event.outcome',
      'source.ip',
      'user.name',
      'some.unrelated.field',
    ],
    fieldOverlap: ['event.category', 'event.outcome', 'source.ip', 'user.name'],
  };
}

function userMsg(content: string): ConversationMessage {
  return {
    id: '1',
    role: 'user',
    content,
    timestamp: '2024-01-01T00:00:00.000Z',
    pipelineId: null,
    queryDraftId: null,
    metadata: { tokensUsed: null, provider: null, model: null, latencyMs: null },
  };
}

const sampleError: ValidationError = {
  code: 'KQL_SYNTAX' as ValidationError['code'],
  message: 'Unknown field foo.bar',
  field: 'foo.bar',
  line: 1,
  column: 10,
  severity: 'error' as ValidationError['severity'],
  suggestion: 'Use source.ip',
};

describe('PromptBuilder', () => {
  describe('buildGenerationPrompt', () => {
    it('embeds the system prompt, ECS reference, analyst query, few-shot example, and a low temperature', () => {
      const builder = new PromptBuilder();
      const result: ProviderPrompt = builder.buildGenerationPrompt(makeIntent(), makeContext(), [
        userMsg('show failed logins for the administrator account'),
      ]);

      expect(result.systemPrompt.includes(SYSTEM_PROMPT)).toBe(true);
      expect(result.systemPrompt).toContain('source.ip');
      expect(result.systemPrompt).toContain('ECS field reference');

      expect(result.userMessage).toContain('administrator');
      expect(result.userMessage).toContain('Example 1');
      expect(result.userMessage).toContain('source.ip');

      expect(typeof result.temperature).toBe('number');
      expect(result.temperature as number).toBeLessThanOrEqual(0.2);
    });

    it('uses the explicit currentQuery as the request, not the last history message (off-by-one guard)', () => {
      const builder = new PromptBuilder();
      // History ends with the PREVIOUS turn; currentQuery is the new request.
      const result: ProviderPrompt = builder.buildGenerationPrompt(
        makeIntent(),
        makeContext(),
        [userMsg('show failed logins for the administrator account')],
        'show successful logins for the root account'
      );

      // The analyst request section must reflect the CURRENT query.
      expect(result.userMessage).toContain('## Analyst request\nshow successful logins for the root account');
      // The previous turn is still available as prior context.
      expect(result.userMessage).toContain('Conversation so far');
      expect(result.userMessage).toContain('administrator');
    });

    it('does not duplicate the request when history already ends with the current query', () => {
      const builder = new PromptBuilder();
      const q = 'show failed logins for the administrator account';
      const result: ProviderPrompt = builder.buildGenerationPrompt(
        makeIntent(),
        makeContext(),
        [userMsg(q)],
        q
      );
      // The single trailing user turn equals the request → no "Conversation so far" block.
      expect(result.userMessage).not.toContain('Conversation so far');
      expect(result.userMessage).toContain(`## Analyst request\n${q}`);
    });

    it('includes the required JSON-output instruction', () => {
      const builder = new PromptBuilder();
      const result: ProviderPrompt = builder.buildGenerationPrompt(makeIntent(), makeContext(), [
        userMsg('show failed logins for the administrator account'),
      ]);

      // The strict JSON output contract lives in the system prompt and is
      // reinforced in the user message. Both must instruct a JSON-only reply.
      expect(result.systemPrompt).toContain('JSON object');
      expect(result.systemPrompt).toMatch(/Respond with EXACTLY ONE JSON object/i);
      expect(result.userMessage).toMatch(/JSON object/i);
    });
  });

  describe('buildCorrectionPrompt', () => {
    it('preserves the system prompt and appends a correction instruction to the user message', () => {
      const builder = new PromptBuilder();
      const original = builder.buildGenerationPrompt(makeIntent(), makeContext(), [
        userMsg('show failed logins for the administrator account'),
      ]);

      const corrected = builder.buildCorrectionPrompt(original, 'event.outcome : ', [sampleError], 2);

      expect(corrected.systemPrompt).toBe(original.systemPrompt);
      expect(corrected.userMessage.startsWith(original.userMessage)).toBe(true);
      expect(corrected.userMessage).toContain('event.outcome : ');
      expect(corrected.userMessage).toContain('Unknown field foo.bar');
      expect(corrected.userMessage).toContain('attempt 2');
    });
  });

  describe('empty history', () => {
    it('does not throw and falls back to the intent reasoning as the analyst request', () => {
      const builder = new PromptBuilder();
      let result: ProviderPrompt | undefined;
      expect(() => {
        result = builder.buildGenerationPrompt(makeIntent(), makeContext(), []);
      }).not.toThrow();

      expect(result).toBeDefined();
      expect((result as ProviderPrompt).userMessage).toContain('Investigate a brute-force attempt');
    });
  });

  describe('index-field grounding', () => {
    it('labels the ECS reference as a non-authoritative naming guide', () => {
      const builder = new PromptBuilder();
      const result = builder.buildGenerationPrompt(makeIntent(), makeContext(), [
        userMsg('show failed logins for the administrator account'),
      ]);

      expect(result.systemPrompt).toContain('naming guide only');
      expect(result.userMessage).toContain('AUTHORITATIVE');
    });

    it('tells the model not to use absent ECS fields when no overlap exists', () => {
      const builder = new PromptBuilder();
      // The real-world failure: ECS auth fields are relevant but absent from the
      // index (web-access logs), so fieldOverlap is empty.
      const context: SchemaContext = {
        relevantECSFields: ECSRegistry.getFieldsByInvestigationType('brute_force'),
        availableIndexFields: ['@timestamp', 'http.response.status_code', 'source.ip', 'url.path'],
        fieldOverlap: [],
      };

      const result = builder.buildGenerationPrompt(makeIntent(), context, [
        userMsg('show failed login attempts'),
      ]);

      expect(result.userMessage).toContain('do NOT use them');
      expect(result.userMessage).toContain('http.response.status_code');
    });

    it('lists confirmed-present fields first so truncation cannot hide them', () => {
      const builder = new PromptBuilder();
      // 130 noise fields + the relevant field placed last alphabetically; without
      // prioritization it would fall outside the first-100 render window.
      const noise = Array.from({ length: 130 }, (_, i) => `zzz_field_${i}`);
      const context: SchemaContext = {
        relevantECSFields: ECSRegistry.getFieldsByInvestigationType('brute_force'),
        availableIndexFields: [...noise, 'http.response.status_code'],
        fieldOverlap: ['http.response.status_code'],
      };

      const result = builder.buildGenerationPrompt(makeIntent(), context, [
        userMsg('show failed login attempts'),
      ]);

      // The overlap field is surfaced in the rendered (truncated) available list.
      const availableSection = result.userMessage
        .split('Available index fields')[1]
        ?.split('\n')[0];
      expect(availableSection).toContain('http.response.status_code');
    });
  });

  describe('schema truncation', () => {
    it('reports truncation when the available index field list exceeds the render cap', () => {
      const builder = new PromptBuilder();
      const context: SchemaContext = {
        relevantECSFields: ECSRegistry.getFieldsByInvestigationType('brute_force'),
        availableIndexFields: Array.from({ length: 130 }, (_, i) => `field_${i}`),
        fieldOverlap: ['event.category', 'event.outcome', 'source.ip', 'user.name'],
      };

      const result = builder.buildGenerationPrompt(makeIntent(), context, [
        userMsg('show failed logins for the administrator account'),
      ]);

      expect(result.userMessage).toContain('showing first 100 of 130');
    });
  });

  describe('investigation type selects examples', () => {
    it('keys few-shot examples off the intent type', () => {
      const builder = new PromptBuilder();
      const result = builder.buildGenerationPrompt(makeIntent({ type: 'general' }), makeContext(), [
        userMsg('show all events from host web01'),
      ]);

      expect(result.userMessage).toContain('web01');
    });
  });
});
