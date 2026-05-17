// ─── Safe LLM Passthrough ─────────────────────────────────────────────────────
// This module is the ONLY place that talks to a language model.
// Contract: callers must hand over a SafeLlmRequest (no raw-prompt field).
// The original user text never reaches this layer.

import type { PipelineResult } from "../../../prover/types";

// ─── Request / Response types ─────────────────────────────────────────────────

export interface SafeLlmRequest {
  // maskedText is the ONLY text field. Raw PII must never appear here.
  maskedText: string;
  requestId: string;
  sessionId: string;
  mode: "strict" | "relaxed";
  policyVersion: string;
  // Optional Midnight audit metadata the LLM provider could verify in future.
  attestation?: {
    commitmentHash: string;
    sessionIdHash: string;
    txHash?: string;
  };
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

// ─── Enforced gateway ─────────────────────────────────────────────────────────
// Builds a SafeLlmRequest directly from a PipelineResult. If the pipeline
// disallowed the AI call, this throws — there is no path that hands raw text
// to the model.

export function buildSafeLlmRequest(pipeline: PipelineResult): SafeLlmRequest {
  if (!pipeline.aiDispatch.allowed) {
    throw new PrivatePromptLlmError(
      "UNSAFE_PROMPT_REJECTED",
      pipeline.requestId,
      pipeline.aiDispatch.reason ?? "AI dispatch not allowed for this prompt",
    );
  }
  const masked = pipeline.response.maskedText.trim();
  if (!masked) {
    throw new PrivatePromptLlmError(
      "EMPTY_MASKED_TEXT",
      pipeline.requestId,
      "Masked text is empty after analysis",
    );
  }
  return {
    maskedText: masked,
    requestId: pipeline.requestId,
    sessionId: pipeline.response.sessionId,
    mode: pipeline.response.detections.length > 0 ? "strict" : "relaxed",
    policyVersion: pipeline.response.policyVersion,
    attestation: {
      commitmentHash: pipeline.midnight.commitmentHash,
      sessionIdHash: pipeline.midnight.sessionIdHash,
      txHash: pipeline.midnight.txHash,
    },
    timestamp: new Date().toISOString(),
  };
}

// ─── LLM client ───────────────────────────────────────────────────────────────
// Mock implementation for the hackathon demo. Replace `mockLlmCall` with a
// real provider call (OpenAI, Anthropic, …) when wiring production. The
// request shape is intentionally narrow: maskedText only, plus metadata that
// helps a privacy-aware backend log/verify the attestation.

const MOCK_LATENCY_MS = 650;

export async function callLlm(request: SafeLlmRequest): Promise<SafeLlmResponse> {
  if (!request.maskedText.trim()) {
    throw new PrivatePromptLlmError(
      "EMPTY_MASKED_TEXT",
      request.requestId,
      "callLlm received an empty masked prompt",
    );
  }

  await new Promise<void>((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

  const preview = request.maskedText.length > 160
    ? `${request.maskedText.slice(0, 160)}…`
    : request.maskedText;

  const responseText = composeMockResponse(preview, request);

  return {
    requestId: request.requestId,
    responseText,
    model: "privateprompt-mock-v1",
    timestamp: new Date().toISOString(),
    tokensUsed: Math.ceil(request.maskedText.length / 4),
  };
}

// One-shot helper: validate the pipeline, build the request, run the call.
export async function safeLlmRoundTrip(pipeline: PipelineResult): Promise<SafeLlmResponse> {
  const request = buildSafeLlmRequest(pipeline);
  return callLlm(request);
}

// ─── Mock response composer ──────────────────────────────────────────────────
// Crafted to make the demo feel real: it acknowledges the privacy guarantee,
// answers in a generic but reasonable way, and references the attestation
// without leaking anything sensitive.

function composeMockResponse(preview: string, request: SafeLlmRequest): string {
  const lines = [
    "Privacy-screened response from PrivatePrompt mock model.",
    "",
    `> ${preview}`,
    "",
    "I never see your original text — only the masked tokens above. If you wired a",
    "real LLM provider here, the same masked payload would be forwarded, and the",
    "Midnight attestation could be sent alongside it so the provider can verify",
    "the request was privacy-screened by policy " + request.policyVersion + ".",
  ];
  if (request.attestation?.txHash) {
    lines.push("", `Attestation tx: ${request.attestation.txHash}`);
  }
  return lines.join("\n");
}
