// ─── prover/api.ts ───────────────────────────────────────────────────────────
// Legacy verifier + contract-submission surface kept for backward import
// compatibility. New code should import from prover/midnight.ts and
// prover/pipeline.ts directly.

import { getAuditTrail, recordAuditOnMidnight } from "./midnight";
import type { ContractResult, ProveInput, ProveOutput } from "./types";
import { PRIVACY_STATUS_CODE } from "./types";

export interface VerifierAdapter {
  verify(input: ProveInput): Promise<ProveOutput>;
}

// Pure local verifier used only by the legacy code path. The product story is
// now "audit attestation on Midnight"; ZK verification of the regex transform
// is intentionally out of scope.
export class LocalVerifierAdapter implements VerifierAdapter {
  public async verify(input: ProveInput): Promise<ProveOutput> {
    return {
      requestId: input.requestId,
      proofId: `local_${input.requestId}`,
      proofGenerated: false,
      verifierAccepted: true,
      timestamp: new Date().toISOString(),
    };
  }
}

const defaultVerifier: VerifierAdapter = new LocalVerifierAdapter();

export async function callVerifier(input: ProveInput): Promise<ProveOutput> {
  return defaultVerifier.verify(input);
}

// submitToContract is preserved purely so older imports keep compiling. It
// now routes straight into the Midnight adapter with the lean payload the
// new contract expects.
export interface ContractSubmission {
  requestId: string;
  proofId: string;
  maskedTextHash: string;
  riskScore: number;
  timestamp: string;
}

export async function submitToContract(
  submission: ContractSubmission,
): Promise<ContractResult> {
  const result = await recordAuditOnMidnight({
    commitmentHash: submission.maskedTextHash,
    sessionIdHash: submission.requestId,
    status: "masked",
    statusCode: PRIVACY_STATUS_CODE.masked,
    policyVersion: "legacy",
    timestamp: submission.timestamp,
  });
  return {
    success: result.mode === "live",
    txHash: result.txHash ?? null,
  };
}

export { getAuditTrail };

export type {
  AnalyzeRequest,
  AnalyzeResponse,
  AuditEntry,
  AuditRecord,
  ContractResult,
  DetectionResult,
  PipelineResult,
} from "./types";
