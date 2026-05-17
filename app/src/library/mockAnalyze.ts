// ─── Analysis facade + demo helpers ──────────────────────────────────────────
// mockAnalyze is the UI's public entry point. It now returns the full
// PipelineResult (privacy analysis + Midnight attestation + AI dispatch
// decision) so the chat component can branch on a single object without
// having to guess from riskScore alone.

import {
  runPrivacyPipeline,
  type PipelineOptions,
} from "../../../prover/pipeline";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  PipelineResult,
} from "../../../prover/types";

export { BLOCK_IF_RISK_OVER, POLICY_VERSION, computeRiskScore } from "../../../prover/pipeline";

// ─── Structured logging ──────────────────────────────────────────────────────

export interface AnalyzeLogEvent {
  event: "analyze_start" | "analyze_complete" | "analyze_blocked";
  timestamp: string;
  details: Record<string, string | number | boolean>;
}

export function createAnalysisLog(
  event: AnalyzeLogEvent["event"],
  details: AnalyzeLogEvent["details"],
): AnalyzeLogEvent {
  return { event, timestamp: new Date().toISOString(), details };
}

export function logAnalysisEvent(log: AnalyzeLogEvent): void {
  console.info(`[PrivatePrompt] ${JSON.stringify(log)}`);
}

// ─── Entry points ─────────────────────────────────────────────────────────────

export function normalizePromptInput(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

// Live editor scan: cheap pass with no Midnight write, used by the debounced
// composer to highlight detections while the user is still typing.
export async function previewAnalyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const pipeline = await runPrivacyPipeline(request, { skipMidnight: true });
  return pipeline.response;
}

// Full analysis: runs the canonical pipeline including the Midnight write.
// Returns the complete PipelineResult so the UI knows whether to dispatch
// to the LLM, whether Midnight went live or fell back, and what to render in
// the audit panel.
export async function analyzePromptFull(
  request: AnalyzeRequest,
  options?: PipelineOptions,
): Promise<PipelineResult> {
  const mode = request.mode ?? "strict";
  const prompt = normalizePromptInput(request.prompt);

  logAnalysisEvent(
    createAnalysisLog("analyze_start", {
      mode,
      promptLength: prompt.length,
      hasPrompt: prompt.length > 0,
    }),
  );

  const result = await runPrivacyPipeline({ prompt, mode }, options);

  const evt: AnalyzeLogEvent["event"] =
    result.response.privacyStatus === "blocked" ? "analyze_blocked" : "analyze_complete";

  logAnalysisEvent(
    createAnalysisLog(evt, {
      requestId: result.requestId,
      status: result.response.privacyStatus,
      detections: result.response.detections.length,
      riskScore: result.response.riskScore,
      midnight: result.midnight.mode,
      aiAllowed: result.aiDispatch.allowed,
    }),
  );

  return result;
}

// Backward-compat alias: older callers (and our own debounced editor) just
// want the AnalyzeResponse. Continues to work after the canonical refactor.
export async function mockAnalyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  return previewAnalyze(request);
}

// ─── Demo scenarios (A clean, B masked, C blocked) ────────────────────────────

export interface DemoScenario {
  id: "clean" | "masked" | "blocked";
  label: string;
  description: string;
  prompt: string;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "clean",
    label: "Scenario A · Clean",
    description: "No sensitive content. AI runs, Midnight records a clean attestation.",
    prompt: "Summarise the key trade-offs between row-store and column-store databases.",
  },
  {
    id: "masked",
    label: "Scenario B · Masked",
    description: "Email + SSN detected. Tokens replace the secrets before the AI request.",
    prompt:
      "My email is jane.doe@corp.com and my SSN is 123-45-6789 — draft a polite follow-up to my account manager.",
  },
  {
    id: "blocked",
    label: "Scenario C · Blocked",
    description: "Multiple high-risk fields. AI call is suppressed; Midnight logs a block.",
    prompt:
      "Use SSN 987-65-4320, card 4111 1111 1111 1111, key sk_live_ABCDEF1234567890, Bearer secret_TOKEN_ABCDEF1234, email leak@corp.com.",
  },
];
