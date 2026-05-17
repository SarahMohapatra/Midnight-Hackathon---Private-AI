import type { MidnightStatus } from "../library/midnightClient";

export interface TopBarProps {
  midnight: MidnightStatus | null;
  sessionId: string;
  onNewSession: () => void;
}

function shorten(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export default function TopBar({ midnight, sessionId, onNewSession }: TopBarProps) {
  const connectivity = midnight?.connectivity ?? "checking";
  const network = midnight?.network ?? "—";
  const badgeLabel =
    connectivity === "live"
      ? "Midnight · live"
      : connectivity === "checking"
        ? "Midnight · connecting"
        : "Midnight · local fallback";

  return (
    <header className="topbar">
      <div className="topbar-brand">
        <span className="brand-mark" aria-hidden="true">
          <span className="brand-dot" />
        </span>
        <div className="brand-text">
          <span className="brand-name">PrivatePrompt</span>
          <span className="brand-tag">Privacy-preserving AI gateway</span>
        </div>
      </div>

      <div className="topbar-meta">
        <div className={`midnight-badge midnight-${connectivity}`}>
          <span className="midnight-dot" />
          <div className="midnight-text">
            <span className="midnight-label">{badgeLabel}</span>
            <span className="midnight-network">network: {network}</span>
          </div>
        </div>

        <div className="session-chip" title={sessionId}>
          <span className="session-key">session</span>
          <span className="session-val">{shorten(sessionId, 7, 5)}</span>
        </div>

        <button type="button" className="btn btn-ghost" onClick={onNewSession}>
          New chat
        </button>
      </div>
    </header>
  );
}
