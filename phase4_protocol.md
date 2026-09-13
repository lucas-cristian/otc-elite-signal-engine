> **Historical protocol v1 — superseded by `phase4_protocol_v3.md`. Experiment `P4-EURUSDOTC-V182-001` is retained but technically invalidated after the validation-authority freeze audit.**

# Phase 4 — Prospective Statistical Validation Protocol

Status: implementation ready; experiment is not prospectively active until the user explicitly presses **Start / Freeze Phase 4** in the dashboard.

## Frozen scientific authority

- Signal-engine baseline application: `1.8.2`
- Baseline strategy Git commit: `386e83db0a44832c589080b9f7be9215d6a057a4`
- Frozen scientific-core SHA-256: `ca9771c8c58a53c47894d4cf0966fc10629bcd48a80ff4af1519e1842c12f1db`
- Primary asset: `EURUSDOTC`
- Expiration: `60s`
- Primary endpoint: STRICT directional accuracy
- STRICT settlement timing: `expiryTimingErrorMs <= 1000`

The Phase 4 validation layer may evolve independently, but `npm run verify` fails if the frozen signal/evaluation core changes without an explicit new baseline.

## Hypotheses and confirmatory gate

- H0: `p <= 0.50`
- H1: `p > 0.50`
- Target: first 500 unique prospective STRICT market episodes
- Primary test: exact one-sided binomial test against `p0=0.50`
- Alpha: `0.01`
- Confirmatory interval: Wilson 99%

PASS requires all of:

1. first 500 unique eligible episodes are available;
2. exact binomial `p < 0.01`;
3. Wilson 99% lower bound `> 0.50`;
4. integrity gate PASS;
5. stability gate PASS.

Before 500 episodes the status is always `COLLECTING`, never PASS.

## Stability gate V1

The first 500 confirmatory episodes are ordered chronologically and split into five blocks of 100. Stability passes only when at least four of five block accuracies are `>= 50%` and no block is below `45%`.

## Prospective boundary

Pressing **Start / Freeze Phase 4** creates immutable experiment `P4-EURUSDOTC-V182-001` and records `prospectiveStartedAt`. Results generated before that timestamp are excluded as `PRE_PROSPECTIVE_PERIOD` and never count toward the confirmatory 500.

## Eligibility

A primary episode must be unique by `experimentId + marketEpisodeId` and must match the frozen config hash, asset and expiration. It must be LIVE, source quality VERIFIED, event integrity VALID, resolved to CORRECT or INCORRECT, and have `expiryTimingErrorMs <= 1000`.

All exclusions are explicit and append-only. Imported dataset schema v9 is checksum- and datasetId-verified and must carry valid Git provenance plus the frozen scientific-core hash.

## Confirmatory immutability

Once the first 500 are evaluated, the confirmatory sample and result are immutable. A newly imported episode that should chronologically precede the frozen 500th cutoff invalidates the experiment (`LATE_PRE_CUTOFF_EPISODE`) rather than silently rewriting the result.

## Economic evidence

Phase 4 validates directional reference-feed edge only. Economic validation remains `UNAVAILABLE / PAYOUT_EXPIRATION_UNBOUND` until payout is explicitly and verifiably bound to the signal expiration.
