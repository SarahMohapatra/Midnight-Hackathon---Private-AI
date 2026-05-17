# `contracts/generated/`

This directory holds the TypeScript client that the Midnight Compact compiler
emits for the `privacy_audit.compact` contract.

The stub committed here (`privacyAuditClient.ts`) is **API-shape-compatible**
with the real generated client and is what `prover/midnight.ts` dynamically
imports. It currently runs an in-memory simulation so the app works end-to-end
without a Compact toolchain installed.

## Replacing the stub with the real client

Once the Midnight toolchain is installed and the contract is deployed:

```bash
# from repo root
compactc contracts/privacy_audit.compact -o contracts/generated
```

Overwrite `privacyAuditClient.ts` with the compiler output (the named export
`createPrivacyAuditClient` and the `recordAudit` / `listAudits` shape are what
the adapter expects).

Adapter wiring: see [`prover/midnight.ts`](../../prover/midnight.ts).
