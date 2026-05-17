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
// When VITE_OPENAI_API_KEY is set, callLlm forwards the masked payload to
// OpenAI's Chat Completions API. The request shape is intentionally narrow:
// maskedText only, plus metadata that a privacy-aware provider could verify.
// When no key is configured, callLlm falls back to a deterministic mock so
// the demo still runs offline.
//
// Security note: shipping an API key to the browser is a hackathon-only
// shortcut. In production this call belongs on a backend that holds the key.

const MOCK_LATENCY_MS = 650;
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const OPENAI_MODEL = "gpt-4o-mini";
const OPENAI_TIMEOUT_MS = 30_000;

function readOpenAiKey(): string | undefined {
  if (typeof import.meta === "undefined") return undefined;
  const env = (import.meta as ImportMeta & {
    env?: Record<string, string | undefined>;
  }).env;
  const key = env?.VITE_OPENAI_API_KEY?.trim();
  return key && key.length > 0 ? key : undefined;
}

export async function callLlm(request: SafeLlmRequest): Promise<SafeLlmResponse> {
  if (!request.maskedText.trim()) {
    throw new PrivatePromptLlmError(
      "EMPTY_MASKED_TEXT",
      request.requestId,
      "callLlm received an empty masked prompt",
    );
  }

  const apiKey = readOpenAiKey();
  if (apiKey) {
    return callOpenAi(request, apiKey);
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

async function callOpenAi(
  request: SafeLlmRequest,
  apiKey: string,
): Promise<SafeLlmResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  const systemPrompt = [
    "You are an assistant inside a privacy-preserving gateway.",
    "The user's prompt has already been screened: any sensitive values were",
    "replaced with stable tokens of the form [EMAIL_1], [SSN_1], [PHONE_2],",
    "[ADDRESS_1], [API_KEY_1], etc. Treat each token as an opaque placeholder",
    "for a real value you will never see. Preserve the exact tokens verbatim",
    "in your response wherever the underlying value would appear (do not",
    "invent example values, do not change the index, do not unmask).",
    `Policy version: ${request.policyVersion}.`,
  ].join(" ");

  let response: Response;
  try {
    response = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: request.maskedText },
        ],
      }),
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new PrivatePromptLlmError(
        "TIMEOUT",
        request.requestId,
        `OpenAI request timed out after ${OPENAI_TIMEOUT_MS}ms`,
      );
    }
    throw new PrivatePromptLlmError(
      "API_UNAVAILABLE",
      request.requestId,
      error instanceof Error ? error.message : "OpenAI request failed",
    );
  }
  clearTimeout(timer);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 429) {
      throw new PrivatePromptLlmError(
        "API_RATE_LIMIT",
        request.requestId,
        `OpenAI rate limit (${response.status}): ${detail.slice(0, 240)}`,
      );
    }
    throw new PrivatePromptLlmError(
      "API_UNAVAILABLE",
      request.requestId,
      `OpenAI error ${response.status}: ${detail.slice(0, 240)}`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
    model?: string;
  };
  const responseText = payload.choices?.[0]?.message?.content?.trim() ?? "";
  if (!responseText) {
    throw new PrivatePromptLlmError(
      "API_UNAVAILABLE",
      request.requestId,
      "OpenAI returned an empty completion",
    );
  }

  return {
    requestId: request.requestId,
    responseText,
    model: payload.model ?? OPENAI_MODEL,
    timestamp: new Date().toISOString(),
    tokensUsed: payload.usage?.total_tokens ?? Math.ceil(request.maskedText.length / 4),
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
