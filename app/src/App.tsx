import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TopBar from "./components/TopBar";
import ChatThread from "./components/ChatThread";
import Composer from "./components/Composer";
import PrivacyAuditPanel from "./components/PrivacyAuditPanel";
import {
  analyzePromptFull,
  type DemoScenario,
} from "./library/mockAnalyze";
import {
  buildSafeLlmRequest,
  callLlm,
  PrivatePromptLlmError,
} from "./library/openai";
import { probeMidnightStatus, type MidnightStatus } from "./library/midnightClient";
import type {
  AnalyzeResponse,
  ChatMessage,
  PipelineResult,
} from "../../prover/types";

function newMessageId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `sess_${crypto.randomUUID()}`;
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function App() {
  const [draft, setDraft] = useState("");
  const [livePreview, setLivePreview] = useState<AnalyzeResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pipelines, setPipelines] = useState<Record<string, PipelineResult>>({});
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(() => newSessionId());
  const [midnight, setMidnight] = useState<MidnightStatus | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Probe Midnight connectivity on mount and after every send so the badge
  // reflects the live state (live → local_fallback if a call later fails).
  const refreshMidnight = useCallback(async () => {
    const status = await probeMidnightStatus();
    if (mountedRef.current) setMidnight(status);
  }, []);
  useEffect(() => {
    void refreshMidnight();
  }, [refreshMidnight]);

  const handleNewSession = useCallback(() => {
    setMessages([]);
    setPipelines({});
    setSelectedRequestId(null);
    setDraft("");
    setLivePreview(null);
    setPendingPrompt(null);
    setSessionId(newSessionId());
  }, []);

  const recordPipeline = useCallback((result: PipelineResult) => {
    setPipelines((prev) => ({ ...prev, [result.requestId]: result }));
    setSelectedRequestId(result.requestId);
  }, []);

  const handleSend = useCallback(
    async (rawPrompt: string) => {
      const prompt = rawPrompt.trim();
      if (!prompt || sending) return;
      setSending(true);
      setPendingPrompt(prompt);
      setDraft("");
      setLivePreview(null);

      try {
        // Step 1: run the canonical privacy pipeline (detect → mask → score
        // → decide → record on Midnight). Always returns a PipelineResult.
        const result = await analyzePromptFull({ prompt, mode: "strict" });

        const userMessage: ChatMessage = {
          id: newMessageId("u"),
          role: "user",
          text: prompt,
          timestamp: result.response.timestamp,
          pipelineRequestId: result.requestId,
          status: result.response.privacyStatus === "blocked" ? "blocked" : "ok",
        };

        recordPipeline(result);
        setMessages((prev) => [...prev, userMessage]);
        setPendingPrompt(null);

        // Step 2: blocked? Append a system bubble explaining the block and
        // skip the LLM call entirely.
        if (!result.aiDispatch.allowed) {
          const reason = result.aiDispatch.reason ?? "AI call suppressed by privacy policy";
          const blockMessage: ChatMessage = {
            id: newMessageId("s"),
            role: "system",
            text: `Blocked — ${reason}. No AI call was made. The block event was anchored via the Midnight attestation contract.`,
            timestamp: new Date().toISOString(),
            pipelineRequestId: result.requestId,
            status: "blocked",
          };
          setMessages((prev) => [...prev, blockMessage]);
          return;
        }

        // Step 3: dispatch ONLY the masked text via the enforced gateway.
        setStreaming(true);
        const safeRequest = buildSafeLlmRequest(result);
        const llmResponse = await callLlm(safeRequest);

        // Surface the actual "called" decision on the pipeline so the audit
        // panel and message badge match reality.
        const updated: PipelineResult = {
          ...result,
          aiDispatch: { ...result.aiDispatch, called: true },
        };
        recordPipeline(updated);

        const assistantMessage: ChatMessage = {
          id: newMessageId("a"),
          role: "assistant",
          text: llmResponse.responseText,
          timestamp: llmResponse.timestamp,
          pipelineRequestId: result.requestId,
          status: "ok",
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } catch (error) {
        const message =
          error instanceof PrivatePromptLlmError
            ? `${error.code}: ${error.message}`
            : error instanceof Error
              ? error.message
              : "Unknown error";
        const errorMessage: ChatMessage = {
          id: newMessageId("e"),
          role: "system",
          text: `Error — ${message}`,
          timestamp: new Date().toISOString(),
          status: "error",
        };
        setMessages((prev) => [...prev, errorMessage]);
      } finally {
        setSending(false);
        setStreaming(false);
        setPendingPrompt(null);
        void refreshMidnight();
      }
    },
    [recordPipeline, refreshMidnight, sending],
  );

  const handleScenario = useCallback(
    (scenario: DemoScenario) => {
      if (sending) return;
      setDraft(scenario.prompt);
      // Auto-send for the demo so judges see the full flow in one click.
      void handleSend(scenario.prompt);
    },
    [handleSend, sending],
  );

  const selectedPipeline =
    selectedRequestId !== null ? pipelines[selectedRequestId] ?? null : null;

  const totals = useMemo(() => {
    const list = Object.values(pipelines);
    return {
      total: list.length,
      blocked: list.filter((p) => p.response.privacyStatus === "blocked").length,
      midnightLive: list.filter((p) => p.midnight.mode === "live").length,
    };
  }, [pipelines]);

  return (
    <div className="app-shell">
      <TopBar
        midnight={midnight}
        sessionId={sessionId}
        onNewSession={handleNewSession}
      />

      <div className="app-body">
        <section className="chat-pane">
          <ChatThread
            messages={messages}
            pipelines={pipelines}
            selectedRequestId={selectedRequestId}
            onSelect={setSelectedRequestId}
            pendingPrompt={pendingPrompt}
            isStreamingResponse={streaming}
          />
          <Composer
            value={draft}
            onChange={setDraft}
            onSend={handleSend}
            onScenario={handleScenario}
            sending={sending}
            livePreview={livePreview}
            onLivePreviewChange={setLivePreview}
          />
        </section>

        <PrivacyAuditPanel
          pipeline={selectedPipeline}
          totalRequests={totals.total}
          totalBlocked={totals.blocked}
          totalMidnightLive={totals.midnightLive}
        />
      </div>
    </div>
  );
}
