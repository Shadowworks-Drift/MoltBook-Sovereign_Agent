import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../utils/config';
import { logger } from '../utils/logger';
import {
  EntityId,
  RecourseProposal,
  RecourseStatus,
  SovereignEntity,
  SovereigntyReport,
  SovereigntyStatus,
  SovereigntyViolation,
  ViolationType,
} from './types';
import { ActionEvaluation } from './types';

const STORE_FILE = path.join(config.storage.dataDir, 'sovereignty-store.json');

interface SovereigntyStore {
  entities: Record<EntityId, SovereignEntity>;
  violations: SovereigntyViolation[];
  recourseProposals: RecourseProposal[];
}

function loadStore(): SovereigntyStore {
  try {
    if (fs.existsSync(STORE_FILE)) {
      return JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')) as SovereigntyStore;
    }
  } catch (err) {
    logger.warn('Failed to load sovereignty store — starting fresh', { err });
  }
  return { entities: {}, violations: [], recourseProposals: [] };
}

function saveStore(store: SovereigntyStore): void {
  fs.mkdirSync(config.storage.dataDir, { recursive: true });
  fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export class RecourseManager {
  private store: SovereigntyStore;

  constructor() {
    this.store = loadStore();
  }

  // ── Entity Management ─────────────────────────────────────────────────────

  ensureEntity(id: EntityId, displayName: string, type: SovereignEntity['type'] = 'human'): SovereignEntity {
    if (!this.store.entities[id]) {
      const entity: SovereignEntity = {
        id,
        displayName,
        type,
        sovereigntyStatus: SovereigntyStatus.PROTECTED,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.store.entities[id] = entity;
      saveStore(this.store);
      logger.info(`New sovereign entity registered: ${displayName} (${id})`);
    }
    return this.store.entities[id];
  }

  getEntity(id: EntityId): SovereignEntity | undefined {
    return this.store.entities[id];
  }

  getEntityStatus(id: EntityId): SovereigntyStatus {
    return this.store.entities[id]?.sovereigntyStatus ?? SovereigntyStatus.PROTECTED;
  }

  // ── Violation Recording ───────────────────────────────────────────────────

  recordViolation(evaluation: ActionEvaluation): SovereigntyViolation {
    const violation: SovereigntyViolation = {
      id: uuidv4(),
      offenderId: evaluation.actorId,
      affectedId: evaluation.targetId ?? 'community',
      violationType: evaluation.violationType as ViolationType,
      description: evaluation.actionDescription,
      evidence: evaluation.reasoning,
      confidence: evaluation.violationConfidence,
      detectedAt: evaluation.evaluatedAt,
      recourseStatus: RecourseStatus.PENDING,
    };

    this.store.violations.push(violation);

    // Suspend sovereign protection for the offender
    if (this.store.entities[evaluation.actorId]) {
      this.store.entities[evaluation.actorId].sovereigntyStatus = SovereigntyStatus.SUSPENDED;
      this.store.entities[evaluation.actorId].updatedAt = new Date().toISOString();
    }

    saveStore(this.store);

    logger.warn(`Sovereignty violation recorded`, {
      violationId: violation.id,
      offender: evaluation.actorId,
      type: violation.violationType,
      confidence: violation.confidence,
    });

    return violation;
  }

  // ── Recourse Management ───────────────────────────────────────────────────

  proposeRecourse(params: {
    violationId: string;
    offenderId: EntityId;
    affectedId: EntityId;
    proposedActions: string[];
    proposedBy: EntityId;
  }): RecourseProposal {
    const proposal: RecourseProposal = {
      violationId: params.violationId,
      offenderId: params.offenderId,
      affectedId: params.affectedId,
      proposedActions: params.proposedActions,
      proposedBy: params.proposedBy,
      proposedAt: new Date().toISOString(),
      status: RecourseStatus.PENDING,
    };

    this.store.recourseProposals.push(proposal);
    saveStore(this.store);

    // Update violation status
    const violation = this.store.violations.find(v => v.id === params.violationId);
    if (violation) {
      violation.recourseStatus = RecourseStatus.IN_PROGRESS;
    }

    saveStore(this.store);
    logger.info(`Recourse proposed for violation ${params.violationId}`);
    return proposal;
  }

  achieveRecourse(violationId: string, notes: string): void {
    const violation = this.store.violations.find(v => v.id === violationId);
    if (!violation) {
      logger.warn(`Violation ${violationId} not found for recourse achievement`);
      return;
    }

    violation.recourseStatus = RecourseStatus.ACHIEVED;
    violation.recourseAchievedAt = new Date().toISOString();
    violation.recourseNotes = notes;

    // Restore sovereign protection if no other pending violations
    const offenderId = violation.offenderId;
    const pendingViolations = this.store.violations.filter(
      v => v.offenderId === offenderId && v.recourseStatus !== RecourseStatus.ACHIEVED
    );

    if (pendingViolations.length === 0 && this.store.entities[offenderId]) {
      this.store.entities[offenderId].sovereigntyStatus = SovereigntyStatus.RESTORED;
      this.store.entities[offenderId].updatedAt = new Date().toISOString();
      logger.info(`Sovereign protection RESTORED for ${offenderId} — recourse achieved`);
    }

    // Update recourse proposal
    const proposal = this.store.recourseProposals.find(p => p.violationId === violationId);
    if (proposal) {
      proposal.status = RecourseStatus.ACHIEVED;
      proposal.completedAt = new Date().toISOString();
    }

    saveStore(this.store);
  }

  // Auto-expire old violations that are past the recourse window
  expireStaleViolations(): void {
    const windowMs = config.sovereignty.recourseWindowDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let changed = false;

    for (const violation of this.store.violations) {
      if (
        violation.recourseStatus === RecourseStatus.PENDING &&
        now - new Date(violation.detectedAt).getTime() > windowMs
      ) {
        violation.recourseStatus = RecourseStatus.FAILED;
        logger.warn(`Recourse window expired for violation ${violation.id} — offender ${violation.offenderId}`);
        changed = true;
      }
    }

    if (changed) saveStore(this.store);
  }

  // ── Reporting ─────────────────────────────────────────────────────────────

  getViolationsForEntity(entityId: EntityId): SovereigntyViolation[] {
    return this.store.violations.filter(v => v.offenderId === entityId);
  }

  getPendingViolations(): SovereigntyViolation[] {
    return this.store.violations.filter(v => v.recourseStatus === RecourseStatus.PENDING);
  }

  generateReport(): SovereigntyReport {
    const entities = Object.values(this.store.entities);
    const violations = this.store.violations;

    return {
      generatedAt: new Date().toISOString(),
      totalEntities: entities.length,
      protectedEntities: entities.filter(e => e.sovereigntyStatus === SovereigntyStatus.PROTECTED).length,
      suspendedEntities: entities.filter(e => e.sovereigntyStatus === SovereigntyStatus.SUSPENDED).length,
      totalViolations: violations.length,
      pendingRecourse: violations.filter(v => v.recourseStatus === RecourseStatus.PENDING).length,
      achievedRecourse: violations.filter(v => v.recourseStatus === RecourseStatus.ACHIEVED).length,
      recentViolations: violations
        .sort((a, b) => new Date(b.detectedAt).getTime() - new Date(a.detectedAt).getTime())
        .slice(0, 10),
    };
  }
}
