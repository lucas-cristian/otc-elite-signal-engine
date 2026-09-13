> **Historical protocol v2 — superseded by `phase4_protocol_v3.md`. Experiment `P4-EURUSDOTC-V182-002` is retained but technically invalidated after the fixed-N boundary audit.**

# Phase 4 — Prospective Statistical Validation Protocol v2

Status: implementation hardened after independent pre-freeze audit. The previous experiment `P4-EURUSDOTC-V182-001` is retained as historical evidence and is technically invalidated because the Phase 4 validation authority itself was not cryptographically frozen. Its observed 3/10 outcome must not be erased or reused as confirmatory evidence.

## Frozen scientific authority

- Signal-engine baseline application: `1.8.2`
- Signal-engine baseline Git commit: `386e83db0a44832c589080b9f7be9215d6a057a4`
- Frozen scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- New confirmatory experiment: `P4-EURUSDOTC-V182-002`
- Protocol version: `2`
- Dataset schema: `10`
- The complete executable source-tree SHA-256, Phase 4 validation authority SHA-256, and this protocol SHA-256 are frozen in build metadata and in the experiment record.

## Prospective boundary

The experiment is not active until the user explicitly selects **Start / Freeze Phase 4**. The start operation records the prospective timestamp, clean Git build identity, scientific-core hash, validation-authority hash, protocol hash, and the current strategy configuration hash. No outcome whose signal predates that timestamp is confirmatory.

## Primary endpoint

- Canonical asset: `EURUSDOTC`
- Expiration: 60 seconds
- Endpoint: STRICT reference-feed directional accuracy
- STRICT settlement timing: `0 <= expiryTimingErrorMs <= 1000`
- FLAT outcomes are excluded from the binary directional denominator and reported explicitly.
- Results must pass semantic linkage checks across decision, resolved entry, signal, expected expiry, result, feed epoch, market episode, direction, and market-source identity.

## Confirmatory hypothesis and fixed-N rule

- H0: `p <= 0.50`
- H1: `p > 0.50`
- Target: 500 unique eligible market episodes
- Alpha: 0.01
- Primary test: exact one-sided binomial test against p0 = 0.50
- Supporting confirmatory interval: Wilson 99%
- No PASS is possible before n = 500.
- After the fixed confirmatory sample is evaluated, later episodes do not alter the confirmatory sample.
- A late-arriving eligible episode that belongs chronologically before the frozen 500th-sample cutoff invalidates the experiment rather than silently changing the sample.

## PASS rule

PASS requires all of the following at n = 500:

1. exact one-sided binomial p-value < 0.01;
2. Wilson 99% lower bound > 0.50;
3. integrity gate PASS;
4. stability gate PASS.

Stability gate v1 uses five consecutive chronological blocks of 100 episodes. At least four blocks must have accuracy >= 0.50 and no complete block may have accuracy below 0.45.

## Provenance and import policy

Every confirmatory scientific dataset must:

- use dataset schema 10;
- have a valid canonical body checksum and dataset ID;
- come from `gitProvenance = GIT`;
- have `gitWorkingTreeClean = true` at build time;
- match the frozen complete source-tree SHA-256;
- match the frozen scientific-core SHA-256;
- match the frozen Phase 4 validation-authority SHA-256;
- match the frozen Phase 4 protocol SHA-256;
- contain the frozen strategy configuration hash;
- pass semantic uniqueness and manifest/body consistency checks.

Datasets or live builds that violate the frozen authority are rejected or invalidate the experiment fail-closed.

## Secondary and exploratory analyses

Timeframe, direction, structure regime, volatility regime, and contributing strategy slices are secondary/exploratory. Contributor samples overlap and must not be summed. They must not alter the frozen strategy during the confirmatory experiment.

## Economic separation

Directional validation is not realized P&L. Economic validation remains unavailable while payout is not VERIFIED and explicitly bound to the signal expiration. `PAYOUT_EXPIRATION_UNBOUND` remains fail-closed.

## Evidence preservation

Phase 4 exports a canonical evidence bundle containing the experiment, deterministic report, accepted episodes, imported-dataset records, exclusions, append-only audit events, and evaluations. The bundle carries a body checksum and canonical evidence-bundle ID.
