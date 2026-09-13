# OTC Elite Signal Engine v1.9.2 — Phase 4 Fixed-N Boundary Hardening

## Scope

This release changes only the Phase 4 prospective-validation authority. The frozen v1.8.2 signal/evaluation core is not modified.

## Remediations

- Replaces confirmatory experiment `P4-EURUSDOTC-V182-002` with `P4-EURUSDOTC-V182-003`.
- Preserves P4-001 (3/10) and P4-002 (4/10) as immutable historical invalidated summaries.
- Hard-caps accepted confirmatory episodes at exactly 500.
- Chronologically orders eligible candidates when a batch/import crosses the boundary.
- Records overflow as `POST_CONFIRMATORY_PERIOD` and excludes it from every confirmatory statistic and evidence-bundle accepted sample.
- Keeps late-pre-cutoff detection fail-closed after the sample is frozen.
- Binds dataset imports to the exact frozen Git commit in addition to source-tree/core/authority/protocol hashes.
- Anchors resolved entry evidence to `entryTickId` and resolved exit evidence to an exact VERIFIED/VALID raw tick by source identity, page session, event timestamp, and price.
- Keeps self-contained hashes explicitly distinct from external digital signatures; no false signature claim is introduced.

## Required validation

`npm run verify` must pass scientific-core freeze, Phase 4 authority/protocol freeze, TypeScript, all tests, build metadata, and manifest validation.

New adversarial tests cover 495+10, 499+10, dataset-import boundary crossing, raw-tick tampering, exact Git-commit import binding, and historical-record survival after a fresh repository.
