# Phase 4 Protocol v4 — Operator Guide

## Before loading v1.9.3

1. Apply the v1.9.3 commit on top of the current v1.9.2 commit.
2. Run `npm run verify` from a clean Git checkout.
3. Confirm `dist/build-metadata.json` reports app `1.9.3`, clean `GIT` provenance, the expected scientific-core hash, Phase 4 authority hash and protocol-v4 hash.
4. Push the commit before starting the experiment.
5. Reload only the newly generated `dist/` in `chrome://extensions`. Never restore an older `dist` stash over it.

## Pre-freeze runtime check

Before pressing **Start / Freeze Phase 4**, confirm the dashboard shows:

- app/build from v1.9.3;
- Git provenance `GIT` and working tree clean at build time;
- feed `HEALTHY/FRESH`;
- shadow primary feed `STREAMING`;
- `P4-EURUSDOTC-V182-004` not yet started;
- historical P4-001, P4-002 and P4-003 listed as invalidated.

Export one scientific dataset for the pre-freeze audit if desired. Do not import older P4 datasets into P4-004.

## Starting P4-004

1. Press **Start / Freeze Phase 4** exactly once.
2. The extension creates `prospectiveStartedAt` and an immutable canonical start attestation.
3. The dashboard automatically downloads `phase4-P4-EURUSDOTC-V182-004-start-attestation.json`.
4. Immediately copy that exact file to an independent location outside browser/extension storage.
5. Independently compute its file SHA-256, for example on macOS:

   `shasum -a 256 phase4-P4-EURUSDOTC-V182-004-start-attestation.json`

6. Store the file and SHA-256 in an audit location that is not the running extension's IndexedDB. Prefer a separate audit repository, append-only object storage, or independently timestamped record.

The canonical `attestationId` inside the JSON is a content-addressed scientific identity. It is not an external digital signature.

## During collection

- Keep the exact v1.9.3 build loaded.
- Do not rebuild or change Git/source files and reload the extension.
- Do not tune the strategy.
- Do not alter Phase 4 thresholds or protocol.
- The accepted sample is fixed at 500.
- At most 50 accepted episodes may come from each UTC date, so collection requires at least 10 dates.
- Export Phase 4 evidence checkpoints periodically and preserve them outside the browser. A practical cadence is at the end of each UTC date or every 50 accepted episodes, whichever comes first.
- Preserve scientific datasets that correspond to those checkpoints.

If browser storage is cleared or the extension is removed in a way that destroys the active P4-004 repository, do not silently recreate P4-004 with a new start time. Treat the loss as an integrity incident and audit it before deciding whether a new experiment ID/protocol run is required.

## Final evaluation

At n=500 the system evaluates exactly the frozen 500 episodes. PASS requires:

- exact one-sided binomial p < 0.01;
- Wilson 99% lower bound > 0.50;
- integrity PASS;
- stability PASS;
- temporal diversity PASS;
- leave-one-UTC-date-out dependence sensitivity PASS (every LODO Wilson 95% lower bound > 0.50).

Directional PASS is not realized P&L. Economic validation remains unavailable while payout expiration binding is unverified/unbound.
