import {
  DetectionType,
  type DetectionResult,
} from "../../../prover/types";

export interface ThreatIndicatorProps {
  detectedPII: DetectionResult[];
}

const CATEGORY_LABELS: Record<DetectionType, string> = {
  [DetectionType.SSN]: "SSN",
  [DetectionType.CREDIT_CARD]: "Credit Card",
  [DetectionType.EMAIL]: "Email",
  [DetectionType.PHONE]: "Phone",
  [DetectionType.API_KEY]: "API Key",
  [DetectionType.BEARER_TOKEN]: "Bearer Token",
  [DetectionType.IP_ADDRESS]: "IP Address",
  [DetectionType.NAME]: "Name",
  [DetectionType.ADDRESS]: "Address",
};

export default function ThreatIndicator({
  detectedPII,
}: ThreatIndicatorProps) {
  const count = detectedPII.length;

  return (
    <div className="card">
      <div className="card-header">
        <span className="card-title">Threats</span>
        <span className="card-subtitle">live</span>
      </div>

      {count === 0 ? (
        <div className="threat-empty">No threats detected</div>
      ) : (
        <>
          <div className="threat-count">
            <strong>{count}</strong>
            <span>{count === 1 ? "threat detected" : "threats detected"}</span>
          </div>
          <ul className="threat-list">
            {detectedPII.map((det) => (
              <li
                key={det.id}
                className={`threat-item pii-${det.type}`}
                style={{ borderLeftColor: "currentColor" }}
              >
                <span className="cat">
                  {CATEGORY_LABELS[det.type] ?? det.type}
                </span>
                <span className="arrow">→</span>
                <span className="tok">{det.replacement}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
