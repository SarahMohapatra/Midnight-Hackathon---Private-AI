// ─── prover/index.ts ─────────────────────────────────────────────────────────
// Facade over the canonical privacy pipeline. The pre-existing public surface
// (createAnalyzeService, analyzePrompt, detectSensitiveData re-export) is
// preserved so any consumer can keep using it; all behaviour now goes through
// runPrivacyPipeline in prover/pipeline.ts.

import { InMemoryAuditStore, buildAuditRecord, type AuditStore } from "./audit";
import { detectSensitiveData } from "./pii-detection";
import { runPrivacyPipeline, PrivacyPipelineError } from "./pipeline";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  AuditRecord,
} from "./types";

export type { PrivacyPipelineErrorCode } from "./pipeline";
export {
  BLOCK_IF_RISK_OVER,
  POLICY_VERSION,
  computeRiskScore,
  runPrivacyPipeline,
} from "./pipeline";
export { PrivacyPipelineError };

// ─── Legacy entry preserved for backward compatibility ───────────────────────

export interface AnalyzeService {
  analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>;
  getAuditRecords(): AuditRecord[];
}

export interface AnalyzeServiceDependencies {
  auditStore?: AuditStore;
}

export function createAnalyzeService(
  dependencies: AnalyzeServiceDependencies = {},
): AnalyzeService {
  const auditStore = dependencies.auditStore ?? new InMemoryAuditStore();

  return {
    async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
      const pipeline = await runPrivacyPipeline(request);
      const auditRecord = buildAuditRecord(
        { ...request, prompt: pipeline.response.originalText },
        pipeline.response,
        {
          proofId: pipeline.midnight.txHash ?? pipeline.midnight.recordId,
          verified: pipeline.midnight.mode === "live",
        },
      );
      auditStore.add(auditRecord);
      return pipeline.response;
    },

    getAuditRecords(): AuditRecord[] {
      return auditStore.list();
    },
  };
}

export function analyzePrompt(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  return runPrivacyPipeline(request).then((result) => result.response);
}

export { detectSensitiveData };
