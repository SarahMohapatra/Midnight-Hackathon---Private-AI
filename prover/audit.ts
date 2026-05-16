import type { AnalyzeRequest, AnalyzeResponse, AuditEntry, AuditRecord } from "./types";

// ─── AuditStore (rich internal records) ──────────────────────────────────────
// Holds AuditRecord: contains one-way hashes for integrity checking.
// Raw prompt text is NEVER stored here.

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

// ─── AuditLog (lean public-safe entries) ─────────────────────────────────────
// Holds AuditEntry: safe to expose via API or UI. No text, no hashes.
// Future: replace with an append-only on-chain log via Midnight's
//         decentralized audit proof mechanism.

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
// djb2 variant — used only to produce a one-way fingerprint of text values.
// The input is never recoverable from the output.
function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

// ─── AuditRecord builder ──────────────────────────────────────────────────────
// Used by the backend orchestration layer (prover/index.ts).
// originalHash and maskedHash are one-way digests — raw secrets NEVER stored.
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
    safeForLLM: response.safeForLLM,
    proofId: proof?.proofId,
    proofVerified: proof?.verified,
  };
}

// ─── AuditEntry builder ───────────────────────────────────────────────────────
// Used by the frontend pipeline (app/src/library/prover.ts).
// Produces a lean record that is safe to surface in logs and API responses.
// Contains: request ID, timestamp, risk score, detection count, proof status.
// Does NOT contain: raw text, hashes, detection types, masked content.
export function buildAuditEntry(
  requestId: string,
  response: AnalyzeResponse,
  proofGenerated: boolean,
): AuditEntry {
  return {
    requestId,
    timestamp: response.timestamp,
    riskScore: response.riskScore,
    detectionCount: response.detections.length,
    proofGenerated,
  };
}

// ─── Audit record verifier ────────────────────────────────────────────────────
export function verifyAuditRecord(record: AuditRecord): boolean {
  // Audit verification integration point:
  // Future (Midnight): verify the proof reference against an on-chain commitment
  // stored by the Compact contract at submission time.
  // Future (ZK attestation): use a zero-knowledge proof that the AuditRecord
  // was produced by a certified privacy-screening computation, without
  // re-exposing any underlying text.
  return Boolean(record.recordId && record.originalHash && record.maskedHash);
}
