import { useEffect, useMemo, useRef } from "react";
import {
  DetectionType,
  type ChatMessage,
  type DetectionResult,
  type PipelineResult,
} from "../../../prover/types";

export interface ChatThreadProps {
  messages: ChatMessage[];
  pipelines: Record<string, PipelineResult>;
  selectedRequestId: string | null;
  onSelect: (requestId: string) => void;
  pendingPrompt: string | null;
  isStreamingResponse: boolean;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

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

export default function ChatThread({
  messages,
  pipelines,
  selectedRequestId,
  onSelect,
  pendingPrompt,
  isStreamingResponse,
}: ChatThreadProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages.length, pendingPrompt, isStreamingResponse]);

  const hasContent = messages.length > 0 || pendingPrompt;

  return (
    <div className="thread" ref={scrollRef}>
      {!hasContent ? (
        <EmptyState />
      ) : (
        <div className="thread-list">
          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              pipeline={msg.pipelineRequestId ? pipelines[msg.pipelineRequestId] : undefined}
              selected={selectedRequestId === msg.pipelineRequestId}
              onSelect={onSelect}
            />
          ))}
          {pendingPrompt ? <PendingUserBubble text={pendingPrompt} /> : null}
          {isStreamingResponse ? <AssistantThinking /> : null}
        </div>
      )}
    </div>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  pipeline: PipelineResult | undefined;
  selected: boolean;
  onSelect: (requestId: string) => void;
}

function MessageBubble({ message, pipeline, selected, onSelect }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const isBlocked = message.status === "blocked";
  const detections = pipeline?.response.detections ?? [];
  const segments = isUser ? buildSegments(message.text, detections) : null;

  const wrapperClass = [
    "msg-row",
    isUser ? "msg-row-user" : isAssistant ? "msg-row-assistant" : "msg-row-system",
    isBlocked ? "msg-row-blocked" : "",
    selected ? "msg-row-selected" : "",
  ].filter(Boolean).join(" ");

  const bubbleClass = [
    "msg-bubble",
    isUser ? "msg-bubble-user" : isAssistant ? "msg-bubble-assistant" : "msg-bubble-system",
    isBlocked ? "msg-bubble-blocked" : "",
  ].filter(Boolean).join(" ");

  const handleSelect = () => {
    if (message.pipelineRequestId) onSelect(message.pipelineRequestId);
  };

  return (
    <div className={wrapperClass}>
      <button type="button" className={bubbleClass} onClick={handleSelect}>
        {isUser && segments ? (
          <p className="msg-text">
            {segments.map((seg, idx) =>
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
            )}
          </p>
        ) : (
          <p className="msg-text">{message.text}</p>
        )}

        {isUser && pipeline && pipeline.response.detections.length > 0 ? (
          <p className="msg-masked">
            <span className="msg-masked-label">forwarded as</span>
            <code>{pipeline.response.maskedText}</code>
          </p>
        ) : null}

        <div className="msg-meta">
          <span>{formatTime(message.timestamp)}</span>
          {pipeline ? <PipelineBadge pipeline={pipeline} /> : null}
        </div>
      </button>
    </div>
  );
}

function PipelineBadge({ pipeline }: { pipeline: PipelineResult }) {
  const status = pipeline.response.privacyStatus;
  const aiCalled = pipeline.aiDispatch.called;
  return (
    <span className="pipeline-badge-row">
      <span className={`status-pill status-${status}`}>{status}</span>
      <span className="status-pill status-ai">
        {aiCalled ? "AI · called" : "AI · skipped"}
      </span>
      <span className={`status-pill status-midnight-${pipeline.midnight.mode}`}>
        midnight · {pipeline.midnight.mode === "live" ? "live" : pipeline.midnight.mode === "local_fallback" ? "local" : "skipped"}
      </span>
    </span>
  );
}

function PendingUserBubble({ text }: { text: string }) {
  return (
    <div className="msg-row msg-row-user msg-row-pending">
      <div className="msg-bubble msg-bubble-user msg-bubble-pending">
        <p className="msg-text">{text}</p>
        <div className="msg-meta">
          <span>scanning…</span>
        </div>
      </div>
    </div>
  );
}

function AssistantThinking() {
  return (
    <div className="msg-row msg-row-assistant">
      <div className="msg-bubble msg-bubble-assistant msg-bubble-thinking">
        <div className="thinking-dots" aria-label="assistant typing">
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const bullets = useMemo(
    () => [
      "Type anything — sensitive values are detected locally before they leave this device.",
      "Detections are replaced with stable tokens like [EMAIL_1] before the AI request.",
      "Every interaction anchors a verifiable attestation on Midnight.",
    ],
    [],
  );
  return (
    <div className="thread-empty">
      <div className="thread-empty-glow" aria-hidden="true" />
      <h2>Talk to AI without leaking secrets.</h2>
      <p>PrivatePrompt screens your prompt locally, then attests every interaction on the Midnight network.</p>
      <ul>
        {bullets.map((b) => <li key={b}>{b}</li>)}
      </ul>
    </div>
  );
}
