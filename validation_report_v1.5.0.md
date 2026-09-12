# OTC Elite Signal Engine v1.5.0 — Validation Report

Date: 2026-09-12

## Gates

- TypeScript strict: PASS
- Unit/invariant tests: 27/27 PASS
- MV3 build: PASS
- Manifest validation: PASS
- Production content transport contains no timer-based market flush: PASS
- Auto-discard mitigation + tab freeze telemetry: PASS
- Per asset/feed data-health invariant: PASS
- Multi-timeframe episode arbitration invariant: PASS
- Overlapping episode suppression invariant: PASS
- Fail-closed arbitration conflict invariant: PASS

## Regression against user v1.4.0 dataset

Input capture:

- 1087 ticks
- DEMO verified `demo-api-eu.po.market`

Reprocessed through v1.5.0 semantics:

- ticks: 1087
- candles: 498
- decisions: 234
- raw eligible candidates entering arbitration: 44
- independent PRIMARY market episodes: 7
- correlated/overlapping candidates suppressed: 37
- arbitration conflicts: 0
- signals: 7
- resolved results at export: 3
- unresolved results at export: 3
- one episode still pending at export
- resolved independent directional sample: 3
- correct: 1
- descriptive accuracy: 33.33%

Per-asset health at export:

- EURUSDOTC @ demo-api-eu.po.market: HEALTHY, age 1031 ms
- EURJPYOTC @ demo-api-eu.po.market: DATA_UNAVAILABLE, age 877791 ms

This confirms that EURUSD activity no longer masks loss of EURJPY data.

## Descriptive slices of the independent resolved sample

Timeframe:

- 5s: 1/3 correct (33.33%)

Contributing strategies:

- EXHAUSTION_V1: 1/2 correct (50%)
- MOMENTUM_V1: 0/1 correct (0%)
- REJECTION_V1: 0/1 correct (0%)

These counts are far too small for strategy acceptance or tuning.

## Focus/background behavior

The v1.4 content transport used `window.setTimeout(..., 50)` for batch delivery. Chrome can heavily throttle timers in hidden tabs and can report a tab as frozen; a frozen tab cannot execute event handlers or timers. v1.5 removes timer dependency from market transport, uses a long-lived runtime Port with microtask flushing, disables automatic discard where available, and exposes source-tab lifecycle state. If Chrome freezes the entire page, no page-based interceptor can truthfully continue receiving that page's WebSocket callbacks; the engine therefore detects the gap and fails closed instead of fabricating continuity.

## Scientific boundary

- `minModelScore` remains 0.35.
- No CALL/PUT inversion or strategy tuning was performed.
- Payout expiration remains UNBOUND and economic sample remains fail-closed.
- Protocol verification is not evidence of profitability.

## Final build identity

- appVersion: 1.5.0
- buildId: source-dc29dd3b5699dd27
- sourceTreeSha256: dc29dd3b5699dd272e7df29e9ddd0b19f3738563499a5fc9a5d1c89a60c2d5c8
- content-script `setTimeout(` occurrences: 0
- content-script `runtime.connect` transport: present
- explicit `any`: 0
- `Math.random()`: 0
- TODO/FIXME in TypeScript: 0
