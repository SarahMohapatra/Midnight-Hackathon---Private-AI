// ─── Shared API Contract ──────────────────────────────────────────────────────
// Agreed-upon request/response shapes between frontend (Person B) and
// backend (Person A). Neither person changes this without telling the other.

import type { PIIMatch } from './pii';

// POST /api/analyze
export interface AnalyzeRequest {
  prompt: string;
}

export interface AnalyzeResponse {
  maskedPrompt: string;     // prompt with PII replaced by tokens
  detectedPII: PIIMatch[];  // all PII found, in order of appearance
  proofGenerated: boolean;  // whether a ZK proof was produced
  sessionId: string;        // used for audit log correlation
}

// POST /api/chat
export interface ChatRequest {
  maskedPrompt: string;
  sessionId: string;
}

export interface ChatResponse {
  response: string;
  sessionId: string;
}

// GET /api/metrics
export interface MetricsResponse {
  totalRequests: number;
  totalPIIDetected: number;
  categoryCounts: Partial<Record<string, number>>;
  recentSessions: SessionSummary[];
}

export interface SessionSummary {
  sessionId: string;
  timestamp: string;   // ISO 8601
  piiCount: number;
  categories: string[];
}
