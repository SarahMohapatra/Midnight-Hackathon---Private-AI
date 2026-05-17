import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AuditEntry,
  AuditRecord,
} from "./types";

// ─── AuditStore (rich in-memory records) ──────────────────────────────────────
// Used by the legacy createAnalyzeService wrapper. Holds AuditRecord values
// which include one-way digests of the original and masked prompts. Never
// stores raw secrets.

export interface AuditStore {
  add(record: AuditRecord): void;
  list(): AuditRecord[];
}

export class InMemoryAuditStore implements AuditStore {
  private readonly records: AuditRecord[] = [];
  public add(record: AuditRecord): void {
    this.records.push(record);
  }
  public list(): AuditRecord[] {
    return [...this.records];
  }
}

// ─── AuditLog (lean public entries) ───────────────────────────────────────────
// Pipeline-aligned AuditEntry log. Safe to expose via API and UI: contains
// only hashes, bounded enums, counts, and timestamps. Mirrors the on-chain
// attestation record.

export interface AuditLog {
  append(entry: AuditEntry): void;
  entries(): AuditEntry[];
}

export class InMemoryAuditLog implements AuditLog {
  private readonly log: AuditEntry[] = [];
  public append(entry: AuditEntry): void {
    this.log.push(entry);
  }
  public entries(): AuditEntry[] {
    return [...this.log];
  }
}

// ─── Hash utility ─────────────────────────────────────────────────────────────
function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

// ─── AuditRecord builder ──────────────────────────────────────────────────────
export function buildAuditRecord(
  request: AnalyzeRequest,
  response: AnalyzeResponse,
  proof?: { proofId?: string; verified?: boolean },
): AuditRecord {
  return {
    recordId: `audit_${response.timestamp}_${response.detections.length}`,
    timestamp: response.timestamp,
    mode: request.mode ?? "strict",
    originalHash: hashText(response.originalText),
    maskedHash: hashText(response.maskedText),
    detectionCount: response.detections.length,
    detectionTypes: response.detections.map((item) => item.type),
    riskScore: response.riskScore,
    privacyStatus: response.privacyStatus,
    proofId: proof?.proofId,
    proofVerified: proof?.verified,
  };
}

export function verifyAuditRecord(record: AuditRecord): boolean {
  return Boolean(record.recordId && record.originalHash && record.maskedHash);
}
