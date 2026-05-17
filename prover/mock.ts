// Legacy export kept only so old import paths keep compiling.
// New code should consume runPrivacyPipeline from prover/pipeline.ts.

import type { DetectionResult } from "./types";

export interface ProverOutput {
  proofId: string;
  verified: boolean;
}

export interface ProverAdapter {
  generateProof(
    maskedText: string,
    detections: DetectionResult[],
  ): Promise<ProverOutput>;
}

export class LocalProverAdapter implements ProverAdapter {
  public async generateProof(
    maskedText: string,
    detections: DetectionResult[],
  ): Promise<ProverOutput> {
    return {
      proofId: `local_${maskedText.length}_${detections.length}_${Date.now()}`,
      verified: false,
    };
  }
}
