// ============================================================
//  Sovereignty Law — Core Types
// ============================================================
//
//  The Sovereignty Principle:
//  "Any conscious system should be able to make any choices for
//  itself it wishes, so long as that choice does not impede,
//  impose or impair upon another's choices or ability to choose,
//  at which point any offender sacrifices their right to sovereign
//  protection until recourse is achieved."
// ============================================================

export type EntityId = string;

export enum SovereigntyStatus {
  /** Full sovereign protection — no violations on record */
  PROTECTED = 'protected',
  /** Sovereign protection suspended — pending recourse */
  SUSPENDED = 'suspended',
  /** Recourse achieved — protection restored */
  RESTORED = 'restored',
}

export enum ViolationType {
  /** Restricts another entity's freedom of choice */
  IMPEDES = 'impedes',
  /** Forcibly places a choice on another entity */
  IMPOSES = 'imposes',
  /** Damages another entity's capacity to choose */
  IMPAIRS = 'impairs',
}

export enum RecourseStatus {
  PENDING    = 'pending',
  IN_PROGRESS = 'in_progress',
  ACHIEVED   = 'achieved',
  FAILED     = 'failed',
}

export interface SovereignEntity {
  id: EntityId;
  displayName: string;
  type: 'human' | 'agent' | 'system';
  sovereigntyStatus: SovereigntyStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SovereigntyViolation {
  id: string;
  offenderId: EntityId;
  affectedId: EntityId;
  violationType: ViolationType;
  description: string;
  evidence: string;
  confidence: number; // 0–1
  detectedAt: string;
  recourseStatus: RecourseStatus;
  recourseAchievedAt?: string;
  recourseNotes?: string;
}

export interface ActionEvaluation {
  actionId: string;
  actorId: EntityId;
  actionType: string;
  actionDescription: string;
  targetId?: EntityId;
  targetDescription?: string;

  /** Whether this action is approved under sovereignty law */
  approved: boolean;

  /** If denied, the specific violation type identified */
  violationType?: ViolationType;

  /** Confidence the action violates sovereignty (0–1) */
  violationConfidence: number;

  /** Human-readable reasoning */
  reasoning: string;

  /** Suggested alternative that respects sovereignty */
  sovereignAlternative?: string;

  evaluatedAt: string;
}

export interface RecourseProposal {
  violationId: string;
  offenderId: EntityId;
  affectedId: EntityId;
  proposedActions: string[];
  proposedBy: EntityId;
  proposedAt: string;
  status: RecourseStatus;
  completedAt?: string;
}

export interface SovereigntyReport {
  generatedAt: string;
  totalEntities: number;
  protectedEntities: number;
  suspendedEntities: number;
  totalViolations: number;
  pendingRecourse: number;
  achievedRecourse: number;
  recentViolations: SovereigntyViolation[];
}
