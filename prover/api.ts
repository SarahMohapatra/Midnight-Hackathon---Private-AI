// ─── Contract Interaction Layer ───────────────────────────────────────────────
// Typed async interfaces for verifier calls and on-chain contract submissions.
// All implementations here are mocked for hackathon demo.
// Each stub is annotated with the future Midnight integration point.

import type { ProveInput, ProveOutput } from "./types";

// ─── Verifier layer ───────────────────────────────────────────────────────────
// The VerifierAdapter abstracts the ZK proof verification step.
// In production this becomes a Midnight circuit call that verifies the witness
// without learning the original prompt.

export interface VerifierAdapter {
  verify(input: ProveInput): Promise<ProveOutput>;
}

export class MockVerifierAdapter implements VerifierAdapter {
  public async verify(input: ProveInput): Promise<ProveOutput> {
    // Midnight verifier integration point:
    // Replace with a Midnight Compact circuit that:
    //   1. Accepts maskedTextHash + detectionTypes as public inputs.
    //   2. Verifies a ZK proof that PII was correctly detected & masked.
    //   3. Returns an on-chain attestation without exposing the original text.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });

    return {
      requestId: input.requestId,
      proofId: `mock_proof_${input.requestId}_${Date.now()}`,
      proofGenerated: true,
      verifierAccepted: true,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Contract submission layer ────────────────────────────────────────────────
// ContractSubmission bundles the proof reference and audit commitment for
// on-chain storage. Raw text is never part of this payload.

export interface ContractSubmission {
  requestId: string;
  proofId: string;
  maskedTextHash: string;
  riskScore: number;
  timestamp: string;
}

export interface ContractSubmissionResult {
  accepted: boolean;
  transactionId?: string;
  rejectionReason?: string;
}

export async function submitToContract(
  submission: ContractSubmission,
): Promise<ContractSubmissionResult> {
  // Midnight smart contract integration point:
  // Replace with a Midnight Compact contract invocation that:
  //   1. Verifies the proofId corresponds to an accepted circuit output.
  //   2. Stores maskedTextHash + riskScore as an on-chain audit commitment.
  // Zero-knowledge attestation: the contract enforces privacy policy without
  // ever seeing the original prompt — only the proof and its public outputs.
  await new Promise<void>((resolve) => { setTimeout(resolve, 30); });

  return {
    accepted: true,
    transactionId: `tx_${submission.requestId}_${Date.now()}`,
  };
}

// ─── Canonical pipeline verifier call ────────────────────────────────────────
// Single entry point used by the proving pipeline in app/src/library/prover.ts.
// Swap `defaultVerifier` for a real VerifierAdapter when Midnight is ready.

const defaultVerifier: VerifierAdapter = new MockVerifierAdapter();

export async function callVerifier(input: ProveInput): Promise<ProveOutput> {
  return defaultVerifier.verify(input);
}

// ─── Re-exports for consumers that import from this module ───────────────────
export type {
  AnalyzeRequest,
  AnalyzeResponse,
  AuditEntry,
  AuditRecord,
  DetectionResult,
} from "./types";
