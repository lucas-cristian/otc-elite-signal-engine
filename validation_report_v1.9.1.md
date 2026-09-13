# OTC Elite Signal Engine v1.9.1 — Phase 4 Validation-Authority Hardening

## Scope

This release does not change the frozen v1.8.2 signal/evaluation core. It remediates the independent Phase 4 audit findings discovered after the first 10 observations of `P4-EURUSDOTC-V182-001`.

## Historical preservation

`P4-EURUSDOTC-V182-001` is retained in the Phase 4 IndexedDB and is append-only invalidated with reason `VALIDATION_AUTHORITY_NOT_FULLY_FROZEN`. Its observed outcomes are preserved and excluded from the replacement confirmatory experiment.

## Replacement experiment

- Experiment: `P4-EURUSDOTC-V182-002`
- Protocol: v2
- Dataset schema: v10
- Frozen signal scientific core: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- Target: 500 independent STRICT episodes
- Alpha: 0.01
- Exact one-sided binomial test against p0 = 0.50
- Wilson 99% lower bound > 0.50
- Stability gate v1 unchanged

## Remediations

1. Cryptographic freeze of the full executable source tree, Phase 4 validation authority and protocol, enforced by `npm run validate:phase4-authority` and embedded in build metadata.
2. Runtime invalidation if scientific core, validation authority, protocol, clean-Git status, or Git provenance changes after freeze.
3. Dataset schema v10 includes the validation-authority and protocol hashes.
4. Dataset import requires `gitProvenance=GIT`, `gitWorkingTreeClean=true`, matching core/authority/protocol hashes, frozen config hash, valid checksum/dataset ID, semantic uniqueness, and manifest/body count consistency.
5. Eligibility now verifies resolved entry linkage, primary arbitration, direction/episode/feed-epoch linkage, source identity, reference timeline, non-negative STRICT timing, expected expiry arithmetic, exit timing arithmetic, and outcome semantics.
6. Repeated live synchronization no longer inflates exclusion/audit counts.
7. Fixed-N post-confirmatory observations are excluded from the primary sample; late pre-cutoff observations invalidate the experiment.
8. Phase 4 export is a canonical evidence bundle with body checksum and evidence-bundle ID.
9. Dashboard exposes validation-authority/protocol hashes and historical invalidated experiments.

## Validation gate

Run `npm run verify`. The expected gate includes the frozen scientific core, frozen Phase 4 validation authority/protocol, TypeScript strict typecheck, all automated tests, build, build-metadata validation, and manifest validation.
