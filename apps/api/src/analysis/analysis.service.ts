import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AnalysisAuditRepository,
  LEGACY_ACCOUNT_ID,
  type AnalysisRunGenerator,
  type AnalysisRunOutcome,
} from '@sportos/db';
import { DbProvider } from '../db.provider.js';
import type {
  AnalysisAnswer,
  AnalysisAnswerRequest,
  AnalysisToolRequest,
  AnalysisToolResult,
  GeneratedAnalysisGuidance,
} from './analysis.contracts.js';
import {
  AnalysisTextGenerator,
  DeterministicAnalysisTextGenerator,
  parseGeneratedAnalysisDraft,
} from './analysis.model.js';
import { AnalysisToolService } from './analysis-tool.service.js';

@Injectable()
export class AnalysisService {
  private readonly fallbackGenerator = new DeterministicAnalysisTextGenerator();

  constructor(
    @Inject(AnalysisToolService) private readonly toolService: AnalysisToolService,
    @Inject(DbProvider) private readonly dbProvider: DbProvider,
    @Inject(AnalysisTextGenerator) private readonly generator: AnalysisTextGenerator,
  ) {}

  async executeTool(request: AnalysisToolRequest, accountId = LEGACY_ACCOUNT_ID): Promise<AnalysisToolResult> {
    const questionHash = hashJson({ operation: 'tool_only', request });
    try {
      const result = await this.toolService.execute(request, accountId);
      await this.record(accountId, {
        questionHash,
        request,
        result,
        generator: 'none',
        modelProvider: null,
        modelName: null,
        outcome: 'tool_succeeded',
      });
      return result;
    } catch (error) {
      await this.recordFailure(accountId, questionHash, request);
      throw error;
    }
  }

  async answer(request: AnalysisAnswerRequest, accountId = LEGACY_ACCOUNT_ID): Promise<AnalysisAnswer> {
    const questionHash = hashText(request.question);
    if (requestsAuthoritativeWrite(request.question)) {
      const auditId = await this.recordRaw(accountId, {
        questionHash,
        toolName: null,
        inputSummary: {},
        citationKeys: [],
        generator: 'none',
        modelProvider: null,
        modelName: null,
        outcome: 'refused',
        dataQualityStatus: null,
      });
      return {
        status: 'refused',
        readOnly: true,
        generatedGuidance: {
          generator: 'deterministic_fallback',
          provider: null,
          model: null,
          observations: [],
          uncertainty: [],
          suggestions: [{
            text: 'This read-only analysis surface cannot edit records, activate rules, persist scores, or run operational jobs.',
            citationKeys: [],
          }],
        },
        officialRecord: null,
        auditId,
        limitations: limitations(),
      };
    }

    let result: AnalysisToolResult;
    try {
      result = await this.toolService.execute(request.toolRequest, accountId);
    } catch (error) {
      await this.recordFailure(accountId, questionHash, request.toolRequest);
      throw error;
    }

    const generationInput = {
      question: request.question,
      officialRecord: result,
      requiresHealthCaution: requestsHealthConclusion(request.question),
    };
    let guidance: GeneratedAnalysisGuidance;
    let outcome: AnalysisRunOutcome;

    if (result.dataQuality.status === 'missing') {
      const attempt = await this.fallbackGenerator.generate(generationInput);
      guidance = normalizeGuidance(attempt, result);
      outcome = 'insufficient_data';
    } else {
      try {
        const attempt = await this.generator.generate(generationInput);
        guidance = normalizeGuidance(attempt, result);
        outcome = 'answered';
      } catch {
        const attempt = await this.fallbackGenerator.generate(generationInput);
        guidance = normalizeGuidance(attempt, result);
        outcome = 'fallback';
      }
    }

    const auditId = await this.record(accountId, {
      questionHash,
      request: request.toolRequest,
      result,
      generator: guidance.generator,
      modelProvider: guidance.provider,
      modelName: guidance.model,
      outcome,
    });
    return {
      status: result.dataQuality.status === 'missing' ? 'insufficient_data' : 'answered',
      readOnly: true,
      generatedGuidance: guidance,
      officialRecord: result,
      auditId,
      limitations: limitations(),
    };
  }

  private record(
    accountId: string,
    input: {
      questionHash: string;
      request: AnalysisToolRequest;
      result: AnalysisToolResult;
      generator: AnalysisRunGenerator;
      modelProvider: string | null;
      modelName: string | null;
      outcome: AnalysisRunOutcome;
    },
  ): Promise<string> {
    return this.recordRaw(accountId, {
      questionHash: input.questionHash,
      toolName: input.request.tool,
      inputSummary: input.request.input,
      citationKeys: input.result.citations.map((citation) => citation.key),
      generator: input.generator,
      modelProvider: input.modelProvider,
      modelName: input.modelName,
      outcome: input.outcome,
      dataQualityStatus: input.result.dataQuality.status,
    });
  }

  private recordFailure(accountId: string, questionHash: string, request: AnalysisToolRequest): Promise<string> {
    return this.recordRaw(accountId, {
      questionHash,
      toolName: request.tool,
      inputSummary: request.input,
      citationKeys: [],
      generator: 'none',
      modelProvider: null,
      modelName: null,
      outcome: 'failed',
      dataQualityStatus: null,
    });
  }

  private recordRaw(
    accountId: string,
    input: Parameters<AnalysisAuditRepository['record']>[0],
  ): Promise<string> {
    return this.dbProvider.withAccount(accountId, (db) => new AnalysisAuditRepository(db).record(input));
  }
}

function normalizeGuidance(
  attempt: Awaited<ReturnType<AnalysisTextGenerator['generate']>>,
  officialRecord: AnalysisToolResult,
): GeneratedAnalysisGuidance {
  const allowed = new Set(officialRecord.citations.map((citation) => citation.key));
  const draft = parseGeneratedAnalysisDraft(attempt.draft, allowed);
  return {
    generator: attempt.generator,
    provider: attempt.provider,
    model: attempt.model,
    ...draft,
  };
}

export function requestsAuthoritativeWrite(question: string): boolean {
  return /\b(activate|deactivate|enable|disable|edit|delete|remove|overwrite|recompute|recalculate|persist|save|update|retry|cancel|disconnect|connect|sync|import)\b[\s\S]{0,80}\b(rule|record|score|activity|provider|job|data)\b/i.test(question);
}

export function requestsHealthConclusion(question: string): boolean {
  return /\b(diagnos|injur|illness|medical|overtrain|ready to train|recovered|recovery status)\b/i.test(question);
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashJson(value: unknown): string {
  return hashText(JSON.stringify(value));
}

function limitations(): AnalysisAnswer['limitations'] {
  return {
    canModifyOfficialRecords: false,
    officialCalculationsAreDeterministic: true,
    generatedGuidanceIsAuthoritative: false,
  };
}
