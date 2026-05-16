// ─── Safe LLM Passthrough ─────────────────────────────────────────────────────
// This module is the ONLY place that talks to a language model.
// Contract: only a SafeLlmRequest may be sent — it has no raw-prompt field.
// The original user text must never reach this layer.

import type { AnalyzeResponse } from "../../../prover/types";

// ─── Request / Response types ─────────────────────────────────────────────────

export interface SafeLlmRequest {
  // maskedText is the only text field — raw PII must never appear here.
  maskedText: string;
  requestId: string;
  mode: "strict" | "relaxed";
  timestamp: string;
}

export interface SafeLlmResponse {
  requestId: string;
  responseText: string;
  model: string;
  timestamp: string;
  tokensUsed: number;
}

// ─── Structured error type ────────────────────────────────────────────────────

export type LlmErrorCode =
  | "UNSAFE_PROMPT_REJECTED"
  | "EMPTY_MASKED_TEXT"
  | "API_RATE_LIMIT"
  | "API_UNAVAILABLE"
  | "TIMEOUT";

export class PrivatePromptLlmError extends Error {
  public readonly code: LlmErrorCode;
  public readonly requestId: string;

  constructor(code: LlmErrorCode, requestId: string, message: string) {
    super(message);
    this.name = "PrivatePromptLlmError";
    this.code = code;
    this.requestId = requestId;
  }
}

// ─── Request builder ──────────────────────────────────────────────────────────
// Converts an AnalyzeResponse into a SafeLlmRequest.
// Throws PrivatePromptLlmError if the response is not safe for forwarding.
// This is the enforced gateway — no bypassing by calling mockLlmCall directly
// with an unsafe prompt.

export function createSafeLlmRequest(
  requestId: string,
  analyzeResponse: AnalyzeResponse,
  mode: "strict" | "relaxed" = "strict",
): SafeLlmRequest {
  if (!analyzeResponse.safeForLLM) {
    throw new PrivatePromptLlmError(
      "UNSAFE_PROMPT_REJECTED",
      requestId,
      `Request ${requestId} rejected: riskScore ${analyzeResponse.riskScore} exceeds safe threshold`,
    );
  }

  const masked = analyzeResponse.maskedText.trim();
  if (!masked) {
    throw new PrivatePromptLlmError(
      "EMPTY_MASKED_TEXT",
      requestId,
      `Request ${requestId}: masked text is empty after analysis`,
    );
  }

  return {
    maskedText: masked,
    requestId,
    mode,
    timestamp: new Date().toISOString(),
  };
}

// ─── Mock LLM call ─────────────────────────────────────────────────────────────
// Simulates a real LLM API response for hackathon demo.
// Replace the body with the real provider SDK call (OpenAI, Anthropic, etc.).
// IMPORTANT: only request.maskedText is ever forwarded — original prompt is gone.
//
// Future (Midnight):
//   Attach the Midnight proof attestation as a header or signed metadata so the
//   LLM provider can verify the request was privacy-screened before submission.
//   Zero-knowledge attestation: the proof certifies PII was removed without
//   revealing what PII was present or what the original text contained.

export async function mockLlmCall(request: SafeLlmRequest): Promise<SafeLlmResponse> {
  const masked = request.maskedText.trim();
  if (!masked) {
    throw new PrivatePromptLlmError(
      "EMPTY_MASKED_TEXT",
      request.requestId,
      "Cannot forward empty masked prompt to LLM",
    );
  }

  // Simulated provider latency
  await new Promise<void>((resolve) => { setTimeout(resolve, 200); });

  const preview = masked.length > 80 ? `${masked.slice(0, 80)}…` : masked;

  return {
    requestId: request.requestId,
    responseText: `[Mock LLM] Processed masked prompt: "${preview}"`,
    model: "mock-gpt-v1",
    timestamp: new Date().toISOString(),
    tokensUsed: Math.ceil(masked.length / 4),
  };
}

// ─── LlmClient interface ──────────────────────────────────────────────────────
// Future: implement this with the real provider SDK and inject it wherever
// mockLlmCall is currently used.

export interface LlmClient {
  call(request: SafeLlmRequest): Promise<SafeLlmResponse>;
}

// ─── Convenience helper ───────────────────────────────────────────────────────
// Combines createSafeLlmRequest + mockLlmCall for pipeline consumers that
// have an AnalyzeResponse and just want a guarded LLM response back.

export async function safeLlmRoundTrip(
  requestId: string,
  analyzeResponse: AnalyzeResponse,
  mode: "strict" | "relaxed" = "strict",
): Promise<SafeLlmResponse> {
  const safeRequest = createSafeLlmRequest(requestId, analyzeResponse, mode);
  return mockLlmCall(safeRequest);
}
