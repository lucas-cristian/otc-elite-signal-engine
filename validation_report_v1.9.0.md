# OTC Elite Signal Engine v1.9.0 — Phase 4 Validation Report

## Scope

v1.9.0 adds a prospective statistical validation layer without changing the frozen v1.8.2 signal/evaluation core.

## Scientific freeze

- Baseline strategy commit: `386e83db0a44832c589080b9f7be9215d6a057a4`
- Scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- `npm run validate:scientific-core` prevents accidental core changes.

## Implemented

- immutable Phase 4 experiment registry;
- separate IndexedDB database (`otc-elite-phase4-validation`) so the live journal is not migrated or cleared;
- explicit prospective cutoff;
- live-journal synchronization;
- scientific dataset schema v9 with `scientificCoreSha256`;
- dataset checksum and datasetId verification before import;
- cross-dataset market-episode deduplication;
- explicit eligibility/exclusion reasons;
- exact one-sided binomial test;
- Wilson 95% and 99% intervals;
- frozen 500-episode confirmatory gate;
- five chronological 100-episode stability blocks;
- immutable confirmatory evaluation;
- append-only audit events and exclusions;
- secondary timeframe/direction/regime analyses;
- exploratory contributing-strategy slices explicitly overlapping;
- dashboard controls to start/freeze Phase 4, import datasets and export the Phase 4 report;
- economic evidence remains fail-closed.

## Automated validation

The Phase 4 test suite covers exact-binomial/Wilson vectors, prospective cutoff, STRICT 1000ms boundary, exclusion at 1001ms, FLAT exclusion, live/dataset deduplication, n<500 never PASS, synthetic 500-episode PASS, synthetic chance-level FAIL, and scientific-core mismatch invalidation.

Final verification:

- frozen scientific core validation: PASS (`ca9771c8c58a53c4…`);
- TypeScript strict typecheck: PASS;
- automated tests: **51/51 PASS**;
- MV3 build: PASS;
- build-metadata validation: PASS;
- manifest validation: PASS;
- explicit `any`: 0;
- `Math.random()`: 0;
- TODO/FIXME markers: 0;
- order-placement hooks (`openOrder`) in production `src`: 0.

The full repository verification command is `npm run verify`.
