# PrivatePrompt

A **privacy-preserving AI chat demo** (“PrivatePrompt”). It runs detection and masking **in the browser**, optionally records a **minimal attestation** for each interaction (designed for Midnight Compact), then sends **only masked text** to a language model so raw PII never reaches the LLM layer.

---

## Project idea

Teams want to ship AI assistants without leaking secrets that users paste into the box. PrivatePrompt showcases a **narrow gateway pattern**:

1. **Detect** sensitive substrings locally (regex-based).
2. **Mask** them with stable placeholders (`[EMAIL_1]`, `[SSN_1]`, …).
3. **Score** content risk and classify the outcome (`clean`, `masked`, `blocked`).
4. **Anchor** a small hash-sized audit record—policy version, commitment over masked text, session fingerprint, privacy status—not the prompt itself (when Midnight path is wired or emulated).
5. **Call the model only on permitted paths**, using **`maskedText` alone** (`buildSafeLlmRequest` → `callLlm`).

Midnight enters the story as **the intended place** to persist those attestations on-chain once the Compact contract is deployed and a real client replaces the bundled stub.

---

## Scope

### In scope

- End-to-end **React + Vite** UI with chat thread, composer, live PII highlight, Privacy & Audit side panel.
- Canonical **`runPrivacyPipeline`** in **`prover/`** (detect → mask → risk → **`privacyStatus`** / **`aiDispatch`** → optional Midnight recording).
- **Demo scenarios A / B / C** for clean, masked, and hard-blocked traffic.
- **Optional OpenAI Chat Completions** when **`VITE_OPENAI_API_KEY`** is set (otherwise a deterministic mock). See “LLM responses” below.
- **Midnight-shaped adapter** (`prover/midnight.ts`) plus **`contracts/privacy_audit.compact`** and a **`contracts/generated/`** client placeholder that can be replaced by **`compactc`** output.

### Out of scope (by design today)

- Proving correctness of masking or detection **in zero knowledge**.
- Replacing regex detection with ML NER everywhere (architecture allows swapping engines later).
- Production-grade secret handling (**API keys in the browser are a hackathon shortcut**).

---

## Tech stack

| Layer | Choice |
|--------|--------|
| UI | React 18, TypeScript |
| Bundler / dev server | Vite 5 (`@vitejs/plugin-react`), dev server port **5173** |
| Privacy pipeline | TypeScript modules under **`prover/`** (framework-agnostic) |
| On-chain artifact | **Midnight Compact** — **`contracts/privacy_audit.compact`** |
| Compact build | **`compactc`** via `npm run compact:build` → **`contracts/generated/`** |
| LLM | **`fetch`** to OpenAI Chat Completions when key present; mock otherwise |

Dependencies are minimal on purpose (**`react`** / **`react-dom`** only in `package.json`).

---

## How to use it

### 1. Clone and install

```bash
git clone <your-fork-or-repo-url>
cd Midnight-Hackathon---Private-AI
npm install
```

### 2. Configure environment (**`app/.env`**)

Vite **`root`** is **`app/`**, so put env vars in **`app/.env`** (not the repo root, unless you replicate the same vars there without conflict). Example:

```env
# ── Midnight ─────────────────────────────────────────
VITE_MIDNIGHT_NETWORK=testnet
VITE_CONTRACT_ADDRESS=
VITE_MIDNIGHT_ENABLED=true

# ── OpenAI (optional) ─────────────────────────────────
# If unset, responses use an offline mock (“PrivatePrompt mock model”).
VITE_OPENAI_API_KEY=
```

- Leave **`VITE_CONTRACT_ADDRESS`** empty to stay on **local fallback** (see Midnight section below).
- **Never commit real API keys.** Keep secrets only in **`app/.env`** (should be gitignored).

### 3. Run the app

```bash
npm run dev
```

Open **http://localhost:5173**.

### 4. Use the UI

| Action | Effect |
|--------|--------|
| **Scenario A · Clean** | No PII detected; plaintext can go to the model; audit records a clean attestation. |
| **Scenario B · Masked** | Email/SSN etc. masked; **`maskedText`** is what the LLM receives; placeholders should stay verbatim in drafts. |
| **Scenario C · Blocked** | Risk above the hard threshold (**`> 0.8`**); AI call is suppressed; blocked outcome still recorded for audit/demo. |
| Type and send | Same pipeline as presets; composer debounces **live highlighting** (`skipMidnight: true`). |
| Click a message | Opens Privacy & Audit details for that pipeline run in the right panel. |

Restart **`npm run dev`** after changing **`.env`**.

---

## Demo scenarios

| Scenario | `privacyStatus` | AI dispatch | Audit / Midnight path |
|----------|-----------------|-------------|------------------------|
| **A · Clean** | `clean` | Called | Attestation emitted (fallback or live pipeline) |
| **B · Masked** | `masked` | Called with **masked** text only | Same |
| **C · Blocked** | `blocked` | Suppressed (`aiDispatch` disallows) | Still records **`blocked`** for traceability |

---

## Architecture (high level)

```
┌───────────────────────┐     debounced preview   ┌──────────────────────┐
│ Composer               │ ─────────────────────▶ │ PII overlay / scan   │
└───────────┬───────────┘                         └──────────────────────┘
            │ send
            ▼
┌───────────────────────────────────────┐     ┌───────────────────────────┐
│ runPrivacyPipeline (prover/pipeline.ts) │ ──▶ │ recordAudit (midnight.ts) │
│ detect → mask → score → classify        │     │ live OR local_fallback     │
└───────────┬────────────────────────────┘     └───────────────────────────┘
            │ PipelineResult
            ▼
┌───────────────────────┐     if allowed        ┌───────────────────────────┐
│ buildSafeLlmRequest   │ ────────────────────▶│ callLlm → OpenAI or mock │
│ (masked payload only) │                      └───────────────────────────┘
└───────────────────────┘
```

Single pipeline; UI and **`mockAnalyze`** / **`analyzePromptFull`** consume **`PipelineResult`**.

---

## Midnight: what exists today vs. what’s next

### What ships in this repo (current scope)

- **`contracts/privacy_audit.compact`** — Compact contract that **anchors metadata only** (`commitmentHash`, `sessionIdHash`, policy version bytes, **`Uint<64>` timestamp**, **`Uint<8>` status**). **No raw prompt and no masked string** are stored on-chain.
- **`prover/midnight.ts`** — Adapter that:
  - tries to load **`contracts/generated/privacyAuditClient`** and call **`createPrivacyAuditClient` / `recordAudit`**;
  - on failure, missing address, or disabled integration, uses **`local_fallback`**: same **`MidnightAuditResult`** shape, backed by **memory + `localStorage`** so the demo UI still works.
- **Typical checkout:** **`contracts/generated/privacyAuditClient.ts` is an intentional stub**. It refuses to impersonate **“live chain”** when **`VITE_CONTRACT_ADDRESS`** is unset. Even with an address configured, **the stub still simulates** `recordAudit` locally—**until you replace the generated bundle** with real **`compactc`** output wired to Midnight’s deploy and signer flow.

So: **the integration seams are real** (contract source + adapter API + env). **Talking to Midnight mainnet/testnet through a funded wallet-and-client stack is future work**, not guaranteed by cloning alone.

### What you would do later (toward production Midnight)

1. Install Midnight’s toolchain (including **`compactc`** matching your contract version).
2. Run **`npm run compact:build`** so **`contracts/generated/`** contains the **real emitted client**, or adjust **`midnight.ts`** to match Midnight’s exported factory names if they differ from the stub.
3. Deploy **`privacy_audit.compact`** per Midnight docs for your target network.
4. Put the deployed **`VITE_CONTRACT_ADDRESS`** (and **`VITE_MIDNIGHT_NETWORK`**) in **`app/.env`**.
5. Wire **wallet / signing** exactly as Midnight requires for invoking **`recordAudit`** from the browser or (recommended) **a small backend relay**—this repo intentionally does **not** ship turnkey wallet plumbing.

Until then the product story remains: **privacy pipeline + attestations anchored in-demo** via **local_fallback** (and optional stub **`live`** façade when an address exists).

Compact entry point (narrow write circuit):

```
recordAudit(
  commitmentHash: Bytes<32>,
  status:         Uint<8>,    // 0 CLEAN | 1 MASKED | 2 BLOCKED
  policyVersion:  Bytes<32>,
  sessionIdHash:  Bytes<32>,
  timestamp:      Uint<64>,
) → Field
```

See **`contracts/privacy_audit.compact`** for ledger layout and **`README`** “Midnight integration” historical note: the contract attests **“policy `P`, commitment `C`, session fingerprint, status, time `T`”**, not correctness of masking in ZK.

---

## LLM responses (OpenAI)

- **`app/src/library/openai.ts`** — If **`VITE_OPENAI_API_KEY`** is set and non-empty, **`callLlm`** POSTs **`maskedText`** as the **user** message to OpenAI **`/v1/chat/completions`** (default model **`gpt-4o-mini`**). Otherwise it returns an offline **mock** reply.
- **Security:** exposing keys in **`VITE_*`** ships them **to every user’s browser**; use only for demos. Production should proxy through your **backend** or user-owned secrets.

---

## Safety guarantees (intended semantics)

- The **canonical path to the model** requires **`SafeLlmRequest`**; **`buildSafeLlmRequest`** rejects when **`aiDispatch.allowed`** is false (blocked prompts never call **`callLlm`**).
- **Blocked** prompts: **`riskScore > 0.8`** → **`privacyStatus === "blocked"`** → **`aiAllowed === false`**. Cleaner or masked-but-under-ceiling prompts can still invoke the LLM **with masked placeholders only**.
- Audit-oriented records avoid storing raw detected values; hashing story is **`commitmentHash(maskedText, policyVersion)`** style metadata for the Midnight contract design.

---

## Project layout

```
prover/                     Canonical privacy + Midnight adapter
  pipeline.ts               Single runPrivacyPipeline entry point
  pii-detection.ts          Detection engine (regex-based)
  pii.ts                    Deterministic masking
  midnight.ts               Midnight adapter (load client / fallback)
  types.ts                  Shared types for UI + prover + contract alignment
  index.ts / api.ts         Thin / legacy exports

contracts/
  privacy_audit.compact     Compact audit contract source
  generated/                Stub or compactc emission (privacyAuditClient, …)

app/
  src/
    App.tsx                 Chat shell, send flow, Midnight probe
    components/             Composer, thread, audit panel, top bar
    library/
      mockAnalyze.ts        analyzePromptFull, scenarios, preview scan
      openai.ts             Safe LLM gateway (OpenAI vs mock)
      midnightClient.ts     Re-exports Midnight helpers for the shell
```

---

## Scripts

| Command | Description |
|---------|--------------|
| `npm run dev` | Vite dev server (**5173**) |
| `npm run build` | `tsc` + production bundle |
| `npm run preview` | Preview production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run compact:build` | Run **`compactc`** on **`contracts/privacy_audit.compact`** → **`contracts/generated`** |
