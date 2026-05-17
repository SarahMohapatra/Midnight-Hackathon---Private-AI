import { DEMO_SCENARIOS, type DemoScenario } from "../library/mockAnalyze";

export interface ScenarioBarProps {
  onPick: (scenario: DemoScenario) => void;
  disabled?: boolean;
}

const SCENARIO_TONE: Record<DemoScenario["id"], string> = {
  clean: "scenario-clean",
  masked: "scenario-masked",
  blocked: "scenario-blocked",
};

export default function ScenarioBar({ onPick, disabled }: ScenarioBarProps) {
  return (
    <div className="scenario-bar" role="group" aria-label="Demo scenarios">
      <span className="scenario-bar-label">Demo</span>
      {DEMO_SCENARIOS.map((scenario) => (
        <button
          key={scenario.id}
          type="button"
          className={`scenario-pill ${SCENARIO_TONE[scenario.id]}`}
          onClick={() => onPick(scenario)}
          disabled={disabled}
          title={scenario.description}
        >
          {scenario.label}
        </button>
      ))}
    </div>
  );
}
