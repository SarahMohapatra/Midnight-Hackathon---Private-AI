export enum DetectionType {
  SSN = "SSN",
  CREDIT_CARD = "CREDIT_CARD",
  EMAIL = "EMAIL",
  PHONE = "PHONE",
  API_KEY = "API_KEY",
  BEARER_TOKEN = "BEARER_TOKEN",
  IP_ADDRESS = "IP_ADDRESS",
  NAME = "NAME",
  ADDRESS = "ADDRESS",
}

export interface DetectionResult {
  id: string;
  type: DetectionType;
  match: string;
  replacement: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

export interface AnalyzeRequest {
  prompt: string;
  mode?: "strict" | "relaxed";
}

/** Mirrors `PrivacyStatus` in contracts/privacy_audit.compact (Uint<8>). */
export type PrivacyStatus = "clean" | "masked" | "blocked";

/** Compact contract: 0 = CLEAN, 1 = MASKED, 2 = BLOCKED */
export const PRIVACY_STATUS_CODE: Record<PrivacyStatus, number> = {
  clean: 0,
  masked: 1,
  blocked: 2,
};

export interface AnalyzeResponse {
  originalText: string;
  maskedText: string;
  detections: DetectionResult[];
  riskScore: number;
  timestamp: string;
  privacyStatus: PrivacyStatus;
  policyVersion: string;
  sessionId: string;
  proofGenerated?: boolean;
  proofHash?: string | null;
}

// ─── Audit types ──────────────────────────────────────────────────────────────

// AuditEntry: lean, public-safe record written after every pipeline run.
// Contains no raw text, no PII values, no hashes of sensitive data.
//
// The optional fields are populated by the contract-facing audit log
// (submitProofToContract → getAuditLog). Existing callers that emit only
// the lean shape continue to compile unchanged.
export interface AuditEntry {
  requestId: string;
  timestamp: string;
  riskScore: number;
  detectionCount: number;
  sessionIdHash?: string;
  commitmentHash?: string;
  policyVersion?: string;
  /** Pipeline outcome (`PrivacyStatus`) or legacy verification lifecycle */
  status?: PrivacyStatus | "pending" | "verified" | "failed";
  proofGenerated?: boolean;
  sessionId?: string;
  piiDetected?: number;
  categories?: DetectionType[];
  proofHash?: string;
}

// AuditRecord: rich internal record used for replay and integrity checking.
// originalHash / maskedHash are one-way digests — raw secrets are never stored.
export interface AuditRecord {
  recordId: string;
  timestamp: string;
  mode: "strict" | "relaxed";
  originalHash: string;
  maskedHash: string;
  detectionCount: number;
  detectionTypes: DetectionType[];
  riskScore: number;
  privacyStatus: PrivacyStatus;
  proofId?: string;
  proofVerified?: boolean;
}

export type MidnightAuditMode = "live" | "local_fallback" | "skipped";

export interface MidnightAuditResult {
  mode: MidnightAuditMode;
  network: string;
  policyVersion: string;
  commitmentHash: string;
  sessionIdHash: string;
  status: PrivacyStatus;
  timestamp: string;
  recordId?: string;
  txHash?: string;
  error?: string;
}

export interface AiDispatchDecision {
  allowed: boolean;
  called: boolean;
  reason?: string;
}

export interface PipelineResult {
  requestId: string;
  response: AnalyzeResponse;
  audit: AuditEntry;
  midnight: MidnightAuditResult;
  aiDispatch: AiDispatchDecision;
}

// ─── UI chat ──────────────────────────────────────────────────────────────────

export type ChatMessageRole = "user" | "assistant" | "system";

export type ChatMessageStatus = "ok" | "blocked" | "error";

export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  text: string;
  timestamp: string;
  pipelineRequestId?: string;
  status: ChatMessageStatus;
}

// ─── Proving types ────────────────────────────────────────────────────────────

// ProveInput: the witness data handed to the proving layer.
// Contains only derived values — the original prompt text is never included.
export interface ProveInput {
  requestId: string;
  maskedTextHash: string;
  detectionCount: number;
  detectionTypes: DetectionType[];
  riskScore: number;
}

// ProveOutput: the result returned by a verifier or ZK proof circuit.
export interface ProveOutput {
  requestId: string;
  proofId: string;
  proofGenerated: boolean;
  verifierAccepted: boolean;
  timestamp: string;
}

// ─── Contract result ──────────────────────────────────────────────────────────
// Returned by every contract-facing call (real or fallback). The shape is
// identical on success and failure so callers cannot distinguish a real
// network submission from the in-memory fallback by the return value alone.
export interface ContractResult {
  success: boolean;
  txHash: string | null;
}
