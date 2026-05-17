// ─── Midnight contract adapter ────────────────────────────────────────────────
// Single integration point for the Midnight Compact `privacy_audit` contract.
//
// Live path:
//   1. Dynamically import the generated TS client from contracts/generated.
//   2. Resolve a wallet-driven contract instance via env config.
//   3. Call `recordAudit(commitmentHash, status, policyVersion, sessionIdHash, timestamp)`.
//   4. Return the transaction hash + record id in a typed MidnightAuditResult.
//
// Local fallback:
//   - Triggered automatically when the generated client is missing, the env
//     is not configured, or the live call throws.
//   - Persists a bounded ring buffer in-memory (and in localStorage if
//     available) so the audit panel can still show a trail during the demo.
//   - Returned MidnightAuditResult is shape-identical, with mode = "local_fallback".

import type { MidnightAuditResult, PrivacyStatus } from "./types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface RecordAuditParams {
  commitmentHash: string;
  sessionIdHash: string;
  status: PrivacyStatus;
  statusCode: number;
  policyVersion: string;
  timestamp: string;
}

// ─── Generated client contract (mirrors contracts/generated client.ts) ────────
// We type the dynamic import so the live path is fully typed without forcing
// the package to be resolvable at build time. The shape matches the typed
// stub committed under contracts/generated/privacyAuditClient.ts.

interface PrivacyAuditClient {
  network: string;
  recordAudit(input: RecordAuditParams): Promise<{
    recordId: string;
    txHash: string;
  }>;
  listAudits(limit?: number): Promise<MidnightAuditResult[]>;
}

interface PrivacyAuditClientModule {
  createPrivacyAuditClient(config: {
    network: string;
    contractAddress?: string;
  }): Promise<PrivacyAuditClient>;
}


// ─── Local fallback store ─────────────────────────────────────────────────────

const LOCAL_STORAGE_KEY = "privateprompt.audit.fallback.v1";
const MAX_LOCAL_AUDITS = 50;

const memoryAudits: MidnightAuditResult[] = [];

function readLocalAudits(): MidnightAuditResult[] {
  if (typeof window === "undefined" || !window.localStorage) {
    return [...memoryAudits];
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [...memoryAudits];
    const parsed = JSON.parse(raw) as MidnightAuditResult[];
    return Array.isArray(parsed) ? parsed : [...memoryAudits];
  } catch {
    return [...memoryAudits];
  }
}

function writeLocalAudits(audits: MidnightAuditResult[]): void {
  const bounded = audits.slice(-MAX_LOCAL_AUDITS);
  memoryAudits.splice(0, memoryAudits.length, ...bounded);
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(bounded));
  } catch {
    // Storage quota or privacy mode — memory copy still works.
  }
}

function appendLocalAudit(audit: MidnightAuditResult): void {
  const existing = readLocalAudits();
  writeLocalAudits([...existing, audit]);
}

// ─── Env helpers ──────────────────────────────────────────────────────────────

interface MidnightEnv {
  network: string;
  contractAddress?: string;
  enabled: boolean;
}

function readEnv(): MidnightEnv {
  const env =
    typeof import.meta !== "undefined"
      ? (import.meta as ImportMeta & {
          env?: Record<string, string | undefined>;
        }).env ?? {}
      : {};
  const network = env.VITE_MIDNIGHT_NETWORK ?? "testnet";
  const contractAddress = env.VITE_CONTRACT_ADDRESS;
  const enabled = (env.VITE_MIDNIGHT_ENABLED ?? "true").toLowerCase() !== "false";
  return { network, contractAddress, enabled };
}

// ─── Client resolution ────────────────────────────────────────────────────────

let cachedClient: PrivacyAuditClient | null = null;
let cachedClientLoad: Promise<PrivacyAuditClient> | null = null;

async function loadClient(): Promise<PrivacyAuditClient> {
  if (cachedClient) return cachedClient;
  if (cachedClientLoad) return cachedClientLoad;

  cachedClientLoad = (async () => {
    const env = readEnv();
    if (!env.enabled) {
      throw new Error("Midnight integration disabled by env");
    }
    // Dynamic import lets Vite code-split the generated client and lets the
    // adapter swallow load failures into the local_fallback branch.
    const mod = (await import("../contracts/generated/privacyAuditClient")) as PrivacyAuditClientModule;
    if (!mod.createPrivacyAuditClient) {
      throw new Error("createPrivacyAuditClient export missing");
    }
    const client = await mod.createPrivacyAuditClient({
      network: env.network,
      contractAddress: env.contractAddress,
    });
    cachedClient = client;
    return client;
  })();

  try {
    return await cachedClientLoad;
  } catch (error) {
    cachedClientLoad = null;
    throw error;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function recordAuditOnMidnight(
  params: RecordAuditParams,
): Promise<MidnightAuditResult> {
  const env = readEnv();
  const base: Omit<MidnightAuditResult, "mode" | "txHash" | "recordId" | "error"> = {
    network: env.network,
    policyVersion: params.policyVersion,
    commitmentHash: params.commitmentHash,
    sessionIdHash: params.sessionIdHash,
    status: params.status,
    timestamp: params.timestamp,
  };

  try {
    const client = await loadClient();
    const tx = await client.recordAudit(params);
    const live: MidnightAuditResult = {
      ...base,
      mode: "live",
      recordId: tx.recordId,
      txHash: tx.txHash,
    };
    appendLocalAudit(live);
    return live;
  } catch (error) {
    const fallback: MidnightAuditResult = {
      ...base,
      mode: "local_fallback",
      error: error instanceof Error ? error.message : "Midnight client unavailable",
    };
    appendLocalAudit(fallback);
    return fallback;
  }
}

export async function getAuditTrail(limit = 25): Promise<MidnightAuditResult[]> {
  try {
    const client = await loadClient();
    const remote = await client.listAudits(limit);
    return remote;
  } catch {
    const local = readLocalAudits();
    return local.slice(-limit);
  }
}

// ─── Status probe ─────────────────────────────────────────────────────────────
// The UI calls this on mount to decide which badge to show in the top bar.

export type MidnightConnectivity = "live" | "local_fallback" | "checking";

export interface MidnightStatus {
  connectivity: MidnightConnectivity;
  network: string;
  contractAddress?: string;
  error?: string;
}

export async function probeMidnightStatus(): Promise<MidnightStatus> {
  const env = readEnv();
  try {
    await loadClient();
    return {
      connectivity: "live",
      network: env.network,
      contractAddress: env.contractAddress,
    };
  } catch (error) {
    return {
      connectivity: "local_fallback",
      network: env.network,
      contractAddress: env.contractAddress,
      error: error instanceof Error ? error.message : "client load failed",
    };
  }
}
