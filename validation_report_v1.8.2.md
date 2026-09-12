# OTC Elite Signal Engine v1.8.2 — Validation Report

## Scope

Version 1.8.2 is an infrastructure-integrity patch. It does not tune strategy weights, evidence thresholds, the 60-second signal expiration, payout eligibility, or the 15-second feed-continuity boundary.

Implemented changes:

- contextual PAGE → SHADOW primary handoff classification without a fixed 250 ms cutoff;
- semantic cross-transport tick dedupe remains exact and fail-closed;
- STRICT directional settlement analytics for `expiryTimingErrorMs <= 1000 ms`;
- RELAXED directional settlement analytics for `expiryTimingErrorMs <= 5000 ms`;
- separate Wilson intervals and timeframe/strategy performance slices for STRICT and RELAXED samples;
- dashboard build provenance telemetry;
- scientific dataset export blocked when the loaded build has no Git commit provenance;
- IndexedDB v11 to prevent mixing v1.8.1 and v1.8.2 frozen configurations.

## Regression against the supplied v1.8.1 dataset

Input dataset identity:

- app version: 1.8.1
- ticks: 2,972
- decisions: 609
- signals: 19
- resolved directional outcomes: 18
- original page → shadow handoff gap: 429 ms

Contextual handoff validation:

- the 429 ms PAGE → SHADOW takeover is classified as `PRIMARY_TRANSPORT_HANDOFF`;
- it remains inside the same feed epoch;
- reverse SHADOW → PAGE transitions remain reconnect evidence;
- exact same-market-event page/shadow duplicates are still deduplicated.

Settlement-timing analytics on the original resolved results:

```text
STRICT (<= 1000 ms)
resolved directional sample: 17
correct: 10
accuracy: 58.82%
Wilson 95%: 36.01% .. 78.39%

RELAXED (<= 5000 ms)
resolved directional sample: 18
correct: 10
accuracy: 55.56%
Wilson 95%: 33.72% .. 75.44%
```

The 4,632 ms result remains preserved in the dataset but does not contribute to the STRICT sample.

## Build provenance behavior

A build created outside a Git checkout is intentionally marked `UNAVAILABLE`. Such a build may run for diagnostic purposes, but v1.8.2 refuses scientific dataset export.

Inside the repository, `npm run verify` must produce build metadata with a concrete Git commit. The validation gate fails if Git is detected but `dist/build-metadata.json` does not match the current `HEAD`.

## Validation gates

```text
TypeScript strict: PASS
Tests: 40/40 PASS
Build MV3: PASS
Build metadata validation: PASS
Manifest validation: PASS
```

## Frozen versions

```text
Application:                 1.8.2
Dataset schema:              8
FeedContinuityEvent schema:  3
Capture transport schema:    4
Transport event schema:      3
IndexedDB:                   11
Protocol registry:           2026-09-12.1
```
