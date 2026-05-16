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

export interface AnalyzeResponse {
  originalText: string;
  maskedText: string;
  detections: DetectionResult[];
  riskScore: number;
  safeForLLM: boolean;
  timestamp: string;
}

// ─── Audit types ──────────────────────────────────────────────────────────────

// AuditEntry: lean, public-safe record written after every pipeline run.
// Contains no raw text, no PII values, no hashes of sensitive data.
export interface AuditEntry {
  requestId: string;
  timestamp: string;
  riskScore: number;
  detectionCount: number;
  proofGenerated: boolean;
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
  safeForLLM: boolean;
  proofId?: string;
  proofVerified?: boolean;
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
