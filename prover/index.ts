import { buildAuditRecord, InMemoryAuditStore, type AuditStore } from "./audit";
import { MockProverAdapter, type ProverAdapter } from "./mock";
import { detectSensitiveData, RegexDetector, type Detector } from "./pii-detection";
import { maskDetections } from "./pii";
import { DetectionType, type AnalyzeRequest, type AnalyzeResponse, type DetectionResult, type AuditRecord } from "./types";

export interface AnalyzeService {
  analyze(request: AnalyzeRequest): Promise<AnalyzeResponse>;
  getAuditRecords(): AuditRecord[];
}

function detectionRiskWeight(type: DetectionType): number {
  switch (type) {
    case DetectionType.SSN:
      return 35;
    case DetectionType.CREDIT_CARD:
      return 30;
    case DetectionType.API_KEY:
      return 30;
    case DetectionType.EMAIL:
      return 20;
    case DetectionType.PHONE:
      return 18;
    case DetectionType.ADDRESS:
      return 12;
    case DetectionType.NAME:
      return 6;
    default:
      return 10;
  }
}

function computeRiskScore(detections: DetectionResult[]): number {
  const total = detections.reduce((sum, item) => sum + detectionRiskWeight(item.type), 0);
  return Math.min(100, total);
}

function evaluateSafetyForLLM(riskScore: number, mode: "strict" | "relaxed"): boolean {
  const threshold = mode === "strict" ? 20 : 35;
  return riskScore <= threshold;
}

export interface AnalyzeServiceDependencies {
  detector?: Detector;
  prover?: ProverAdapter;
  auditStore?: AuditStore;
}

export function createAnalyzeService(dependencies: AnalyzeServiceDependencies = {}): AnalyzeService {
  const detector = dependencies.detector ?? new RegexDetector();
  const prover = dependencies.prover ?? new MockProverAdapter();
  const auditStore = dependencies.auditStore ?? new InMemoryAuditStore();

  return {
    async analyze(request: AnalyzeRequest): Promise<AnalyzeResponse> {
      const mode = request.mode ?? "strict";
      const detections = detector.detect(request.prompt, mode);
      const masking = maskDetections(request.prompt, detections);
      const timestamp = new Date().toISOString();
      const riskScore = computeRiskScore(masking.detections);
      const safeForLLM = evaluateSafetyForLLM(riskScore, mode);

      // ZK proof generation integration point:
      // swap the mock prover adapter with the real proving implementation.
      const proof = await prover.generateProof(masking.maskedText, masking.detections);

      const response: AnalyzeResponse = {
        originalText: request.prompt,
        maskedText: masking.maskedText,
        detections: masking.detections,
        riskScore,
        safeForLLM,
        timestamp,
      };

      const auditRecord = buildAuditRecord(request, response, proof);
      auditStore.add(auditRecord);

      return response;
    },

    getAuditRecords(): AuditRecord[] {
      return auditStore.list();
    },
  };
}

export function analyzePrompt(request: AnalyzeRequest): Promise<AnalyzeResponse> {
  const service = createAnalyzeService();
  return service.analyze(request);
}

export { detectSensitiveData };
