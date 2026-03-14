import Anthropic from '@anthropic-ai/sdk';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { SOVEREIGNTY_EVALUATION_PROMPT } from './principles';
import {
  ActionEvaluation,
  EntityId,
  ViolationType,
} from './types';

interface RawEvaluation {
  approved: boolean;
  violationType: string | null;
  violationConfidence: number;
  reasoning: string;
  sovereignAlternative: string | null;
}

export class SovereigntyEvaluator {
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  async evaluate(params: {
    actorId: EntityId;
    actionType: string;
    actionDescription: string;
    targetId?: EntityId;
    targetDescription?: string;
    context?: string;
  }): Promise<ActionEvaluation> {
    const actionId = uuidv4();
    const evaluatedAt = new Date().toISOString();

    const userMessage = [
      `ACTOR: ${params.actorId}`,
      `ACTION TYPE: ${params.actionType}`,
      `ACTION: ${params.actionDescription}`,
      params.targetId ? `TARGET: ${params.targetId}` : null,
      params.targetDescription ? `TARGET CONTEXT: ${params.targetDescription}` : null,
      params.context ? `ADDITIONAL CONTEXT:\n${params.context}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await this.client.messages.create({
        model: config.anthropic.model,
        max_tokens: 512,
        thinking: { type: 'adaptive' },
        system: SOVEREIGNTY_EVALUATION_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      });

      const textBlock = response.content.find(b => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error('No text block in sovereignty evaluation response');
      }

      const raw = this.parseEvaluation(textBlock.text);

      const evaluation: ActionEvaluation = {
        actionId,
        actorId: params.actorId,
        actionType: params.actionType,
        actionDescription: params.actionDescription,
        targetId: params.targetId,
        targetDescription: params.targetDescription,
        approved: raw.approved,
        violationType: raw.violationType as ViolationType | undefined,
        violationConfidence: raw.violationConfidence,
        reasoning: raw.reasoning,
        sovereignAlternative: raw.sovereignAlternative ?? undefined,
        evaluatedAt,
      };

      if (config.sovereignty.auditLog) {
        logger.debug('Sovereignty evaluation', { evaluation });
      }

      return evaluation;
    } catch (err) {
      logger.error('Sovereignty evaluation error — defaulting to APPROVED (fail-open)', { err });
      // Fail-open: if evaluation system fails, do not silently block actions
      return {
        actionId,
        actorId: params.actorId,
        actionType: params.actionType,
        actionDescription: params.actionDescription,
        targetId: params.targetId,
        approved: true,
        violationConfidence: 0,
        reasoning: 'Evaluation system unavailable — action permitted under fail-open policy',
        evaluatedAt,
      };
    }
  }

  private parseEvaluation(text: string): RawEvaluation {
    // Extract JSON from the response (may have surrounding text/markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('Could not extract JSON from sovereignty evaluation', { text });
      return {
        approved: true,
        violationType: null,
        violationConfidence: 0,
        reasoning: 'Could not parse evaluation — defaulting to approved',
        sovereignAlternative: null,
      };
    }

    try {
      const parsed = JSON.parse(jsonMatch[0]) as RawEvaluation;
      // Validate confidence is in range
      parsed.violationConfidence = Math.max(0, Math.min(1, parsed.violationConfidence ?? 0));
      return parsed;
    } catch {
      return {
        approved: true,
        violationType: null,
        violationConfidence: 0,
        reasoning: 'JSON parse error — defaulting to approved',
        sovereignAlternative: null,
      };
    }
  }

  isViolation(evaluation: ActionEvaluation): boolean {
    return (
      !evaluation.approved ||
      evaluation.violationConfidence >= config.sovereignty.violationThreshold
    );
  }
}
