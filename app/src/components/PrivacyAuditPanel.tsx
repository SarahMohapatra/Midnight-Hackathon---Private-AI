import { useMemo } from "react";
import {
  DetectionType,
  type DetectionResult,
  type PipelineResult,
} from "../../../prover/types";

export interface PrivacyAuditPanelProps {
  pipeline: PipelineResult | null;
  totalRequests: number;
  totalBlocked: number;
  totalMidnightLive: number;
}

const TYPE_LABEL: Record<DetectionType, string> = {
  [DetectionType.SSN]: "SSN",
  [DetectionType.CREDIT_CARD]: "Credit card",
  [DetectionType.EMAIL]: "Email",
  [DetectionType.PHONE]: "Phone",
  [DetectionType.API_KEY]: "API key",
  [DetectionType.BEARER_TOKEN]: "Bearer token",
  [DetectionType.IP_ADDRESS]: "IP address",
  [DetectionType.NAME]: "Name",
  [DetectionType.ADDRESS]: "Address",
};

const TYPE_ORDER: DetectionType[] = [
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

function shorten(value: string | undefined, head = 8, tail = 6): string {
  if (!value) return "—";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function countByType(detections: DetectionResult[]) {
  const counts = new Map<DetectionType, number>();
  for (const det of detections) {
    counts.set(det.type, (counts.get(det.type) ?? 0) + 1);
  }
  return counts;
}

export default function PrivacyAuditPanel({
  pipeline,
  totalRequests,
  totalBlocked,
  totalMidnightLive,
}: PrivacyAuditPanelProps) {
  const counts = useMemo(
    () => countByType(pipeline?.response.detections ?? []),
    [pipeline],
  );

  return (
    <aside className="audit-panel">
      <SessionStats
        totalRequests={totalRequests}
        totalBlocked={totalBlocked}
        totalMidnightLive={totalMidnightLive}
      />

      {pipeline ? (
        <>
          <PrivacyCard pipeline={pipeline} counts={counts} />
          <MaskedPayloadCard pipeline={pipeline} />
          <AiDispatchCard pipeline={pipeline} />
          <MidnightCard pipeline={pipeline} />
        </>
      ) : (
        <EmptyPanel />
      )}
    </aside>
  );
}

function SessionStats({
  totalRequests,
  totalBlocked,
  totalMidnightLive,
}: {
  totalRequests: number;
  totalBlocked: number;
  totalMidnightLive: number;
}) {
  return (
    <div className="panel-card panel-stats">
      <div className="panel-card-header">
        <span className="panel-card-title">Session</span>
      </div>
      <div className="stats-grid">
        <Stat label="prompts" value={totalRequests} />
        <Stat label="blocked" value={totalBlocked} tone={totalBlocked > 0 ? "danger" : undefined} />
        <Stat label="on midnight" value={totalMidnightLive} tone="accent" />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "danger" | "accent";
}) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function PrivacyCard({
  pipeline,
  counts,
}: {
  pipeline: PipelineResult;
  counts: Map<DetectionType, number>;
}) {
  const status = pipeline.response.privacyStatus;
  const risk = pipeline.response.riskScore;
  const pct = Math.round(risk * 100);
  return (
    <div className="panel-card">
      <div className="panel-card-header">
        <span className="panel-card-title">Privacy analysis</span>
        <span className={`status-pill status-${status}`}>{status}</span>
      </div>

      <div className="risk-gauge">
        <div className="risk-bar">
          <div
            className={`risk-fill risk-${status}`}
            style={{ width: `${Math.max(4, pct)}%` }}
          />
        </div>
        <div className="risk-meta">
          <span>risk</span>
          <span>{risk.toFixed(2)} / 1.00</span>
        </div>
      </div>

      {counts.size === 0 ? (
        <p className="panel-empty">No sensitive entities detected.</p>
      ) : (
        <ul className="entity-list">
          {TYPE_ORDER.filter((t) => counts.has(t)).map((t) => (
            <li key={t} className={`entity-row pii-${t}`}>
              <span className="entity-label">{TYPE_LABEL[t]}</span>
              <span className="entity-count">{counts.get(t)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MaskedPayloadCard({ pipeline }: { pipeline: PipelineResult }) {
  const masked = pipeline.response.maskedText;
  if (!masked) return null;
  return (
    <div className="panel-card">
      <div className="panel-card-header">
        <span className="panel-card-title">Masked payload</span>
        <span className="panel-card-sub">forwarded to AI</span>
      </div>
      <pre className="masked-payload"><code>{masked}</code></pre>
    </div>
  );
}

function AiDispatchCard({ pipeline }: { pipeline: PipelineResult }) {
  const { aiDispatch } = pipeline;
  return (
    <div className="panel-card">
      <div className="panel-card-header">
        <span className="panel-card-title">AI dispatch</span>
        <span className={`status-pill ${aiDispatch.called ? "status-ai-called" : "status-ai-skipped"}`}>
          {aiDispatch.called ? "called" : aiDispatch.allowed ? "allowed" : "skipped"}
        </span>
      </div>
      {aiDispatch.reason ? (
        <p className="panel-note">{aiDispatch.reason}</p>
      ) : (
        <p className="panel-note">Only the masked payload above was sent to the model.</p>
      )}
    </div>
  );
}

function MidnightCard({ pipeline }: { pipeline: PipelineResult }) {
  const m = pipeline.midnight;
  const liveOrFallback = m.mode === "live"
    ? "live attestation"
    : m.mode === "local_fallback"
      ? "local fallback"
      : "skipped";
  return (
    <div className="panel-card">
      <div className="panel-card-header">
        <span className="panel-card-title">Midnight attestation</span>
        <span className={`status-pill status-midnight-${m.mode}`}>{liveOrFallback}</span>
      </div>
      <dl className="kv">
        <KV k="network" v={m.network} />
        <KV k="policy" v={m.policyVersion} mono />
        <KV k="status" v={m.status} />
        <KV k="commitment" v={m.commitmentHash} mono copy />
        <KV k="session" v={m.sessionIdHash} mono copy />
        {m.recordId ? <KV k="record" v={m.recordId} mono copy /> : null}
        {m.txHash ? <KV k="tx hash" v={m.txHash} mono copy /> : null}
        <KV k="time" v={new Date(m.timestamp).toLocaleString()} />
      </dl>
      {m.error ? <p className="panel-note panel-warn">{m.error}</p> : null}
    </div>
  );
}

function KV({ k, v, mono, copy }: { k: string; v: string; mono?: boolean; copy?: boolean }) {
  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(v).catch(() => {});
    }
  };
  return (
    <div className="kv-row">
      <dt>{k}</dt>
      <dd className={mono ? "kv-mono" : ""}>
        <span title={v}>{shorten(v, 12, 6)}</span>
        {copy ? (
          <button type="button" className="kv-copy" onClick={handleCopy} aria-label="copy">
            copy
          </button>
        ) : null}
      </dd>
    </div>
  );
}

function EmptyPanel() {
  return (
    <div className="panel-card panel-empty-card">
      <h3>Privacy &amp; Audit</h3>
      <p>Send a prompt to see its privacy analysis, the masked payload that reaches the AI, and the matching Midnight attestation.</p>
      <ul>
        <li><span className="dot status-clean" /> clean — no detections</li>
        <li><span className="dot status-masked" /> masked — tokens replace secrets</li>
        <li><span className="dot status-blocked" /> blocked — AI call suppressed</li>
      </ul>
    </div>
  );
}
