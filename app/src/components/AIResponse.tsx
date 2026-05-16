export interface AIResponseProps {
  response: string | null;
  sessionId: string | null;
  loading: boolean;
}

export default function AIResponse({
  response,
  sessionId,
  loading,
}: AIResponseProps) {
  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">AI Response</span>
        <span className="card-subtitle">
          {loading ? "thinking…" : response ? "ready" : "idle"}
        </span>
      </div>

      {loading ? (
        <div className="skeleton" aria-busy="true" aria-live="polite">
          <div className="bar" />
          <div className="bar" />
          <div className="bar short" />
        </div>
      ) : response ? (
        <>
          <div className="response-body">{response}</div>
          {sessionId ? (
            <div className="session-ref">
              <span className="label">audit ref:</span>
              <span>{sessionId}</span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="response-empty">
          Send a prompt to see the AI response. Only the masked text is
          forwarded — your raw prompt never leaves this device.
        </div>
      )}
    </div>
  );
}
