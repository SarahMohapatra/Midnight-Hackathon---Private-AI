import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { mockAnalyze } from "../library/mockAnalyze";
import { sendToOpenAI, type ChatResponse } from "../library/openai";
import {
  DetectionType,
  type AnalyzeResponse,
  type DetectionResult,
} from "../../../prover/types";

export interface PromptResult {
  analysis: AnalyzeResponse;
  chat: ChatResponse;
}

export interface PromptInputProps {
  value: string;
  onChange: (next: string) => void;
  onAnalysis: (analysis: AnalyzeResponse) => void;
  onResult: (result: PromptResult) => void;
  onSending?: (sending: boolean) => void;
}

const DEBOUNCE_MS = 300;

function generateSessionId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `sess_${Date.now()}_${random}`;
}

interface Segment {
  kind: "text" | "pii";
  text: string;
  category?: DetectionType;
  token?: string;
}

function buildSegments(text: string, detections: DetectionResult[]): Segment[] {
  if (!text) return [];
  if (detections.length === 0) {
    return [{ kind: "text", text }];
  }

  const sorted = [...detections].sort((a, b) => a.startIndex - b.startIndex);
  const segments: Segment[] = [];
  let cursor = 0;

  for (const det of sorted) {
    if (det.startIndex < cursor) continue;
    if (det.startIndex > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, det.startIndex) });
    }
    segments.push({
      kind: "pii",
      text: text.slice(det.startIndex, det.endIndex),
      category: det.type,
      token: det.replacement,
    });
    cursor = det.endIndex;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments;
}

export default function PromptInput({
  value,
  onChange,
  onAnalysis,
  onResult,
  onSending,
}: PromptInputProps) {
  const [detections, setDetections] = useState<DetectionResult[]>([]);
  const [maskedText, setMaskedText] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const debounceRef = useRef<number | null>(null);
  const requestSeqRef = useRef(0);

  // Debounced live analysis on every change.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }

    if (!value.trim()) {
      setDetections([]);
      setMaskedText("");
      return;
    }

    const seq = ++requestSeqRef.current;
    debounceRef.current = window.setTimeout(async () => {
      setAnalyzing(true);
      try {
        const analysis = await mockAnalyze({ prompt: value, mode: "strict" });
        if (seq !== requestSeqRef.current) return;
        setDetections(analysis.detections);
        setMaskedText(analysis.maskedText);
        onAnalysis(analysis);
      } catch (err) {
        if (seq !== requestSeqRef.current) return;
        const msg = err instanceof Error ? err.message : "analysis failed";
        setError(msg);
      } finally {
        if (seq === requestSeqRef.current) {
          setAnalyzing(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [value, onAnalysis]);

  const segments = useMemo(
    () => buildSegments(value, detections),
    [value, detections],
  );

  const syncScroll = useCallback(() => {
    if (overlayRef.current && textareaRef.current) {
      overlayRef.current.scrollTop = textareaRef.current.scrollTop;
      overlayRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    setError(null);
    setSending(true);
    onSending?.(true);

    try {
      const analysis = await mockAnalyze({ prompt: value, mode: "strict" });
      setDetections(analysis.detections);
      setMaskedText(analysis.maskedText);
      onAnalysis(analysis);

      const sessionId = generateSessionId();
      const chat = await sendToOpenAI({
        maskedPrompt: analysis.maskedText,
        sessionId,
      });
      onResult({ analysis, chat });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "send failed";
      setError(msg);
    } finally {
      setSending(false);
      onSending?.(false);
    }
  }, [value, sending, onAnalysis, onResult, onSending]);

  const charCount = value.length;
  const detectionCount = detections.length;
  const canSend = value.trim().length > 0 && !sending;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Prompt</span>
        <span className="card-subtitle">
          {analyzing ? "scanning…" : "live PII scan"}
        </span>
      </div>

      <div className="prompt-shell">
        <div className="prompt-stack">
          <div ref={overlayRef} className="prompt-overlay" aria-hidden="true">
            {segments.length === 0 ? (
              <span style={{ color: "var(--text-muted)" }}>&nbsp;</span>
            ) : (
              segments.map((seg, idx) =>
                seg.kind === "text" ? (
                  <span key={idx}>{seg.text}</span>
                ) : (
                  <span
                    key={idx}
                    className={`pii pii-${seg.category}`}
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
            className="prompt-textarea"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onScroll={syncScroll}
            placeholder="Type a prompt — sensitive values are masked before they leave this device."
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>

        <div className="prompt-actions">
          <span className="prompt-meta">
            {charCount} chars · {detectionCount} pii
            {maskedText && detectionCount > 0
              ? ` · masked: ${truncate(maskedText, 64)}`
              : ""}
          </span>
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

      {error ? (
        <div
          style={{
            marginTop: 10,
            color: "var(--danger)",
            fontFamily: "var(--font-mono)",
            fontSize: 12,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}
