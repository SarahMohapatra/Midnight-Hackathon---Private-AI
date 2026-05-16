// ─── Analysis facade + demo harness ──────────────────────────────────────────
// mockAnalyze is the public API consumed by the UI layer.
// Internally it delegates to runProvingPipeline (detect → mask → score →
// block-check → prove → audit) and unwraps the AnalyzeResponse.
//
// This file also owns:
//   - structured logging helpers
//   - demo test scenarios
//   - re-exports of risk-scoring utilities from prover.ts

import { runProvingPipeline, type PipelineResult } from "./prover";
import type { AnalyzeRequest, AnalyzeResponse } from "../../../prover/types";

// Re-export scoring utilities so existing callers don't need to change imports.
export { computeRiskScore, isSafeForLLM, BLOCK_IF_RISK_OVER } from "./prover";

// ─── Logging helpers ──────────────────────────────────────────────────────────

export interface AnalyzeLogEvent {
  event: "analyze_start" | "analyze_complete" | "analyze_blocked";
  timestamp: string;
  details: Record<string, string | number | boolean>;
}

export function createAnalysisLog(
  event: AnalyzeLogEvent["event"],
  details: AnalyzeLogEvent["details"],
): AnalyzeLogEvent {
  return {
    event,
    timestamp: new Date().toISOString(),
    details,
  };
}

export function logAnalysisEvent(log: AnalyzeLogEvent): void {
  console.info(`[PrivatePrompt] ${JSON.stringify(log)}`);
}

// ─── Input normaliser ─────────────────────────────────────────────────────────

export function normalizePromptInput(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim();
}

// ─── Public analysis entry point ──────────────────────────────────────────────
// Returns an AnalyzeResponse in all cases — callers inspect safeForLLM and
// riskScore to decide whether to forward the masked prompt to an LLM.
// Pipeline stage results (proofId, auditEntry, requestId) are available via
// runProvingPipeline directly when the caller needs richer metadata.

export async function mockAnalyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const mode = request.mode ?? "strict";
  const prompt = normalizePromptInput(request.prompt);

  logAnalysisEvent(
    createAnalysisLog("analyze_start", {
      mode,
      promptLength: prompt.length,
      hasPrompt: prompt.length > 0,
    }),
  );

  // Empty prompts short-circuit before hitting the full pipeline.
  if (!prompt) {
    const emptyResponse: AnalyzeResponse = {
      originalText: "",
      maskedText: "",
      detections: [],
      riskScore: 0,
      safeForLLM: true,
      timestamp: new Date().toISOString(),
    };
    logAnalysisEvent(
      createAnalysisLog("analyze_complete", { detections: 0, riskScore: 0, safeForLLM: true }),
    );
    return emptyResponse;
  }

  const result: PipelineResult = await runProvingPipeline({ prompt, mode });

  const eventName: AnalyzeLogEvent["event"] =
    result.status === "blocked" ? "analyze_blocked" : "analyze_complete";

  logAnalysisEvent(
    createAnalysisLog(eventName, {
      requestId: result.requestId,
      status: result.status,
      detections: result.analyzeResponse.detections.length,
      riskScore: result.analyzeResponse.riskScore,
      safeForLLM: result.analyzeResponse.safeForLLM,
      proofGenerated: result.auditEntry.proofGenerated,
      ...(result.blockedReason ? { blockedReason: result.blockedReason } : {}),
    }),
  );

  return result.analyzeResponse;
}

// ─── Demo / test scenarios ────────────────────────────────────────────────────

export interface DemoScenario {
  id: string;
  description: string;
  request: AnalyzeRequest;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    id: "empty_prompt",
    description: "Empty prompt edge case — expect riskScore 0, safeForLLM true",
    request: { prompt: "   ", mode: "strict" },
  },
  {
    id: "repeated_secret",
    description: "Same email twice + SSN — repeated token reuse, riskScore ~0.44",
    request: {
      prompt: "Email john@gmail.com then again john@gmail.com, SSN 123-45-6789.",
      mode: "strict",
    },
  },
  {
    id: "bearer_ip_phone",
    description: "Bearer token + IP + phone in relaxed mode",
    request: {
      prompt: "Bearer sk_test_1234567890ABCDEF from 192.168.1.12, call (212) 555-7821.",
      mode: "relaxed",
    },
  },
  {
    id: "malformed_inputs",
    description: "Malformed email ignored, credit card + GitHub API key detected",
    request: {
      prompt: "Use john@@gmail and card 4242 4242 4242 4242 and key ghp_1234567890abcdef",
      mode: "strict",
    },
  },
  {
    id: "high_risk_block",
    description: "Multiple high-risk types — riskScore should exceed BLOCK_IF_RISK_OVER",
    request: {
      prompt:
        "SSN 123-45-6789, card 4242 4242 4242 4242, key sk_live_ABCDEF1234567890, " +
        "Bearer token_XYZ1234567890ABC, email leak@corp.com, phone 415-555-1212",
      mode: "strict",
    },
  },
];

export async function runDemoScenarios(): Promise<
  Array<{ scenario: DemoScenario; response: AnalyzeResponse }>
> {
  const outputs: Array<{ scenario: DemoScenario; response: AnalyzeResponse }> = [];

  for (const scenario of DEMO_SCENARIOS) {
    const response = await mockAnalyze(scenario.request);
    outputs.push({ scenario, response });
  }

  return outputs;
}
