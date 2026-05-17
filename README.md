# PrivatePrompt

Privacy-preserving AI gateway. PrivatePrompt detects and masks sensitive
content **on-device** before any AI request, then anchors a verifiable
attestation on the Midnight network for every interaction.

The story is end-to-end:

1. The user types a prompt.
2. The canonical privacy pipeline detects sensitive entities locally.
3. Detections are replaced with stable tokens (`[EMAIL_1]`, `[SSN_1]`, …).
4. A `commitment = hash(policyVersion || maskedText)` is computed.
5. The Midnight `privacy_audit` contract records the attestation
   `(commitmentHash, status, policyVersion, sessionIdHash, timestamp)`.
6. Only the **masked** payload is forwarded to the LLM — never the original
   text. Blocked prompts skip the model entirely.

## Quick start

```bash
git clone <repo>
cd Midnight-Hackathon---Private-AI

# 1. install
npm install

# 2. (optional) configure Midnight
cp .env.example .env
# edit .env — leave VITE_CONTRACT_ADDRESS blank to run in local_fallback

# 3. run the app
npm run dev
# → http://localhost:5173
```

The top bar shows `Midnight · live` when a deployed contract is wired up and
`Midnight · local fallback` otherwise. Both modes are fully functional for
the demo; only the attestation destination differs.

## Demo scenarios

The composer ships with three one-click presets that exercise every state in
the pipeline:

| Scenario | Expected status | AI dispatch | Midnight |
|----------|-----------------|-------------|----------|
| **A · Clean**   | `clean`   | called  | attestation written |
| **B · Masked**  | `masked`  | called  | attestation written (with masked-commitment) |
| **C · Blocked** | `blocked` | skipped | attestation written with status `blocked` |

Click any preset and the full pipeline runs end-to-end. Click any message
bubble in the thread to inspect its Privacy & Audit details in the right
panel.

## Project layout

```
prover/                   Canonical, framework-agnostic privacy + Midnight code
  pipeline.ts             ← single runPrivacyPipeline entry point
  pii-detection.ts        ← regex detection engine
  pii.ts                  ← deterministic token masking
  midnight.ts             ← Midnight adapter (live / local_fallback)
  audit.ts                ← AuditEntry + AuditRecord stores
  types.ts                ← canonical types (PipelineResult, MidnightAuditResult, …)
  index.ts / api.ts       ← legacy facades that delegate to pipeline.ts

contracts/
  privacy_audit.compact   ← Compact attestation contract
  generated/              ← TS client emitted by `compactc`

app/
  index.html
  src/
    App.tsx               ← chat shell (top bar, thread, composer, audit panel)
    components/           ← TopBar, ChatThread, Composer, PrivacyAuditPanel, ScenarioBar
    library/
      mockAnalyze.ts      ← analyzePromptFull / previewAnalyze entry points
      openai.ts           ← enforced SafeLlmRequest gateway
      midnightClient.ts   ← app-side re-export of prover/midnight
      prover.ts           ← legacy facade
    styles.css            ← dark-first design system
```

## Architecture

```
┌──────────────────────┐
│  Composer (debounced │── live PII highlight ──┐
│  preview scan)       │                        │
└──────────┬───────────┘                        │
           │ send                               │
           ▼                                    │
┌──────────────────────┐    ┌──────────────────▼──────┐
│ runPrivacyPipeline   │───▶│ Midnight `recordAudit`  │
│  detect → mask →     │    │ (live or local_fallback)│
│  score → decide      │    └──────────────────┬──────┘
└──────────┬───────────┘                       │
           │ PipelineResult                    │
           ▼                                   │
┌──────────────────────┐                       │
│ buildSafeLlmRequest  │ — refuses on blocked  │
│ → callLlm (masked)   │                       │
└──────────┬───────────┘                       │
           │ AI response                       │
           ▼                                   │
┌──────────────────────┐    ┌──────────────────▼──────┐
│  Chat thread bubble  │    │ Privacy & Audit panel   │
└──────────────────────┘    └─────────────────────────┘
```

There is **one** pipeline. `runPrivacyPipeline` returns a `PipelineResult`
containing the analysis, the Midnight attestation, and an explicit
`aiDispatch` decision. The UI consumes it directly; the legacy
`createAnalyzeService` wrapper, `prover/index.ts`, `prover/api.ts`, and
`app/src/library/prover.ts` all forward through the same function.

## Midnight integration

The Compact contract `contracts/privacy_audit.compact` exposes a single
write circuit:

```
recordAudit(
  commitmentHash: Bytes<32>,
  status:         Uint<8>,    // 0 CLEAN | 1 MASKED | 2 BLOCKED
  policyVersion:  Bytes<32>,
  sessionIdHash:  Bytes<32>,
  timestamp:      Uint<64>,
) → Field          // returns the new recordId
```

It is intentionally narrow: no raw prompt, no masked text, no detection
categories. The contract **anchors an attestation that the client ran
policy version `P` and produced commitment `C` at time `T`** — it does not
claim to prove the regex transformation in zero knowledge.

### Compile

```bash
# requires Midnight Compact compiler `compactc`
npm run compact:build
```

The compiled TypeScript client lands in `contracts/generated/`. The
adapter (`prover/midnight.ts`) dynamically imports it and falls back to
the in-memory stub when the client cannot be loaded.

### Deploy & wire up

1. Deploy `privacy_audit.compact` with the Midnight toolchain.
2. Copy the contract address into `.env`:

   ```env
   VITE_MIDNIGHT_NETWORK=testnet
   VITE_CONTRACT_ADDRESS=0xYOUR_DEPLOYED_CONTRACT
   ```

3. Restart `npm run dev`. The top bar should switch from
   `Midnight · local fallback` to `Midnight · live`.

If no contract address is set, the adapter routes every audit through the
local fallback path. Audit data still appears in the panel and is
persisted in `localStorage` so the demo trail survives reloads.

## Safety guarantees

- The original prompt is **never** sent to the LLM. The only entry point
  to the model is `buildSafeLlmRequest`, which refuses to construct a
  request when `aiDispatch.allowed === false`.
- Raw secrets are **never** stored. Audit records only contain hashes
  and bounded enums.
- The block decision (`riskScore > 0.8`) short-circuits the LLM call
  **before** `callLlm` is ever invoked.
- The Midnight write happens irrespective of block state, so the audit
  trail records suppressed attempts too.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev`          | start the Vite dev server (port 5173)        |
| `npm run build`        | run `tsc` then build for production          |
| `npm run preview`      | preview the built bundle                     |
| `npm run typecheck`    | `tsc --noEmit` only                          |
| `npm run compact:build`| compile the Compact contract into `contracts/generated` |
