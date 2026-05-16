import { useCallback, useState } from "react";
import PromptInput, { type PromptResult } from "./components/PromptInput";
import ThreatIndicator from "./components/ThreatIndicator";
import AIResponse from "./components/AIResponse";
import Dashboard, { type SessionRecord } from "./components/Dashboard";
import type {
  AnalyzeResponse,
  DetectionResult,
} from "../../prover/types";

export default function App() {
  const [prompt, setPrompt] = useState("");
  const [currentPII, setCurrentPII] = useState<DetectionResult[]>([]);
  const [currentResponse, setCurrentResponse] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<SessionRecord[]>([]);

  const handleAnalysis = useCallback((analysis: AnalyzeResponse) => {
    setCurrentPII(analysis.detections);
  }, []);

  const handleResult = useCallback((result: PromptResult) => {
    setCurrentResponse(result.chat.response);
    setSessionId(result.chat.sessionId);
    setHistory((prev) => [
      ...prev,
      {
        sessionId: result.chat.sessionId,
        detections: result.analysis.detections,
        timestamp: result.analysis.timestamp,
      },
    ]);
  }, []);

  const handleChange = useCallback((next: string) => {
    setPrompt(next);
  }, []);

  const handleScenarioLoad = useCallback((scenarioPrompt: string) => {
    setPrompt(scenarioPrompt);
    setCurrentResponse(null);
    setSessionId(null);
  }, []);

  const handleSending = useCallback((sending: boolean) => {
    setLoading(sending);
    if (sending) {
      setCurrentResponse(null);
      setSessionId(null);
    }
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo-dot" />
          PrivatePrompt
        </h1>
        <span className="tag">Privacy-screened AI · mock pipeline</span>
      </header>

      <main className="app-main">
        <section className="column">
          <PromptInput
            value={prompt}
            onChange={handleChange}
            onAnalysis={handleAnalysis}
            onResult={handleResult}
            onSending={handleSending}
          />
          <ThreatIndicator detectedPII={currentPII} />
        </section>

        <section className="column">
          <AIResponse
            response={currentResponse}
            sessionId={sessionId}
            loading={loading}
          />
          <Dashboard
            sessions={history}
            onLoadScenario={handleScenarioLoad}
          />
        </section>
      </main>
    </div>
  );
}
