# Phase 4 — Prospective Statistical Validation Protocol v4

Status: hardened after the exit-tick quality and temporal-dependence audit. Previous confirmatory attempts are permanent historical evidence and are never reused as confirmatory data:

- `P4-EURUSDOTC-V182-001`: 10 accepted episodes, 3 correct, 7 incorrect, 30.00%, invalidated because the validation authority was not fully frozen.
- `P4-EURUSDOTC-V182-002`: 10 accepted episodes, 4 correct, 6 incorrect, 40.00%, invalidated because a batch crossing the fixed-N boundary could persist more than 500 accepted episodes.
- `P4-EURUSDOTC-V182-003`: 10 accepted episodes, 7 correct, 3 incorrect, 70.00%, invalidated because exit raw-tick quality (`VERIFIED` + `VALID` + protocol verification ID) was not enforced by the Phase 4 validator even though the observed 10 exits themselves passed those conditions.

The new confirmatory experiment is `P4-EURUSDOTC-V182-004`.

## Frozen scientific authority

- Signal-engine baseline application: `1.8.2`
- Signal-engine baseline Git commit: `386e83db0a44832c589080b9f7be9215d6a057a4`
- Frozen scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- Protocol version: `4`
- Dataset schema: `10`
- The complete executable source-tree SHA-256, Phase 4 validation-authority SHA-256, and this protocol SHA-256 are frozen in build metadata and the experiment record.

## Prospective boundary and start attestation

The experiment is inactive until **Start / Freeze Phase 4** is selected. The start operation records the prospective timestamp, clean Git build identity, exact Git commit, scientific-core hash, validation-authority hash, protocol hash, current strategy configuration hash, and all confirmatory rules.

At start, the authority also creates an immutable canonical `Phase4StartAttestation` with its own content-addressed `attestationId`. The attestation is not an external digital signature. The operator must export it immediately and preserve the JSON and/or its SHA-256 in an external location controlled independently from extension IndexedDB (for example an audit repository, append-only object store, or independently timestamped record). Loss or reset of local browser storage must never be used to redefine the prospective boundary.

No outcome whose signal predates `prospectiveStartedAt` is confirmatory.

## Primary endpoint

- Canonical asset: `EURUSDOTC`
- Expiration: 60 seconds
- Endpoint: STRICT reference-feed directional accuracy
- STRICT settlement timing: `0 <= expiryTimingErrorMs <= 1000`
- FLAT outcomes are excluded from the binary directional denominator and reported explicitly.
- Results must pass semantic linkage checks across decision, resolved entry, signal, expected expiry, result, feed epoch, market episode, direction, and market-source identity.
- Entry and exit evidence must be anchored to raw ticks from the same live journal or imported dataset.
- **Both entry and exit raw ticks must satisfy all three conditions:** `integrity = VALID`, `sourceQuality = VERIFIED`, and non-null `protocolVerificationId`.
- The entry uses the exact recorded `entryTickId`; the exit must match source identity, page session, event timestamp, and price **and** must reproduce the stored resolved `resultId` when that raw tick's `tickId` is used in the canonical result hash. This binds the result to one exact raw exit tick before the quality gate is evaluated.

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
- All later eligible episodes are recorded as `POST_CONFIRMATORY_PERIOD`; they cannot alter confirmatory statistics or evidence.
- After evaluation, a late-arriving eligible episode that belongs chronologically before or at the frozen 500th-sample cutoff invalidates the experiment rather than silently replacing an observation.

## Temporal diversity gate v1

A fixed sample collected in one short market window is not sufficient for PASS.

- Minimum distinct UTC dates in the 500 accepted episodes: **10**.
- Maximum accepted confirmatory episodes from any one UTC date: **50**.
- Once 50 eligible episodes have been accepted for a UTC date, later otherwise-eligible episodes from that date are excluded as `TEMPORAL_DAILY_CAP_REACHED` and do not consume one of the 500 confirmatory slots.
- At n = 500, temporal diversity must PASS.

The 50-per-date cap mathematically forces the 500-episode confirmatory sample to span at least 10 distinct UTC dates.

## Dependence sensitivity gate v1

The exact binomial test and Wilson interval remain the frozen primary directional statistics; Phase 4 does **not** claim that market episodes are proven IID.

As a deterministic cluster-sensitivity safeguard, episodes are clustered by UTC date. At n = 500, the system removes each UTC-date cluster in turn and recomputes directional accuracy on the remaining sample. The dependence sensitivity gate passes only if:

1. the temporal-diversity gate passes; and
2. every leave-one-UTC-date-out sample has a **Wilson 95% lower bound strictly greater than 0.50**.

This is a conservative sensitivity/influence gate, not a replacement p-value and not a proof of independence. It prevents one UTC date from being solely responsible for a claimed directional edge.

## PASS rule

PASS requires all of the following at n = 500:

1. exact one-sided binomial p-value < 0.01;
2. Wilson 99% lower bound > 0.50;
3. integrity gate PASS;
4. five-block stability gate PASS;
5. temporal diversity gate PASS;
6. dependence sensitivity gate PASS.

## Stability gate v1

The 500 confirmatory episodes are split chronologically into five blocks of 100. At least four complete blocks must have accuracy >= 0.50 and no complete block may have accuracy below 0.45.

## Provenance and import policy

Every confirmatory dataset must:

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
- pass VERIFIED/VALID/protocol-ID raw-tick anchoring for every otherwise eligible resolved episode.

Datasets or live builds that violate the frozen authority are rejected or invalidate the experiment fail-closed.

Self-contained hashes are content-integrity mechanisms, not asymmetric signatures. The laboratory must not label them as third-party authentication.

## Historical evidence preservation

Known invalidated summaries for `P4-EURUSDOTC-V182-001`, `P4-EURUSDOTC-V182-002`, and `P4-EURUSDOTC-V182-003` are embedded in the frozen authority. They remain visible in reports/evidence bundles even after a fresh extension database. Richer append-only local history is merged without erasing the built-in record.

## Secondary and exploratory analyses

Timeframe, direction, structure regime, volatility regime, contributing-strategy slices, per-date slices, and leave-one-date-out sensitivity diagnostics are secondary/supporting analyses. Contributor samples overlap and must not be summed. None of these diagnostics may be used to tune the frozen strategy during the confirmatory experiment.

## Economic separation

Directional validation is not realized P&L. Economic validation remains unavailable while payout is not VERIFIED and explicitly bound to the signal expiration. `PAYOUT_EXPIRATION_UNBOUND` remains fail-closed.

## Evidence preservation

Phase 4 exports a canonical evidence bundle containing the start attestation, experiment, deterministic report, accepted confirmatory episodes (never more than 500), imported-dataset records, exclusions, append-only audit events, and evaluations. The bundle carries a body checksum and canonical evidence-bundle ID.
