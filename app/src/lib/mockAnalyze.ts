// ─── Mock /api/analyze ────────────────────────────────────────────────────────
// Person B: import this instead of the real fetch during Hours 4-16.
// Swap for the real call at the Hour 16 integration milestone.

import type { AnalyzeRequest, AnalyzeResponse } from '@/types';

let sessionCounter = 0;

export async function mockAnalyze(req: AnalyzeRequest): Promise<AnalyzeResponse> {
  // Simulate network delay
  await new Promise((r) => setTimeout(r, 300));

  const detectedPII = [
    {
      id: 'pii_0',
      category: 'EMAIL' as const,
      original: 'john@example.com',
      token: '[EMAIL_0]',
      startIndex: req.prompt.indexOf('john@example.com'),
      endIndex: req.prompt.indexOf('john@example.com') + 16,
    },
    {
      id: 'pii_1',
      category: 'SSN' as const,
      original: '123-45-6789',
      token: '[SSN_0]',
      startIndex: req.prompt.indexOf('123-45-6789'),
      endIndex: req.prompt.indexOf('123-45-6789') + 11,
    },
  ].filter((p) => p.startIndex !== -1);

  return {
    maskedPrompt: req.prompt
      .replace('john@example.com', '[EMAIL_0]')
      .replace('123-45-6789', '[SSN_0]'),
    detectedPII,
    proofGenerated: false,
    sessionId: `session_${++sessionCounter}`,
  };
}
