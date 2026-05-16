import { DetectionType, type DetectionResult } from "./types";

export interface Detector {
  detect(text: string, mode: "strict" | "relaxed"): DetectionResult[];
}

interface DetectionRule {
  type: DetectionType;
  regex: RegExp;
  confidence: number;
}

const BASE_RULES: DetectionRule[] = [
  {
    type: DetectionType.BEARER_TOKEN,
    regex: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    confidence: 0.99,
  },
  {
    type: DetectionType.API_KEY,
    regex: /\b(?:sk|pk|rk|xoxb|xoxp|ghp|glpat)_[A-Za-z0-9_-]{12,}\b/g,
    confidence: 0.97,
  },
  {
    type: DetectionType.SSN,
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    confidence: 0.99,
  },
  {
    type: DetectionType.CREDIT_CARD,
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    confidence: 0.94,
  },
  {
    type: DetectionType.EMAIL,
    regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    confidence: 0.98,
  },
  {
    type: DetectionType.PHONE,
    regex: /(?:^|[^\w])((?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]?\d{3}[-.\s]?\d{4})(?=$|[^\w])/g,
    confidence: 0.94,
  },
  {
    type: DetectionType.IP_ADDRESS,
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g,
    confidence: 0.9,
  },
];

const STRICT_ONLY_RULES: DetectionRule[] = [
  {
    type: DetectionType.NAME,
    regex: /\b(?:my name is|i am)\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g,
    confidence: 0.7,
  },
  {
    type: DetectionType.ADDRESS,
    regex: /\b\d{1,6}\s+[A-Za-z0-9.\s]+(?:Street|St|Avenue|Ave|Road|Rd|Lane|Ln|Boulevard|Blvd)\b/gi,
    confidence: 0.76,
  },
];

function isLikelyCreditCard(rawValue: string): boolean {
  const digits = rawValue.replace(/\D/g, "");
  return digits.length >= 13 && digits.length <= 19;
}

function isOverlapping(left: DetectionResult, right: DetectionResult): boolean {
  return left.startIndex < right.endIndex && right.startIndex < left.endIndex;
}

function compareDetections(left: DetectionResult, right: DetectionResult): number {
  if (left.startIndex !== right.startIndex) {
    return left.startIndex - right.startIndex;
  }
  const leftLength = left.endIndex - left.startIndex;
  const rightLength = right.endIndex - right.startIndex;
  return rightLength - leftLength;
}

function resolveOverlaps(detections: DetectionResult[]): DetectionResult[] {
  const sorted = [...detections].sort(compareDetections);
  const accepted: DetectionResult[] = [];

  for (const candidate of sorted) {
    const hasOverlap = accepted.some((entry) => isOverlapping(entry, candidate));
    if (!hasOverlap) {
      accepted.push(candidate);
      continue;
    }

    for (let index = 0; index < accepted.length; index += 1) {
      const current = accepted[index];
      if (!isOverlapping(current, candidate)) {
        continue;
      }
      if (candidate.confidence > current.confidence) {
        accepted[index] = candidate;
      }
      break;
    }
  }

  return accepted.sort(compareDetections);
}

export class RegexDetector implements Detector {
  public detect(text: string, mode: "strict" | "relaxed"): DetectionResult[] {
    if (!text || typeof text !== "string") {
      return [];
    }

    const rules = mode === "strict" ? [...BASE_RULES, ...STRICT_ONLY_RULES] : BASE_RULES;
    const detections: DetectionResult[] = [];
    let idCounter = 0;

    for (const rule of rules) {
      rule.regex.lastIndex = 0;
      let match = rule.regex.exec(text);

      while (match !== null) {
        const value = match[1] ?? match[0];
        const offset = match[1] ? match[0].indexOf(match[1]) : 0;
        const startIndex = match.index + offset;
        const endIndex = startIndex + value.length;
        if (rule.type === DetectionType.CREDIT_CARD && !isLikelyCreditCard(value)) {
          match = rule.regex.exec(text);
          continue;
        }

        detections.push({
          id: `det_${idCounter}`,
          type: rule.type,
          match: value,
          replacement: "",
          startIndex,
          endIndex,
          confidence: rule.confidence,
        });

        idCounter += 1;
        match = rule.regex.exec(text);
      }
    }

    return resolveOverlaps(detections);
  }
}

export function detectSensitiveData(text: string, mode: "strict" | "relaxed"): DetectionResult[] {
  const detector = new RegexDetector();
  return detector.detect(text, mode);
}
