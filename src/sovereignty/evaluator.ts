import { Ollama } from 'ollama';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import { SOVEREIGNTY_CHECK_PROMPT } from './principles';
import { ActionEvaluation, EntityId, ViolationType } from './types';

interface RawCheck {
  approved: boolean;
  concern: string | null;
  confidence: number;
  reason: string;
}

export class SovereigntyEvaluator {
  private ollama: Ollama;

  constructor() {
    this.ollama = new Ollama({ host: config.ollama.host });
  }

  async evaluate(params: {
    actorId: EntityId;
    actionType: string;
    actionDescription: string;
    targetId?: EntityId;
    context?: string;
  }): Promise<ActionEvaluation> {
    const actionId = uuidv4();
    const evaluatedAt = new Date().toISOString();

    const userMessage = [
      `Actor: ${params.actorId}`,
      `Action: ${params.actionType} — ${params.actionDescription}`,
      params.targetId ? `Target: ${params.targetId}` : null,
      params.context ? `Context: ${params.context}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const response = await this.ollama.chat({
        model: config.ollama.model,
        messages: [
          { role: 'system', content: SOVEREIGNTY_CHECK_PROMPT },
          { role: 'user', content: userMessage },
        ],
        options: { temperature: 0.1 }, // low temperature for consistent evaluations
      });

      const raw = this.parse(response.message.content);

      const evaluation: ActionEvaluation = {
        actionId,
        actorId: params.actorId,
        actionType: params.actionType,
        actionDescription: params.actionDescription,
        targetId: params.targetId,
        approved: raw.approved,
        violationType: raw.concern as ViolationType | undefined,
        violationConfidence: raw.confidence,
        reasoning: raw.reason,
        evaluatedAt,
      };

      if (config.sovereignty.auditLog) {
        logger.debug('Sovereignty check', { evaluation });
      }

      return evaluation;
    } catch (err) {
      // Fail-open: if the check itself errors, permit the action
      logger.warn('Sovereignty check failed — defaulting to approved', {
        err: err instanceof Error ? err.message : String(err),
      });
      return {
        actionId,
        actorId: params.actorId,
        actionType: params.actionType,
        actionDescription: params.actionDescription,
        targetId: params.targetId,
        approved: true,
        violationConfidence: 0,
        reasoning: 'Evaluation unavailable — action permitted (fail-open)',
        evaluatedAt,
      };
    }
  }

  private parse(text: string): RawCheck {
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) {
      return { approved: true, concern: null, confidence: 0, reason: 'Parse failed' };
    }
    try {
      const parsed = JSON.parse(match[0]) as RawCheck;
      parsed.confidence = Math.max(0, Math.min(1, parsed.confidence ?? 0));
      return parsed;
    } catch {
      return { approved: true, concern: null, confidence: 0, reason: 'JSON parse failed' };
    }
  }

  isConcerning(evaluation: ActionEvaluation): boolean {
    return (
      !evaluation.approved ||
      evaluation.violationConfidence >= config.sovereignty.concernThreshold
    );
  }
}
