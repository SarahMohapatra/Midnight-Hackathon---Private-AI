import type { DetectionResult } from "./types";

export interface ProverOutput {
  proofId: string;
  verified: boolean;
}

export interface ProverAdapter {
  generateProof(maskedText: string, detections: DetectionResult[]): Promise<ProverOutput>;
}

export class MockProverAdapter implements ProverAdapter {
  public async generateProof(maskedText: string, detections: DetectionResult[]): Promise<ProverOutput> {
    // Midnight integration point:
    // replace this deterministic placeholder with a Midnight-powered circuit call.
    // This is where witness generation and proving inputs should be assembled.
    const fingerprint = `${maskedText.length}-${detections.length}-${Date.now()}`;
    return {
      proofId: `proof_${fingerprint}`,
      verified: false,
    };
  }
}
