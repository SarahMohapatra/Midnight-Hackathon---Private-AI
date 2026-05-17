import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { previewAnalyze } from "../library/mockAnalyze";
import ScenarioBar from "./ScenarioBar";
import type { DemoScenario } from "../library/mockAnalyze";
import {
  DetectionType,
  type AnalyzeResponse,
  type DetectionResult,
} from "../../../prover/types";

export interface ComposerProps {
  value: string;
  onChange: (next: string) => void;
  onSend: (prompt: string) => void;
  onScenario: (scenario: DemoScenario) => void;
  sending: boolean;
  livePreview: AnalyzeResponse | null;
  onLivePreviewChange: (next: AnalyzeResponse | null) => void;
}

const DEBOUNCE_MS = 240;

interface Segment {
  kind: "text" | "pii";
  text: string;
  category?: DetectionType;
  token?: string;
}

function buildSegments(text: string, detections: DetectionResult[]): Segment[] {
  if (!text) return [];
  if (detections.length === 0) return [{ kind: "text", text }];
  const sorted = [...detections].sort((a, b) => a.startIndex - b.startIndex);
  const out: Segment[] = [];
  let cursor = 0;
  for (const det of sorted) {
    if (det.startIndex < cursor) continue;
    if (det.startIndex > cursor) {
      out.push({ kind: "text", text: text.slice(cursor, det.startIndex) });
    }
    out.push({
      kind: "pii",
      text: text.slice(det.startIndex, det.endIndex),
      category: det.type,
      token: det.replacement,
    });
    cursor = det.endIndex;
  }
  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
  return out;
}

export default function Composer({
  value,
  onChange,
  onSend,
  onScenario,
  sending,
  livePreview,
  onLivePreviewChange,
}: ComposerProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);
  const [scanning, setScanning] = useState(false);

  // Debounced live scan for PII highlighting only (skipMidnight = true).
  useEffect(() => {
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    if (!value.trim()) {
      onLivePreviewChange(null);
      return;
    }
    const seq = ++requestSeqRef.current;
    debounceRef.current = window.setTimeout(async () => {
      setScanning(true);
      try {
        const preview = await previewAnalyze({ prompt: value, mode: "strict" });
        if (seq !== requestSeqRef.current) return;
        onLivePreviewChange(preview);
      } finally {
        if (seq === requestSeqRef.current) setScanning(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [value, onLivePreviewChange]);

  const segments = useMemo(
    () => buildSegments(value, livePreview?.detections ?? []),
    [value, livePreview],
  );

  const syncScroll = useCallback(() => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const canSend = value.trim().length > 0 && !sending;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    onSend(value);
  }, [canSend, onSend, value]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const detectionCount = livePreview?.detections.length ?? 0;
  const risk = livePreview?.riskScore ?? 0;

  return (
    <div className="composer">
      <ScenarioBar onPick={onScenario} disabled={sending} />

      <div className="composer-shell">
        <div className="composer-stack">
          <div ref={overlayRef} className="composer-overlay" aria-hidden="true">
            {segments.length === 0 ? (
              <span className="composer-placeholder">
                Ask anything — sensitive values are masked before they leave this device.
              </span>
            ) : (
              segments.map((seg, idx) =>
                seg.kind === "text" ? (
                  <span key={idx}>{seg.text}</span>
                ) : (
                  <span
                    key={idx}
                    className={`pii-chip pii-${seg.category}`}
                    title={`${seg.category} → ${seg.token}`}
                  >
                    {seg.text}
                  </span>
                ),
              )
            )}
            {value.endsWith("\n") ? "\u00A0" : ""}
          </div>
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            onKeyDown={handleKeyDown}
            placeholder=" "
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={3}
          />
        </div>

        <div className="composer-bottom">
          <div className="composer-meta">
            <span className={`composer-scan ${scanning ? "is-scanning" : ""}`}>
              {scanning ? "scanning…" : detectionCount > 0 ? `${detectionCount} pii · risk ${risk.toFixed(2)}` : "no pii detected"}
            </span>
            <span className="composer-hint">⌘ + ↵ to send</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSend}
            disabled={!canSend}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
