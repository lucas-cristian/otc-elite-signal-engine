# OTC Elite Signal Engine — Remediation Report

Date: 2026-09-12
Baseline audited HEAD: 25aba0a0d49388c7b33a109d9eef1faf3c8cdba9
Sandbox release: 1.1.0

## Corrected findings

- Replaced random/receipt-only tick identity with canonical SHA-256 IDs and explicit source/receipt/monotonic clock domains.
- Replaced raw-frame MAIN → ISOLATED production transport with strict semantic market events.
- Added explicit PRODUCTION and PROTOCOL_DISCOVERY modes with fail-closed unknown-frame handling.
- Added strict instrument/source identity and symmetric fail-closed compatibility rules.
- Replaced M1/M5/M15 with 5s/10s/15s/30s/60s.
- Replaced mock feature/regime/evidence logic with causal features, regimes, five independent strategies, evidence-family caps and per-strategy warmup.
- Removed fake calibrated probability semantics; calibratedProbability is always null.
- Added deterministic evaluation-window, decision-granularity and signal-fingerprint hashing.
- Added immutable payout snapshots and corrected resolved/unresolved result discriminated unions.
- Added causal entry resolution and explicit entry/result timeout records.
- Added durable MV3 recovery derived from append-only journal set differences.
- Added reference-feed analytics with coverage metrics and Wilson interval for directional proportions only.
- Added scientific dataset manifest/checksum, export and replay through the same QuantPipeline.
- Replaced placeholder npm test script and added typecheck/build/manifest/verify gates.
- Reworked MV3 build so the manifest content script is a classic script without ESM imports; MAIN World and Service Worker use modules where supported.
- Added README and updated implementation_plan to match delivered behavior.

## Validation completed

- npm run typecheck: PASS
- npm test: 13/13 PASS
- npm run build: PASS
- npm run validate:manifest: PASS
- npm run verify: PASS
- dist JavaScript syntax validation: PASS
- static scan for any / Math.random / placeholders / TODO / FIXME / old timeframes: PASS
- narrative source-code comment scan: PASS

## Fail-closed external gate

Pocket Option DEMO protocol/DevTools validation could not be executed in this chat sandbox. The release therefore defaults protocolSchemaVerified=false. Source quality remains INFERRED and CALL/PUT is blocked with UNVERIFIED_SOURCE_SCHEMA until the exact production schema is empirically verified in DEMO.

No auto-trading, auto-click, order execution or financial execution path exists.

## GitHub publishing status

The connected GitHub integration can read the repository but rejected both branch creation and Git tree creation with HTTP 403 Resource not accessible by integration. No partial writes were made to main. The complete validated checkout is delivered as a ZIP for upload/commit when write permission is available.
