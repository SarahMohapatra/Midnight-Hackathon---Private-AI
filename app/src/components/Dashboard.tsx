import { useMemo } from "react";
import {
  DetectionType,
  type DetectionResult,
} from "../../../prover/types";

export interface SessionRecord {
  sessionId: string;
  detections: DetectionResult[];
  timestamp: string;
}

export interface DashboardProps {
  sessions: SessionRecord[];
  onLoadScenario: (prompt: string) => void;
}

interface Scenario {
  id: string;
  label: string;
  prompt: string;
}

const SCENARIOS: Scenario[] = [
  {
    id: "loan",
    label: "Loan",
    prompt:
      "My SSN is 123-45-6789 and my email is john@example.com, help me apply for a loan",
  },
  {
    id: "card",
    label: "Card",
    prompt:
      "My credit card 4111-1111-1111-1111 was charged incorrectly, my phone is 555-867-5309",
  },
  {
    id: "api",
    label: "API",
    prompt:
      "My API key is sk-abc123xyz and I need help debugging this authentication error",
  },
];

const CATEGORY_ORDER: DetectionType[] = [
  DetectionType.SSN,
  DetectionType.CREDIT_CARD,
  DetectionType.API_KEY,
  DetectionType.BEARER_TOKEN,
  DetectionType.EMAIL,
  DetectionType.PHONE,
  DetectionType.IP_ADDRESS,
  DetectionType.NAME,
  DetectionType.ADDRESS,
];

export default function Dashboard({
  sessions,
  onLoadScenario,
}: DashboardProps) {
  const totals = useMemo(() => {
    const totalRequests = sessions.length;
    let totalDetections = 0;
    const byCategory = new Map<DetectionType, number>();

    for (const session of sessions) {
      totalDetections += session.detections.length;
      for (const det of session.detections) {
        byCategory.set(det.type, (byCategory.get(det.type) ?? 0) + 1);
      }
    }

    return { totalRequests, totalDetections, byCategory };
  }, [sessions]);

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Demo &amp; Audit</span>
        <span className="card-subtitle">click to autofill</span>
      </div>

      <div className="scenarios">
        {SCENARIOS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="scenario-btn"
            onClick={() => onLoadScenario(s.prompt)}
          >
            <span className="label">{s.label}</span>
            <span>{s.prompt}</span>
          </button>
        ))}
      </div>

      <div className="metric-grid">
        <div className="metric">
          <div className="num">{totals.totalRequests}</div>
          <div className="lbl">Requests</div>
        </div>
        <div className="metric">
          <div className="num">{totals.totalDetections}</div>
          <div className="lbl">PII Detected</div>
        </div>
      </div>

      <div className="card-header" style={{ marginBottom: 8 }}>
        <span className="card-title">Breakdown</span>
      </div>

      {totals.byCategory.size === 0 ? (
        <div className="breakdown-empty">No PII captured yet.</div>
      ) : (
        <div className="breakdown">
          {CATEGORY_ORDER.filter((cat) => totals.byCategory.has(cat)).map(
            (cat) => (
              <div key={cat} className={`breakdown-row pii-${cat}`}>
                <span className="cat" style={{ color: "currentColor" }}>
                  {cat}
                </span>
                <span style={{ color: "var(--text)" }}>
                  {totals.byCategory.get(cat)}
                </span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
