// ─── Abstract Proving Pipeline ────────────────────────────────────────────────
// Full security pipeline: detect → mask → score → block-check → prove → audit
// This is the canonical entry point for any code that wants a privacy-screened
// and optionally ZK-attested AnalyzeResponse.

import { detectSensitiveData } from "../../../prover/pii-detection";
import { maskDetections } from "../../../prover/pii";
import { callVerifier, submitToContract } from "../../../prover/api";
import { buildAuditEntry, InMemoryAuditLog } from "../../../prover/audit";
import {
  DetectionType,
  type AuditEntry,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type DetectionResult,
  type ProveInput,
} from "../../../prover/types";

// ─── Security threshold ───────────────────────────────────────────────────────
// Requests whose normalized risk score (0–1) exceeds this value are blocked
// before proof generation and before any LLM call.
// Future: enforce this threshold inside a Midnight ZK circuit so the policy
// runs without revealing the prompt to any external observer.
export const BLOCK_IF_RISK_OVER = 0.8;

// ─── Risk scoring ─────────────────────────────────────────────────────────────
// Weights are on a 0–1 scale; MAX_BASE_RISK is the denominator for normalisation.
// High-risk types cap the score quickly; combined detections compound.

const RISK_WEIGHTS: Record<DetectionType, number> = {
  [DetectionType.SSN]: 1,
  [DetectionType.API_KEY]: 1,
  [DetectionType.CREDIT_CARD]: 1,
  [DetectionType.BEARER_TOKEN]: 1,
  [DetectionType.EMAIL]: 0.6,
  [DetectionType.PHONE]: 0.6,
  [DetectionType.IP_ADDRESS]: 0.4,
  [DetectionType.NAME]: 0.2,
  [DetectionType.ADDRESS]: 0.2,
};

const MAX_BASE_RISK = 5;

export function computeRiskScore(detections: DetectionResult[]): number {
  if (detections.length === 0) return 0;
  const weightedSum = detections.reduce(
    (sum, d) => sum + (RISK_WEIGHTS[d.type] ?? 0.3),
    0,
  );
  return Number(Math.min(1, weightedSum / MAX_BASE_RISK).toFixed(3));
}

export function isSafeForLLM(score: number, mode: "strict" | "relaxed"): boolean {
  // Strict mode uses a tighter safety boundary than relaxed.
  // Future: these thresholds could be policy parameters stored in a
  // Midnight contract, allowing on-chain governance of privacy policy.
  const threshold = mode === "strict" ? 0.25 : 0.5;
  return score <= threshold;
}

// ─── Request ID generator ─────────────────────────────────────────────────────
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ─── One-way hash for audit witness ──────────────────────────────────────────
function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return `h_${(hash >>> 0).toString(16)}`;
}

// ─── Pipeline types ───────────────────────────────────────────────────────────

export type PipelineStatus = "allowed" | "blocked" | "error";

export interface PipelineResult {
  requestId: string;
  status: PipelineStatus;
  analyzeResponse: AnalyzeResponse;
  proofId?: string;
  auditEntry: AuditEntry;
  blockedReason?: string;
}

export type PipelineErrorCode =
  | "RISK_THRESHOLD_EXCEEDED"
  | "EMPTY_PROMPT"
  | "DETECTION_FAILURE"
  | "PROOF_FAILURE";

export class PipelineError extends Error {
  public readonly code: PipelineErrorCode;
  public readonly requestId: string;
  public readonly riskScore?: number;

  constructor(code: PipelineErrorCode, requestId: string, message: string, riskScore?: number) {
    super(message);
    this.name = "PipelineError";
    this.code = code;
    this.requestId = requestId;
    this.riskScore = riskScore;
  }
}

// ─── Module-level audit log ───────────────────────────────────────────────────
// Shared across all pipeline calls in this session.
// Future: replace with a Midnight on-chain append-only audit log.
const sharedAuditLog = new InMemoryAuditLog();

export function getAuditLog(): AuditEntry[] {
  return sharedAuditLog.entries();
}

// ─── Full proving pipeline ────────────────────────────────────────────────────
export async function runProvingPipeline(request: AnalyzeRequest): Promise<PipelineResult> {
  const requestId = generateRequestId();
  const mode = request.mode ?? "strict";
  const prompt = typeof request.prompt === "string" ? request.prompt.trim() : "";
  const timestamp = new Date().toISOString();

  // ── Step 1: Detect ────────────────────────────────────────────────────────
  const detections = detectSensitiveData(prompt, mode);

  // ── Step 2: Mask ──────────────────────────────────────────────────────────
  // The maskedText is the only form of the prompt that leaves this function.
  const maskingResult = maskDetections(prompt, detections);

  // ── Step 3: Score ─────────────────────────────────────────────────────────
  const riskScore = computeRiskScore(maskingResult.detections);
  const safeForLLM = isSafeForLLM(riskScore, mode);

  const analyzeResponse: AnalyzeResponse = {
    originalText: prompt,
    maskedText: maskingResult.maskedText,
    detections: maskingResult.detections,
    riskScore,
    safeForLLM,
    timestamp,
  };

  // ── Step 4: Block check ───────────────────────────────────────────────────
  // Hard block before any external call. Audit entry is still written so the
  // blocked attempt is on record.
  // Future: this policy check can be replicated inside a Midnight ZK circuit,
  // creating a verifiable proof that the block decision was correct.
  if (riskScore > BLOCK_IF_RISK_OVER) {
    const auditEntry = buildAuditEntry(requestId, analyzeResponse, false);
    sharedAuditLog.append(auditEntry);
    return {
      requestId,
      status: "blocked",
      analyzeResponse,
      auditEntry,
      blockedReason: `riskScore ${riskScore} exceeds BLOCK_IF_RISK_OVER (${BLOCK_IF_RISK_OVER})`,
    };
  }

  // ── Step 5: Proof generation ──────────────────────────────────────────────
  // The ProveInput contains only derived values — no raw prompt text.
  // Future: replace callVerifier with a Midnight ZK prover that generates a
  // zero-knowledge proof that PII was correctly detected and masked, without
  // revealing the original text to the verifier or the contract.
  const proveInput: ProveInput = {
    requestId,
    maskedTextHash: hashText(maskingResult.maskedText),
    detectionCount: maskingResult.detections.length,
    detectionTypes: maskingResult.detections.map((d) => d.type),
    riskScore,
  };

  const proveOutput = await callVerifier(proveInput);

  // ── Step 6: Contract submission ───────────────────────────────────────────
  // Stores the proof reference and audit commitment on-chain.
  // Future: Midnight Compact contract call — enforces privacy policy on-chain
  // without exposing underlying text or PII values to the network.
  await submitToContract({
    requestId,
    proofId: proveOutput.proofId,
    maskedTextHash: proveInput.maskedTextHash,
    riskScore,
    timestamp,
  });

  // ── Step 7: Audit log ─────────────────────────────────────────────────────
  // AuditEntry never contains raw secrets, hashes, or detection match values.
  const auditEntry = buildAuditEntry(requestId, analyzeResponse, proveOutput.proofGenerated);
  sharedAuditLog.append(auditEntry);

  return {
    requestId,
    status: "allowed",
    analyzeResponse,
    proofId: proveOutput.proofId,
    auditEntry,
  };
}
