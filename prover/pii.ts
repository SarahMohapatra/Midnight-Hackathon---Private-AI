import type { DetectionResult } from "./types";

export interface MaskingResult {
  maskedText: string;
  detections: DetectionResult[];
}

export interface Masker {
  mask(originalText: string, detections: DetectionResult[]): MaskingResult;
}

export class TokenMasker implements Masker {
  public mask(originalText: string, detections: DetectionResult[]): MaskingResult {
    if (!originalText || detections.length === 0) {
      return {
        maskedText: originalText,
        detections: [],
      };
    }

    const sorted = [...detections].sort((left, right) => left.startIndex - right.startIndex);
    const typeCounters = new Map<string, number>();
    const repeatedSecretTokenMap = new Map<string, string>();
    const maskedDetections: DetectionResult[] = [];
    let cursor = 0;
    let maskedText = "";

    for (const detection of sorted) {
      if (detection.startIndex < cursor) {
        continue;
      }

      const repeatedSecretKey = `${detection.type}:${detection.match}`;
      let replacement = repeatedSecretTokenMap.get(repeatedSecretKey);

      if (!replacement) {
        const currentCounter = typeCounters.get(detection.type) ?? 0;
        const nextCounter = currentCounter + 1;
        typeCounters.set(detection.type, nextCounter);
        replacement = `[${detection.type}_${nextCounter}]`;
        repeatedSecretTokenMap.set(repeatedSecretKey, replacement);
      }

      maskedText += originalText.slice(cursor, detection.startIndex);
      maskedText += replacement;
      cursor = detection.endIndex;
      maskedDetections.push({
        ...detection,
        replacement,
      });
    }

    maskedText += originalText.slice(cursor);

    return {
      maskedText,
      detections: maskedDetections,
    };
  }
}

export function maskDetections(originalText: string, detections: DetectionResult[]): MaskingResult {
  const masker = new TokenMasker();
  return masker.mask(originalText, detections);
}
