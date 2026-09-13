# Phase 4 — Prospective Statistical Validation Protocol v3

Status: hardened after the fixed-N boundary audit. The previous experiments remain permanent historical evidence and are not reused as confirmatory data:

- `P4-EURUSDOTC-V182-001`: 10 accepted episodes, 3 correct, 7 incorrect, 30.00%, invalidated because the validation authority was not fully frozen.
- `P4-EURUSDOTC-V182-002`: 10 accepted episodes, 4 correct, 6 incorrect, 40.00%, invalidated because a batch crossing the fixed-N boundary could persist more than 500 accepted episodes.

The new confirmatory experiment is `P4-EURUSDOTC-V182-003`.

## Frozen scientific authority

- Signal-engine baseline application: `1.8.2`
- Signal-engine baseline Git commit: `386e83db0a44832c589080b9f7be9215d6a057a4`
- Frozen scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- Protocol version: `3`
- Dataset schema: `10`
- The complete executable source-tree SHA-256, Phase 4 validation-authority SHA-256, and this protocol SHA-256 are frozen in build metadata and in the experiment record.

## Prospective boundary

The experiment is not active until the user explicitly selects **Start / Freeze Phase 4**. The start operation records the prospective timestamp, clean Git build identity, exact Git commit, scientific-core hash, validation-authority hash, protocol hash, and current strategy configuration hash. No outcome whose signal predates that timestamp is confirmatory.

## Primary endpoint

- Canonical asset: `EURUSDOTC`
- Expiration: 60 seconds
- Endpoint: STRICT reference-feed directional accuracy
- STRICT settlement timing: `0 <= expiryTimingErrorMs <= 1000`
- FLAT outcomes are excluded from the binary directional denominator and reported explicitly.
- Results must pass semantic linkage checks across decision, resolved entry, signal, expected expiry, result, feed epoch, market episode, direction, and market-source identity.
- Entry and exit settlement evidence must be anchored to VERIFIED/VALID raw ticks from the same scientific dataset or live journal. The entry uses the recorded `entryTickId`; the exit must match raw tick source identity, page session, event timestamp, and price.

## Confirmatory hypothesis and fixed-N rule

- H0: `p <= 0.50`
- H1: `p > 0.50`
- Target: exactly 500 unique eligible market episodes
- Alpha: 0.01
- Primary test: exact one-sided binomial test against p0 = 0.50
- Supporting confirmatory interval: Wilson 99%
- No PASS is possible before n = 500.
- Accepted confirmatory storage is hard-capped at 500 episodes.
- If a sync/import crosses the boundary, eligible candidates are chronologically ordered and only the earliest remaining slots are accepted.
- All later eligible episodes are recorded as `POST_CONFIRMATORY_PERIOD`; they cannot alter n, Wilson intervals, p-values, stability blocks, subgroup summaries, or the evidence bundle's accepted sample.
- After the fixed confirmatory sample is evaluated, a late-arriving eligible episode that belongs chronologically before or at the frozen 500th-sample cutoff invalidates the experiment rather than silently replacing an observation.

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
- match the exact frozen Git commit;
- match the frozen complete source-tree SHA-256;
- match the frozen scientific-core SHA-256;
- match the frozen Phase 4 validation-authority SHA-256;
- match the frozen Phase 4 protocol SHA-256;
- contain the frozen strategy configuration hash;
- pass semantic uniqueness and manifest/body consistency checks;
- pass raw-tick anchoring for every otherwise eligible resolved episode.

Datasets or live builds that violate the frozen authority are rejected or invalidate the experiment fail-closed.

The current architecture does not claim an external asymmetric-signature trust root. Authenticity beyond the frozen clean Git build and content-addressed evidence requires separately managed signing keys or an external attestation service; the laboratory must not label self-contained hashes as digital signatures.

## Historical evidence preservation

The known invalidated summaries for `P4-EURUSDOTC-V182-001` and `P4-EURUSDOTC-V182-002` are embedded in the frozen Phase 4 authority and therefore remain visible in reports/evidence bundles even after a fresh extension repository/IndexedDB. If richer local append-only history exists, it is merged without erasing the built-in record.

## Secondary and exploratory analyses

Timeframe, direction, structure regime, volatility regime, and contributing strategy slices are secondary/exploratory. Contributor samples overlap and must not be summed. They must not alter the frozen strategy during the confirmatory experiment.

## Economic separation

Directional validation is not realized P&L. Economic validation remains unavailable while payout is not VERIFIED and explicitly bound to the signal expiration. `PAYOUT_EXPIRATION_UNBOUND` remains fail-closed.

## Evidence preservation

Phase 4 exports a canonical evidence bundle containing the experiment, deterministic report, accepted confirmatory episodes (never more than 500), imported-dataset records, exclusions, append-only audit events, and evaluations. The bundle carries a body checksum and canonical evidence-bundle ID.
