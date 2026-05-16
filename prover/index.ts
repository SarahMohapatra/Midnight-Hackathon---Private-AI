import { buildAuditRecord, InMemoryAuditStore, type AuditStore } from "./audit";
import type { ProverAdapter } from "./mock";
import { detectSensitiveData, type Detector } from "./pii-detection";
import { maskDetections } from "./pii";
import { submitProofToContract } from "./api";
import {
  DetectionType,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AuditRecord,
  type DetectionResult,
} from "./types";

// ─── Typed errors ─────────────────────────────────────────────────────────────
// ProvingError is the shared error type for the proving pipeline. Callers can
// branch on `code` to distinguish input failures from proof or contract issues
// without parsing message strings.

export type ProvingErrorCode = "INVALID_INPUT" | "PROOF_FAILED" | "CONTRACT_ERROR";

export class ProvingError extends Error {
  public readonly code: ProvingErrorCode;

  constructor(message: string, code: ProvingErrorCode) {
    super(message);
    this.name = "ProvingError";
    this.code = code;
  }
}

// ─── Input validation ─────────────────────────────────────────────────────────
// The proving pipeline must reject malformed input before running detection,
// masking, scoring, or proof generation. validatePromptInput is the single
// source of truth: it throws ProvingError("INVALID_INPUT") for null/undefined
// or non-string prompts, and truncates oversize prompts to MAX_PROMPT_LENGTH
// after emitting a console.warn so downstream stages always receive a bounded
// string.

const MAX_PROMPT_LENGTH = 10_000;

function generateSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function validatePromptInput(prompt: unknown): string {
  if (prompt === null || prompt === undefined) {
    throw new ProvingError(
      "Invalid input: prompt is null or undefined",
      "INVALID_INPUT",
    );
  }
  if (typeof prompt !== "string") {
    throw new ProvingError(
      "Invalid input: prompt must be a string",
      "INVALID_INPUT",
    );
  }
  if (prompt.length > MAX_PROMPT_LENGTH) {
    console.warn(`[Prover] Prompt truncated to ${MAX_PROMPT_LENGTH} chars`);
    return prompt.slice(0, MAX_PROMPT_LENGTH);
  }
  return prompt;
}

function buildEmptyAnalyzeResponse(sessionId: string): AnalyzeResponse {
  return {
    originalText: "",
    maskedText: "",
    detections: [],
    riskScore: 0,
    safeForLLM: true,
    timestamp: new Date().toISOString(),
    proofGenerated: false,
    proofHash: null,
    sessionId,
  };
}

// ─── Risk scoring ─────────────────────────────────────────────────────────────
// Weighted PII risk score. Each detection contributes points based on type:
//   SSN, CREDIT_CARD, API_KEY  → 40 (high risk)
//   EMAIL, PHONE                → 20 (medium risk)
//   NAME, ADDRESS               → 10 (low risk)
//   any unrecognised type       → 10 (safe default)
// Sum is capped at 100. safeForLLM is true only when the final score is below
// the block threshold; above that we hard-stop before any proof generation
// or contract submission.

const RISK_BLOCK_THRESHOLD = 80;

function detectionRiskWeight(type: DetectionType): number {
  switch (type) {
    case DetectionType.SSN:
    case DetectionType.CREDIT_CARD:
    case DetectionType.API_KEY:
      return 40;
    case DetectionType.EMAIL:
    case DetectionType.PHONE:
      return 20;
    case DetectionType.NAME:
    case DetectionType.ADDRESS:
      return 10;
    default:
      return 10;
  }
}

function computeRiskScore(detections: DetectionResult[]): number {
  const total = detections.reduce(
    (sum, item) => sum + detectionRiskWeight(item.type),
    0,
  );
  return Math.min(100, total);
}

function isSafeForLLM(riskScore: number): boolean {
  return riskScore < RISK_BLOCK_THRESHOLD;
}

// ─── ZK proof generation ──────────────────────────────────────────────────────
// Attempts to generate a real Midnight Compact proof via dynamic import. If
// the SDK package is missing or the proof call throws for any reason, falls
// back to a clearly-labelled mock proof hash and sets proofGenerated to false
// so the UI can flag it as unverified. This function never throws.

interface CompactProver {
  prove(input: { detectionCount: number; riskScore: number }): Promise<unknown>;
}

interface CompactRuntimeModule {
  createProver?: (circuit: unknown) => Promise<CompactProver>;
}

const COMPACT_RUNTIME_MODULE = "@midnight-ntwrk/compact-runtime";
const PII_POLICY_CIRCUIT = {
  name: "privateprompt-pii-policy",
  version: 1,
};

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function fingerprintProof(proof: unknown): string {
  const source = safeStringify(proof);
  let hash = 5381;
  for (let index = 0; index < source.length; index += 1) {
    hash = (hash * 33) ^ source.charCodeAt(index);
  }
  return (hash >>> 0).toString(16);
}

interface ProofGenerationResult {
  proofGenerated: boolean;
  proofHash: string;
}

async function generateZKProof(
  detections: DetectionResult[],
  riskScore: number,
): Promise<ProofGenerationResult> {
  // Indirect the module name through a const so static analysis does not try
  // to resolve the Midnight package at compile time.
  const moduleName = COMPACT_RUNTIME_MODULE;
  try {
    const runtime = (await import(/* @vite-ignore */ moduleName)) as CompactRuntimeModule;
    if (!runtime.createProver) {
      throw new ProvingError(
        "Compact runtime exposed no createProver export",
        "PROOF_FAILED",
      );
    }
    const prover = await runtime.createProver(PII_POLICY_CIRCUIT);
    const proof = await prover.prove({
      detectionCount: detections.length,
      riskScore,
    });
    return {
      proofGenerated: true,
      proofHash: `zk_${fingerprintProof(proof)}_${crypto.randomUUID()}`,
    };
  } catch {
    console.warn(
      "[Prover] Midnight Compact SDK unavailable — falling back to mock proof.",
    );
    return {
      proofGenerated: false,
      proofHash: `mock_proof_${crypto.randomUUID()}`,
    };
  }
}

// ─── AnalyzeService (legacy entry, still backed by AuditStore) ────────────────
// createAnalyzeService keeps its public surface unchanged. Internally it now
// delegates the full pipeline to runProvingPipeline and only owns the
// in-memory AuditRecord store so existing callers of getAuditRecords keep
// working.

export interface AnalyzeService {
  analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>;
  getAuditRecords(): AuditRecord[];
}

export interface AnalyzeServiceDependencies {
  detector?: Detector;
  prover?: ProverAdapter;
  auditStore?: AuditStore;
}

export function createAnalyzeService(
  dependencies: AnalyzeServiceDependencies = {},
): AnalyzeService {
  const auditStore = dependencies.auditStore ?? new InMemoryAuditStore();

  return {
    async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
      const response = await runProvingPipeline(request);

      const auditRecord = buildAuditRecord(
        { ...request, prompt: response.originalText },
        response,
        {
          proofId: response.proofHash ?? undefined,
          verified: response.proofGenerated,
        },
      );
      auditStore.add(auditRecord);

      return response;
    },

    getAuditRecords(): AuditRecord[] {
      return auditStore.list();
    },
  };
}

// ─── Public proving pipeline ─────────────────────────────────────────────────
// runProvingPipeline is the canonical entry point. Validation runs first;
// then detection, masking, weighted scoring, and the safety gate. Proof
// generation and contract submission live in their own independent try/catch
// blocks so neither can prevent the function from returning a complete
// AnalyzeResponse.

export async function runProvingPipeline(
  request: AnalyzeRequest,
): Promise<AnalyzeResponse> {
  if (request === null || request === undefined) {
    throw new ProvingError(
      "Invalid input: request is null or undefined",
      "INVALID_INPUT",
    );
  }

  const sanitizedPrompt = validatePromptInput(request.prompt);
  const sessionId = generateSessionId();

  if (!sanitizedPrompt.trim()) {
    return buildEmptyAnalyzeResponse(sessionId);
  }

  const mode = request.mode ?? "strict";
  const timestamp = new Date().toISOString();

  const detections = detectSensitiveData(sanitizedPrompt, mode);
  const masking = maskDetections(sanitizedPrompt, detections);
  const riskScore = computeRiskScore(masking.detections);
  const safeForLLM = isSafeForLLM(riskScore);

  // Hard gate: above the block threshold we do not generate a proof and we
  // do not submit anything to the contract. The masked text and detections
  // are still returned so the UI can show the user what was flagged.
  if (!safeForLLM) {
    return {
      originalText: sanitizedPrompt,
      maskedText: masking.maskedText,
      detections: masking.detections,
      riskScore,
      safeForLLM,
      timestamp,
      proofGenerated: false,
      proofHash: null,
      sessionId,
    };
  }

  // Proof generation: never throws — always returns a usable shape.
  const proof = await generateZKProof(masking.detections, riskScore);

  // Contract submission: independent try/catch — a failure here must not
  // affect the response we hand back to the UI. submitProofToContract itself
  // already swallows network errors, but we add a defensive wrapper so any
  // unexpected throw is also contained.
  try {
    await submitProofToContract(proof.proofHash, sessionId, masking.detections);
  } catch (error) {
    console.warn(
      "[Prover] Contract submission failed; continuing with local audit.",
      error,
    );
  }

  return {
    originalText: sanitizedPrompt,
    maskedText: masking.maskedText,
    detections: masking.detections,
    riskScore,
    safeForLLM,
    timestamp,
    proofGenerated: proof.proofGenerated,
    proofHash: proof.proofHash,
    sessionId,
  };
}

// analyzePrompt remains for backward compatibility with existing call sites.
// It now routes through runProvingPipeline so the same validation, scoring,
// proof, and contract contract apply at every public entry point.
export function analyzePrompt(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  return runProvingPipeline(request);
}

export { detectSensitiveData };
