// ─── Audit Log Types ──────────────────────────────────────────────────────────

export interface AuditEntry {
  sessionId: string;
  timestamp: string;
  piiDetected: number;
  categories: string[];
  proofHash?: string;
  status: 'pending' | 'verified' | 'failed';
}
