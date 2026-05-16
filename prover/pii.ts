// ─── PII Entity Types ─────────────────────────────────────────────────────────

export type PIICategory =
  | 'SSN'
  | 'CREDIT_CARD'
  | 'EMAIL'
  | 'PHONE'
  | 'API_KEY'
  | 'NAME'
  | 'ADDRESS';

export interface PIIMatch {
  id: string;           // unique per detection, e.g. "pii_0"
  category: PIICategory;
  original: string;     // the actual sensitive text
  token: string;        // replacement token, e.g. "[SSN_0]"
  startIndex: number;
  endIndex: number;
}
