// Facade over the canonical pipeline. The previous duplicate implementation
// of runProvingPipeline lived here; that logic now lives in
// prover/pipeline.ts so the UI and the legacy createAnalyzeService share a
// single source of truth.

export {
  runPrivacyPipeline,
  BLOCK_IF_RISK_OVER,
  POLICY_VERSION,
  computeRiskScore,
  PrivacyPipelineError,
} from "../../../prover/pipeline";

export type {
  PrivacyPipelineErrorCode,
  PipelineOptions,
} from "../../../prover/pipeline";

export type {
  PipelineResult,
  AnalyzeRequest,
  AnalyzeResponse,
  AuditEntry,
  MidnightAuditResult,
  PrivacyStatus,
  AiDispatchDecision,
} from "../../../prover/types";
