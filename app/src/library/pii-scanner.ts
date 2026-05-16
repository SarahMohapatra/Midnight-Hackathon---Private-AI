import { detectSensitiveData } from "../../../prover/pii-detection";
import type { DetectionResult } from "../../../prover/types";

export function scanPromptForSensitiveData(
  prompt: string,
  mode: "strict" | "relaxed" = "strict",
): DetectionResult[] {
  return detectSensitiveData(prompt, mode);
}
