# OTC Elite Signal Engine v1.9.3 — Phase 4 Protocol v4 Validation Report

## Scope

This release hardens only the Phase 4 prospective scientific-validation authority. The frozen v1.8.2 signal/evaluation scientific core remains unchanged and must retain SHA-256:

`ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`

The previous confirmatory attempt `P4-EURUSDOTC-V182-003` is preserved as technically invalidated historical evidence: 10 accepted episodes, 7 correct, 3 incorrect, 70.00%, reason `EXIT_RAW_TICK_QUALITY_NOT_ENFORCED`. Its outcomes are not reused.

The replacement confirmatory experiment is `P4-EURUSDOTC-V182-004` under protocol v4.

## Remediations implemented

1. **Exact exit raw-tick binding and quality gate**
   - The stored resolved `resultId` must be reproducible from one exact raw exit `tickId`, signal ID, exit timestamp and exit price.
   - Entry and exit raw ticks must each be `integrity=VALID`, `sourceQuality=VERIFIED`, and have a non-null `protocolVerificationId`.
   - A VERIFIED duplicate with the same timestamp/price cannot launder a result generated from an INFERRED raw tick because the result ID binds the exact tick ID.

2. **Temporal-diversity gate**
   - Fixed confirmatory target remains exactly 500 eligible episodes.
   - No more than 50 accepted confirmatory episodes may come from one UTC date.
   - At least 10 distinct UTC dates are therefore required before 500 can be reached.
   - Additional otherwise-eligible episodes from a saturated UTC date are excluded as `TEMPORAL_DAILY_CAP_REACHED`.

3. **Dependence-sensitivity gate**
   - Episodes are clustered by UTC date.
   - At n=500, each UTC-date cluster is removed in turn.
   - Every leave-one-UTC-date-out sample must retain a Wilson 95% lower bound strictly above 0.50.
   - This is a deterministic influence/sensitivity requirement, not a replacement p-value and not a claim that observations are IID.

4. **Start attestation**
   - `Start / Freeze Phase 4` creates an immutable canonical Phase 4 start attestation containing the prospective boundary, exact Git commit, source-tree hash, core/authority/protocol hashes, config hash, and frozen confirmatory rules.
   - The dashboard can export the attestation separately and automatically exports it after a successful start.
   - The attestation explicitly requires external preservation and is included in evidence bundle schema v2.
   - The hash is content integrity, not an asymmetric third-party signature.

5. **Historical evidence preservation**
   - P4-001, P4-002 and P4-003 summaries are embedded in the frozen authority and remain visible after a fresh Phase 4 IndexedDB.

## Frozen identities

- Application: `1.9.3`
- Dataset schema: `10`
- Protocol version: `4`
- New experiment: `P4-EURUSDOTC-V182-004`
- Expected source-tree SHA-256: `565a30b2e271d0de0c7e9a642ff3f972c44c787361485d27e1d65127d128a55e`
- Phase 4 validation-authority SHA-256: `c1745008427b6f01a70929fb8bec74dd7ace42c6d0f06a05ac8aa7a06e3eb33f`
- Phase 4 protocol-v4 SHA-256: `60b25bf3df28ecb605512a316ab6fd9b9068bca1316371d05eb2370f66ec12c8`
- Frozen scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`

## Confirmatory PASS rule

PASS remains impossible before n=500 and requires all of:

- exact one-sided binomial p-value < 0.01 against p0=0.50;
- Wilson 99% lower bound > 0.50;
- integrity gate PASS;
- five-block stability gate PASS;
- temporal-diversity gate PASS;
- dependence-sensitivity gate PASS.

Economic validation remains fail-closed as `UNAVAILABLE / PAYOUT_EXPIRATION_UNBOUND` until payout is verified and explicitly bound to the signal expiration.

## Adversarial regression coverage

The Phase 4 suite now includes explicit regression tests for:

- INFERRED+VALID exit raw tick rejection;
- UNKNOWN+SUSPECT exit raw tick rejection;
- missing exit protocol-verification ID rejection;
- missing entry protocol-verification ID rejection;
- exact exit-tick/result-ID binding even when a VERIFIED duplicate anchor exists;
- recalculated schema-v10 dataset with an unverified exit tick;
- 50-per-UTC-date cap;
- 10-date temporal diversity;
- dependence-sensitivity failure when one UTC date drives the apparent edge;
- canonical start-attestation ID and external-preservation requirement;
- fixed-N overflow and import boundary invariants;
- historical P4-001/P4-002/P4-003 preservation.

## Operator requirement

Do not tune strategy weights, thresholds, timeframes, arbitration, settlement rules, or signal selection during `P4-EURUSDOTC-V182-004`. Do not rebuild the extension after the experiment is frozen. Immediately preserve the exported start-attestation JSON (or an independently computed SHA-256 of that exact file) outside extension IndexedDB.
