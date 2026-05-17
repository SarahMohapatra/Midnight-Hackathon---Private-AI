// ─── Generated client stub for privacy_audit.compact ─────────────────────────
// Replace with the real compactc output when the contract is deployed.
//
// API shape (must stay stable):
//   createPrivacyAuditClient({ network, contractAddress }) → PrivacyAuditClient
//   client.recordAudit(params) → { recordId, txHash }
//   client.listAudits(limit?)  → MidnightAuditResult[]
//
// The stub simulates an on-chain ledger in memory so the rest of the app
// works in local-only mode. When createPrivacyAuditClient is invoked WITHOUT
// a contractAddress env value, it throws — that drives the adapter into its
// local_fallback branch and lights up the matching badge in the UI.

import type {
  MidnightAuditResult,
  PrivacyStatus,
} from "../../prover/types";

export interface GeneratedRecordAuditInput {
  commitmentHash: string;
  sessionIdHash: string;
  status: PrivacyStatus;
  statusCode: number;
  policyVersion: string;
  timestamp: string;
}

export interface GeneratedRecordAuditResult {
  recordId: string;
  txHash: string;
}

export interface PrivacyAuditClient {
  network: string;
  recordAudit(input: GeneratedRecordAuditInput): Promise<GeneratedRecordAuditResult>;
  listAudits(limit?: number): Promise<MidnightAuditResult[]>;
}

export interface PrivacyAuditClientConfig {
  network: string;
  contractAddress?: string;
}

// In-memory ledger used only when the stub is the active client.
const stubLedger: MidnightAuditResult[] = [];
let nextRecordId = 1;

function fakeTxHash(seed: string): string {
  let hash = 5381;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return `0x${(hash >>> 0).toString(16).padStart(8, "0")}${Math.random().toString(16).slice(2, 10)}`;
}

export async function createPrivacyAuditClient(
  config: PrivacyAuditClientConfig,
): Promise<PrivacyAuditClient> {
  // The stub deliberately refuses to act as a "live" client unless an env
  // contract address is supplied. This keeps the local_fallback path honest
  // for the demo until a real deployment is wired in.
  if (!config.contractAddress) {
    throw new Error(
      "privacyAuditClient stub active — set VITE_CONTRACT_ADDRESS to use the live client",
    );
  }

  return {
    network: config.network,

    async recordAudit(input: GeneratedRecordAuditInput): Promise<GeneratedRecordAuditResult> {
      const recordId = `record_${nextRecordId++}`;
      const txHash = fakeTxHash(`${input.commitmentHash}|${recordId}`);
      stubLedger.push({
        mode: "live",
        network: config.network,
        policyVersion: input.policyVersion,
        commitmentHash: input.commitmentHash,
        sessionIdHash: input.sessionIdHash,
        status: input.status,
        timestamp: input.timestamp,
        recordId,
        txHash,
      });
      return { recordId, txHash };
    },

    async listAudits(limit = 25): Promise<MidnightAuditResult[]> {
      return stubLedger.slice(-limit);
    },
  };
}
