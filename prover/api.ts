// ─── Contract Interaction Layer ───────────────────────────────────────────────
// Verifier adapter remains mocked for the hackathon demo. Contract submission
// and audit-log retrieval attempt the Midnight SDK first via a dynamic import
// and fall back to an in-memory audit log so the app keeps running even when
// the SDK package is not installed or the network is unreachable.
//
// The return shape of every public contract function is identical on the
// real-network path and the fallback path so the frontend cannot distinguish
// the two from the return value alone.

import type {
  AuditEntry,
  ContractResult,
  DetectionResult,
  ProveInput,
  ProveOutput,
} from "./types";

// ─── Verifier layer ───────────────────────────────────────────────────────────
// The VerifierAdapter abstracts the ZK proof verification step. In production
// this becomes a Midnight circuit call that verifies the witness without
// learning the original prompt.

export interface VerifierAdapter {
  verify(input: ProveInput): Promise<ProveOutput>;
}

export class MockVerifierAdapter implements VerifierAdapter {
  public async verify(input: ProveInput): Promise<ProveOutput> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50);
    });

    return {
      requestId: input.requestId,
      proofId: `mock_proof_${input.requestId}_${Date.now()}`,
      proofGenerated: true,
      verifierAccepted: true,
      timestamp: new Date().toISOString(),
    };
  }
}

// ─── Existing contract submission types (kept for backward compatibility) ────

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

// ─── Midnight SDK shapes ─────────────────────────────────────────────────────
// Minimal structural typing for the dynamically-imported Midnight modules.
// Defined here so we can stay strictly typed without depending on the package
// being installed at compile time.

interface MidnightContract {
  submitProof(input: { proofHash: string; sessionId: string }): Promise<{ hash?: string }>;
  getAuditLog(limit?: number): Promise<AuditEntry[]>;
}

interface MidnightProviderConstructor {
  new (network?: string): {
    getContract(address?: string): Promise<MidnightContract>;
  };
}

interface MidnightNetworkModule {
  MidnightProvider?: MidnightProviderConstructor;
}

const MIDNIGHT_NETWORK_MODULE = "@midnight-ntwrk/midnight-js-network-id";

// ─── Local fallback audit log ────────────────────────────────────────────────
// Persists for the lifetime of the app session. Used whenever the Midnight
// SDK is unavailable or any contract call fails. Module-level so every call
// site shares the same in-memory log.

const localAuditLog: AuditEntry[] = [];

function getViteEnv(): Record<string, string | undefined> {
  return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
}

function buildContractAuditEntry(
  proofHash: string,
  sessionId: string,
  detections: DetectionResult[],
  status: NonNullable<AuditEntry["status"]>,
): AuditEntry {
  return {
    requestId: sessionId,
    sessionId,
    timestamp: new Date().toISOString(),
    riskScore: 0,
    detectionCount: detections.length,
    proofGenerated: status === "verified",
    piiDetected: detections.length,
    categories: detections.map((detection) => detection.type),
    proofHash,
    status,
  };
}

async function getMidnightContract(): Promise<MidnightContract> {
  // Indirect the module name through a const so static analysis does not try
  // to resolve the Midnight package at compile time. The package is loaded
  // lazily and only needs to exist at runtime in environments that have it.
  const moduleName = MIDNIGHT_NETWORK_MODULE;
  const networkModule = (await import(/* @vite-ignore */ moduleName)) as MidnightNetworkModule;
  const Provider = networkModule.MidnightProvider;
  if (!Provider) {
    throw new Error("MidnightProvider export not found in Midnight SDK");
  }

  const env = getViteEnv();
  const provider = new Provider(env.VITE_MIDNIGHT_NETWORK ?? "testnet");
  return provider.getContract(env.VITE_CONTRACT_ADDRESS);
}

// ─── Public Midnight contract API ─────────────────────────────────────────────

export async function submitProofToContract(
  proofHash: string,
  sessionId: string,
  detections: DetectionResult[],
): Promise<ContractResult> {
  // Build complete audit entries up front so the local-fallback path can
  // record an entry even when the network call rejects.
  const verifiedEntry = buildContractAuditEntry(proofHash, sessionId, detections, "verified");
  const pendingEntry = buildContractAuditEntry(proofHash, sessionId, detections, "pending");

  try {
    const contract = await getMidnightContract();
    const tx = await contract.submitProof({ proofHash, sessionId });
    localAuditLog.push(verifiedEntry);
    return { success: true, txHash: tx.hash ?? null };
  } catch {
    console.warn("[Midnight] Contract unavailable, storing audit entry locally");
    localAuditLog.push(pendingEntry);
    return { success: false, txHash: null };
  }
}

export async function getAuditLog(limit = 50): Promise<AuditEntry[]> {
  try {
    const contract = await getMidnightContract();
    return await contract.getAuditLog(limit);
  } catch {
    console.warn("[Midnight] Contract unavailable, returning local audit log");
    return localAuditLog.slice(-limit);
  }
}

// ─── Legacy contract submission helper ───────────────────────────────────────
// Kept for backward compatibility with existing callers in app/src/library.
// Delegates to submitProofToContract under the hood so the local fallback
// behaviour applies to legacy paths too.

export async function submitToContract(
  submission: ContractSubmission,
): Promise<ContractSubmissionResult> {
  const result = await submitProofToContract(submission.proofId, submission.requestId, []);
  return result.success
    ? { accepted: true, transactionId: result.txHash ?? undefined }
    : { accepted: false, rejectionReason: "Stored in local audit log" };
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
  ContractResult,
  DetectionResult,
} from "./types";
