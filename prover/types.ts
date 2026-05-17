// ─── Canonical PrivatePrompt types ───────────────────────────────────────────
// Single source of truth for every cross-module shape.
// All risk scores are normalised to the [0, 1] range.

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

// PrivacyStatus is the canonical three-state outcome used by the UI, the
// audit log, and the on-chain attestation contract. A single enum keeps the
// frontend, the adapter, and the contract in lockstep.
export type PrivacyStatus = "clean" | "masked" | "blocked";

export const PRIVACY_STATUS_CODE: Record<PrivacyStatus, number> = {
  clean: 0,
  masked: 1,
  blocked: 2,
};

// AnalyzeResponse intentionally leaves Midnight metadata to PipelineResult so
// callers that just want detection/masking output don't see chain fields.
export interface AnalyzeResponse {
  originalText: string;
  maskedText: string;
  detections: DetectionResult[];
  riskScore: number;
  privacyStatus: PrivacyStatus;
  policyVersion: string;
  sessionId: string;
  timestamp: string;
}

// ─── Audit shapes ─────────────────────────────────────────────────────────────
// AuditEntry is the lean record the UI displays and the Midnight contract
// stores: hashes and bounded enums only. No raw text, no PII match values.

export interface AuditEntry {
  requestId: string;
  sessionIdHash: string;
  commitmentHash: string;
  policyVersion: string;
  status: PrivacyStatus;
  riskScore: number;
  detectionCount: number;
  timestamp: string;
}

// AuditRecord stays as a richer, in-memory-only debug record used by the
// legacy createAnalyzeService wrapper. It is never persisted off-device.
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

// ─── Midnight integration types ──────────────────────────────────────────────

export type MidnightMode = "live" | "local_fallback" | "skipped";

export interface MidnightAuditResult {
  mode: MidnightMode;
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

// ─── Pipeline result ──────────────────────────────────────────────────────────
// PipelineResult is what the UI consumes. It bundles the privacy analysis,
// the Midnight attestation outcome, and an explicit AI dispatch decision.

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

// ─── Chat messages ────────────────────────────────────────────────────────────
// ChatMessage is the UI-facing thread record. We store the user's displayed
// text (which is what they typed), the pipeline snapshot ID, and never persist
// a separate copy of the raw prompt outside of React state for the live view.

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  timestamp: string;
  // Optional reference to the pipeline result that produced or guarded this
  // message. Only present on user messages and the assistant reply that
  // followed them.
  pipelineRequestId?: string;
  status?: "ok" | "blocked" | "error";
}

// ─── Proving placeholders (kept for backward import paths) ───────────────────

export interface ProveInput {
  requestId: string;
  maskedTextHash: string;
  detectionCount: number;
  detectionTypes: DetectionType[];
  riskScore: number;
}

export interface ProveOutput {
  requestId: string;
  proofId: string;
  proofGenerated: boolean;
  verifierAccepted: boolean;
  timestamp: string;
}

export interface ContractResult {
  success: boolean;
  txHash: string | null;
}
