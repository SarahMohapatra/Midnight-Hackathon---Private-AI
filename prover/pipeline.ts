// ─── Canonical privacy pipeline ───────────────────────────────────────────────
// runPrivacyPipeline is the ONLY pipeline implementation in the codebase.
// Older modules (prover/index.ts, app/src/library/prover.ts) now delegate to
// this function so behaviour, risk scoring, and the AI gate are identical
// for every caller.
//
// Stages:
//   1. validate input
//   2. detect sensitive substrings (regex engine)
//   3. mask deterministically with stable per-secret tokens
//   4. compute normalised risk score in [0, 1]
//   5. decide privacyStatus and whether the AI may be called
//   6. record an attestation on Midnight (live or local_fallback)
//   7. return one PipelineResult with everything the UI needs

import { maskDetections } from "./pii";
import { detectSensitiveData } from "./pii-detection";
import {
  DetectionType,
  PRIVACY_STATUS_CODE,
  type AiDispatchDecision,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AuditEntry,
  type DetectionResult,
  type MidnightAuditResult,
  type PipelineResult,
  type PrivacyStatus,
} from "./types";

import {
  recordAuditOnMidnight,
  type RecordAuditParams,
} from "./midnight";

// ─── Constants ────────────────────────────────────────────────────────────────

export const POLICY_VERSION = "privateprompt.policy.v1";
export const MAX_PROMPT_LENGTH = 10_000;

// Soft and hard gates run on the same normalised [0, 1] score.
//   - aiAllowed = riskScore < AI_SOFT_LIMIT (mode-dependent)
//   - blocked   = riskScore > BLOCK_IF_RISK_OVER
// blocked implies !aiAllowed and skips the LLM call entirely.
export const BLOCK_IF_RISK_OVER = 0.8;
export const AI_SOFT_LIMIT_STRICT = 0.25;
export const AI_SOFT_LIMIT_RELAXED = 0.5;

// Per-type weight used for the [0, 1] risk score.
const RISK_WEIGHTS: Record<DetectionType, number> = {
  [DetectionType.SSN]: 1.0,
  [DetectionType.API_KEY]: 1.0,
  [DetectionType.CREDIT_CARD]: 1.0,
  [DetectionType.BEARER_TOKEN]: 1.0,
  [DetectionType.EMAIL]: 0.6,
  [DetectionType.PHONE]: 0.6,
  [DetectionType.IP_ADDRESS]: 0.4,
  [DetectionType.NAME]: 0.2,
  [DetectionType.ADDRESS]: 0.2,
};

// Denominator so a small handful of high-weight detections already saturate
// the score. Keeps the gauge readable for users.
const MAX_BASE_RISK = 3;

// ─── Errors ───────────────────────────────────────────────────────────────────

export type PrivacyPipelineErrorCode =
  | "INVALID_INPUT"
  | "INTERNAL";

export class PrivacyPipelineError extends Error {
  public readonly code: PrivacyPipelineErrorCode;

  constructor(code: PrivacyPipelineErrorCode, message: string) {
    super(message);
    this.name = "PrivacyPipelineError";
    this.code = code;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `req_${crypto.randomUUID()}`;
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sess_${crypto.randomUUID()}`;
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// One-way fingerprint suitable for audit hashes. Not cryptographically secure
// on its own; sufficient for our commitment metadata, and trivially swappable
// for SubtleCrypto SHA-256 when we land the production version.
function djb2Hash(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function commitmentHash(maskedText: string, policyVersion: string): string {
  return `0x${djb2Hash(`${policyVersion}|${maskedText}`)}`;
}

export function sessionFingerprint(sessionId: string): string {
  return `0x${djb2Hash(sessionId)}`;
}

function validatePrompt(input: unknown): string {
  if (input === null || input === undefined) {
    throw new PrivacyPipelineError("INVALID_INPUT", "prompt is null or undefined");
  }
  if (typeof input !== "string") {
    throw new PrivacyPipelineError("INVALID_INPUT", "prompt must be a string");
  }
  if (input.length > MAX_PROMPT_LENGTH) {
    return input.slice(0, MAX_PROMPT_LENGTH);
  }
  return input;
}

// Normalised weighted risk in [0, 1].
export function computeRiskScore(detections: DetectionResult[]): number {
  if (detections.length === 0) return 0;
  const weighted = detections.reduce(
    (sum, det) => sum + (RISK_WEIGHTS[det.type] ?? 0.3),
    0,
  );
  return Number(Math.min(1, weighted / MAX_BASE_RISK).toFixed(3));
}

export function decidePrivacyStatus(
  riskScore: number,
  detectionCount: number,
): PrivacyStatus {
  if (riskScore > BLOCK_IF_RISK_OVER) return "blocked";
  if (detectionCount > 0) return "masked";
  return "clean";
}

export function decideAiAllowed(
  riskScore: number,
  status: PrivacyStatus,
  mode: "strict" | "relaxed",
): boolean {
  if (status === "blocked") return false;
  const limit = mode === "strict" ? AI_SOFT_LIMIT_STRICT : AI_SOFT_LIMIT_RELAXED;
  return riskScore <= limit;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export interface PipelineOptions {
  // Disable the Midnight write entirely (used for the live editor scan loop
  // so we don't spam the chain while the user is still typing).
  skipMidnight?: boolean;
  // Override the policy version reported in the attestation (rare).
  policyVersion?: string;
}

export async function runPrivacyPipeline(
  request: AnalyzeRequest,
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  if (request === null || request === undefined) {
    throw new PrivacyPipelineError("INVALID_INPUT", "request is null or undefined");
  }

  const requestId = generateRequestId();
  const sessionId = generateSessionId();
  const mode = request.mode ?? "strict";
  const policyVersion = options.policyVersion ?? POLICY_VERSION;
  const timestamp = new Date().toISOString();
  const sanitized = validatePrompt(request.prompt);
  const trimmed = sanitized.trim();

  // Empty prompt: short-circuit but still surface a consistent shape.
  if (!trimmed) {
    return buildEmptyResult({
      requestId,
      sessionId,
      timestamp,
      policyVersion,
      network: midnightNetworkLabel(),
    });
  }

  // ── 1. detect ──────────────────────────────────────────────────────────
  const detections = detectSensitiveData(sanitized, mode);

  // ── 2. mask ────────────────────────────────────────────────────────────
  const masking = maskDetections(sanitized, detections);
  const maskedText = masking.maskedText;
  const finalDetections = masking.detections;

  // ── 3. score ───────────────────────────────────────────────────────────
  const riskScore = computeRiskScore(finalDetections);

  // ── 4. decide ──────────────────────────────────────────────────────────
  const privacyStatus = decidePrivacyStatus(riskScore, finalDetections.length);
  const aiAllowed = decideAiAllowed(riskScore, privacyStatus, mode);
  const commitment = commitmentHash(maskedText, policyVersion);
  const sessionHash = sessionFingerprint(sessionId);

  const response: AnalyzeResponse = {
    originalText: sanitized,
    maskedText,
    detections: finalDetections,
    riskScore,
    privacyStatus,
    policyVersion,
    sessionId,
    timestamp,
  };

  const audit: AuditEntry = {
    requestId,
    sessionIdHash: sessionHash,
    commitmentHash: commitment,
    policyVersion,
    status: privacyStatus,
    riskScore,
    detectionCount: finalDetections.length,
    timestamp,
  };

  // ── 5. attest on Midnight ──────────────────────────────────────────────
  const midnight: MidnightAuditResult = options.skipMidnight
    ? skipMidnightResult({
        policyVersion,
        commitment,
        sessionHash,
        privacyStatus,
        timestamp,
      })
    : await safeRecordAudit({
        commitmentHash: commitment,
        sessionIdHash: sessionHash,
        status: privacyStatus,
        statusCode: PRIVACY_STATUS_CODE[privacyStatus],
        policyVersion,
        timestamp,
      });

  const aiDispatch: AiDispatchDecision = {
    allowed: aiAllowed,
    called: false,
    reason: aiAllowed
      ? undefined
      : privacyStatus === "blocked"
        ? `Risk score ${riskScore.toFixed(2)} exceeds block threshold ${BLOCK_IF_RISK_OVER}`
        : `Risk score ${riskScore.toFixed(2)} above soft limit for ${mode} mode`,
  };

  return { requestId, response, audit, midnight, aiDispatch };
}

// ─── Empty / skipped helpers ──────────────────────────────────────────────────

interface EmptyArgs {
  requestId: string;
  sessionId: string;
  timestamp: string;
  policyVersion: string;
  network: string;
}

function buildEmptyResult(args: EmptyArgs): PipelineResult {
  const response: AnalyzeResponse = {
    originalText: "",
    maskedText: "",
    detections: [],
    riskScore: 0,
    privacyStatus: "clean",
    policyVersion: args.policyVersion,
    sessionId: args.sessionId,
    timestamp: args.timestamp,
  };
  const audit: AuditEntry = {
    requestId: args.requestId,
    sessionIdHash: sessionFingerprint(args.sessionId),
    commitmentHash: commitmentHash("", args.policyVersion),
    policyVersion: args.policyVersion,
    status: "clean",
    riskScore: 0,
    detectionCount: 0,
    timestamp: args.timestamp,
  };
  return {
    requestId: args.requestId,
    response,
    audit,
    midnight: {
      mode: "skipped",
      network: args.network,
      policyVersion: args.policyVersion,
      commitmentHash: audit.commitmentHash,
      sessionIdHash: audit.sessionIdHash,
      status: "clean",
      timestamp: args.timestamp,
    },
    aiDispatch: { allowed: false, called: false, reason: "Empty prompt" },
  };
}

function skipMidnightResult(args: {
  policyVersion: string;
  commitment: string;
  sessionHash: string;
  privacyStatus: PrivacyStatus;
  timestamp: string;
}): MidnightAuditResult {
  return {
    mode: "skipped",
    network: midnightNetworkLabel(),
    policyVersion: args.policyVersion,
    commitmentHash: args.commitment,
    sessionIdHash: args.sessionHash,
    status: args.privacyStatus,
    timestamp: args.timestamp,
  };
}

async function safeRecordAudit(params: RecordAuditParams): Promise<MidnightAuditResult> {
  try {
    return await recordAuditOnMidnight(params);
  } catch (error) {
    return {
      mode: "local_fallback",
      network: midnightNetworkLabel(),
      policyVersion: params.policyVersion,
      commitmentHash: params.commitmentHash,
      sessionIdHash: params.sessionIdHash,
      status: params.status,
      timestamp: params.timestamp,
      error: error instanceof Error ? error.message : "unknown adapter error",
    };
  }
}

function midnightNetworkLabel(): string {
  // Vite env access is wrapped here so non-Vite consumers (tests, Node) work.
  if (typeof import.meta !== "undefined") {
    const env = (import.meta as ImportMeta & {
      env?: Record<string, string | undefined>;
    }).env;
    if (env?.VITE_MIDNIGHT_NETWORK) return env.VITE_MIDNIGHT_NETWORK;
  }
  return "testnet";
}
