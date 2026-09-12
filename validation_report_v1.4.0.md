# OTC Elite Signal Engine v1.4.0 — Validation Report

Date: 2026-09-12

## Build provenance

- appVersion: 1.4.0
- buildId: `source-0da29d020f73a906`
- sourceTreeSha256: `0da29d020f73a90692633b13fe77c7cf6d82986bc6193ded5ae9667af3c0da37`
- sandbox Git SHA: unavailable because this working directory is not a Git checkout

## Gates

- TypeScript strict typecheck: PASS
- Tests: 23/23 PASS
- Build: PASS
- Manifest MV3 validation: PASS
- IndexedDB schema: 5
- Dataset schema: 3
- Tick schema: 4
- Decision schema: 3
- PayoutSnapshot schema: 3
- Protocol registry: 2026-09-12.1

## Protocol registry evidence

The registry validates exact host + event + parser schema + payload shape. The raw CDP capture was replayed after exact duplicate-frame removal.

| Feed | Verified price events | Verified payout events |
| --- | ---: | ---: |
| demo-api-eu.po.market | 234 | 24 |
| api-us-north.po.market | 38 | 2 |
| api-us-south.po.market | 127 | 6 |

Unregistered Pocket Option market hosts remain INFERRED.

## Watchdog invariants

Default wall-clock thresholds:

- HEALTHY: <= 5000 ms
- DEGRADED: 5001..15000 ms
- STALE: 15001..60000 ms
- DATA_UNAVAILABLE: > 60000 ms

Tests verify that these transitions occur without a new tick. Tests also verify that overdue pending entries can terminate as FEED_STALE and overdue pending results as DATA_UNAVAILABLE.

## v1.3.0 real-session regression

Source dataset:

- 692 ticks
- 140 decisions
- 0 signals under v1.3.0 because source was INFERRED

Replayed under v1.4.0 registry semantics:

- 692 ticks VERIFIED by `POCKET_OPTION_API_US_SOUTH_PO_MARKET_STREAM_2026_09_12_V1`
- 140 decisions
- 18 CALL/PUT decisions
- 15 CALL
- 3 PUT
- 15 signals from 5s decisions
- 3 signals from 10s decisions
- 18 entry resolutions, all resolved
- 6 resolved directional results
- 12 unresolved results with `DATA_UNAVAILABLE`
- 2 / 6 directional results correct (33.33% descriptive accuracy)
- economic sample 0
- export operational state DATA_UNAVAILABLE
- latest tick age at export 243836 ms

The directional sample is too small for strategy acceptance and must not be interpreted as evidence of profitability.

## Payout integrity

`chafor` protocol/value shape is verified on the registered hosts, but its captured payload does not bind a payout to an expiration duration. Release 1.4.0 records:

```text
expirationBinding = UNBOUND
expirationSeconds = null
```

Economic evaluation therefore remains fail-closed.

## Safety

No auto-trading, auto-click, broker order submission or realized-P&L path exists.
