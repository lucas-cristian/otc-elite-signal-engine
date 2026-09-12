# OTC Elite Signal Engine v1.8.1 — Validation Report

## Scope

Version 1.8.1 is a narrow integrity patch. Strategy thresholds, evidence families, payout fail-closed rules, and the 15-second scientific continuity threshold are unchanged.

## Corrected findings

- Exact page/shadow duplicate at primary handoff is now deduplicated before journal/candle/feature ingestion.
- A lossless PAGE ↔ SHADOW takeover under 250 ms with no preceding connection-loss signal is recorded as `PRIMARY_TRANSPORT_HANDOFF`, not `SHORT_RECONNECT_GAP`.
- Lossless handoff does not mark boundary candles `GAP_AFFECTED`.
- Genuine short reconnects continue to preserve the feed epoch while marking only affected candle boundaries.
- Build provenance searches npm `INIT_CWD`, `PWD`, and process `cwd`.
- `npm run verify` validates `dist/build-metadata.json`; when executed inside a Git checkout, provenance must be `GIT` and `gitCommit` must equal current `HEAD`.

## Real dataset regression

Input dataset: `otc-elite-dataset-8d1bded62e09.json` (v1.8.0).

Reprocessed through v1.8.1 quantitative pipeline:

```text
Input ticks:                 2903
Unique replay ticks:         2902
Removed semantic duplicate:     1
Feed epochs:                    1
PRIMARY_TRANSPORT_HANDOFF:      1
SHORT_RECONNECT_GAP:            2
Decisions:                    579
Signals:                       16
Results:                       16
```

The removed record is the observed market event with the same source timestamp and price arriving through `ws-3` and `shadow-main-1` one millisecond apart during the initial transport takeover.

## Validation gates

```text
TypeScript strict:          PASS
Tests:                      38/38 PASS
Build MV3:                  PASS
Build metadata validation:  PASS
Manifest validation:        PASS
```

Static scan after final source changes:

```text
explicit any:             0
Math.random():            0
TODO/FIXME:               0
openOrder in src:         0
content-script setTimeout:0
```

## Versions

```text
Application:                 1.8.1
Dataset schema:              8
Feed continuity event:       3
IndexedDB:                   10
Protocol registry:           2026-09-12.1
```

The prebuilt sandbox artifact has no `.git`, so its build metadata correctly reports `gitProvenance: UNAVAILABLE`. Running `npm run verify` inside the user's Git checkout is required to regenerate `dist/build-metadata.json` with `gitProvenance: GIT` and the local `HEAD`.
