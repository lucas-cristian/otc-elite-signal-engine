# OTC Elite Signal Engine — Protocol Remediation Report

Date: 2026-09-12
Previous main release: 4038efb — scientific remediation 1.1.0
Sandbox release: 1.5.0

## Evidence received

A Chrome DevTools Protocol capture contained 24 Pocket Option WebSocket observations, 3046 received frames and 162 sent frames across DEMO and REAL sessions. Authentication text frames were redacted by the capture script. The raw capture must remain private because binary attachments can contain account state.

The DEMO market protocol was isolated and sanitized before analysis.

## Confirmed root causes of the zero dashboard

1. Production price data uses Socket.IO binary events (`451-` + binary attachment), while release 1.1.0 parsed only textual `42[...]` price packets.
2. Raw-frame sequence numbers were incremented before semantic parsing, so ignored frames created permanent gaps in the ISOLATED sequencer.
3. The Pocket Option source clock in the capture was approximately two hours ahead of the browser clock; release 1.1.0 treated offsets greater than 60 seconds as suspect and discarded those ticks.
4. Payout arrives through the independent `chafor` event rather than inside `updateStream`.
5. The same WebSocket also carries non-OTC instruments, which must not be mislabeled as OTC.

## Corrections implemented

- Added stateful Socket.IO binary-event decoding for one-attachment `451-` frames.
- Serialized inbound Blob/ArrayBuffer processing per WebSocket to preserve wire order.
- Added strict `updateStream` parser for `[[asset, sourceTimestampSeconds, price]]`.
- Added strict `chafor` parser for `[[asset, payoutPercent]]`.
- Consumed `updateHistoryNewFast` without generating retrospective live decisions.
- Moved semantic sequence assignment after successful semantic parsing.
- Restricted the OTC pipeline to assets ending `_otc`.
- Added feed host to source identity.
- Scoped `VERIFIED` to the exact observed `demo-api-eu.po.market` schemas; matching REAL endpoints remain `INFERRED`.
- Added Tick schema v3 with per-tick source quality and explicit `sourceClockSynchronized`.
- Switched event time to `LOCAL_RECEIPT` while preserving source timestamp and observed offset.
- Removed the false `SUSPECT` classification caused solely by an unsynchronized stable source-clock offset.
- Separated payout from price processing.
- Set captured payout `expirationSeconds` to null because `chafor` does not provide expiry scope.
- Keyed payout state by asset + feed.
- Updated replay to interleave payout and tick events chronologically.
- Bumped IndexedDB to version 3 to prevent legacy schema mixing.
- Fixed PageBridge mode initialization ordering.

## Validation

- TypeScript strict typecheck: PASS
- Unit/invariant tests: 18/18 PASS
- Raw captured DEMO decoder replay: 234 price events, 24 payout events
- Quantitative captured DEMO integration: 234 ticks, 64 candles, 54 decisions, 4 signals, 2 results within the capture window
- Captured tick integrity: VALID
- Captured timestamp basis: LOCAL_RECEIPT
- Captured source quality: VERIFIED
- REAL endpoint parser quality regression: INFERRED

## Safety boundary

No order event from the raw capture is consumed by the signal engine. Balance, authentication, opened-deal, closed-deal and order events are ignored by production semantics.

No auto-trading, auto-click, CALL/PUT click, broker order submission or realized-P&L path exists.

Do not commit the original raw WebSocket capture. Only sanitized DEMO market fixtures may be used for regression documentation or tests.

## Release 1.3.0 follow-up

A real v1.2.0 scientific dataset with 440 ticks, 92 decisions, 17 signals and 17 result records exposed an economic-evaluation integrity issue: the captured `chafor` payout snapshots had `expirationSeconds = null`, yet reference economic returns were still being computed.

Release 1.3.0 fixes this by requiring a VERIFIED payout explicitly bound to the same expiration as the signal before any WIN/LOSS or economic return is produced. Result schema v3 records the reason when economic evaluation is ineligible. The real dataset replays to 8 resolved directional outcomes at 50% accuracy, while economic sample size is correctly 0 and mean economic return is null. Nine timeout results are reproduced by finalizing replay through dataset creation time.

Build metadata now includes a deterministic source-tree hash and records the Git SHA only when a build begins from a clean Git checkout. Dashboard telemetry was expanded and cross-origin `postMessage` calls are suppressed for opaque origins. IndexedDB was bumped to version 4 to prevent old economic result semantics from contaminating the new release.

## Release 1.4.0 follow-up

The v1.3.0 dataset exported from a REAL Pocket Option session contained 692 ticks, 140 decisions and zero signals because every observation from `api-us-south.po.market` was structurally parsed but tagged `INFERRED`. The same export also showed a latest-tick age greater than four minutes while the latest historical decision still displayed `HEALTHY`.

Release 1.4.0 replaces hostname-only verification with a frozen Protocol Verification Registry. Exact captured `updateStream` and `chafor` schemas for `demo-api-eu.po.market`, `api-us-north.po.market` and `api-us-south.po.market` are registered by host + event + parser schema + payload shape. Any unregistered host remains `INFERRED`. The registry version is included in the quantitative config hash.

A wall-clock data-health watchdog now transitions through `HEALTHY`, `DEGRADED`, `STALE` and `DATA_UNAVAILABLE` without requiring a new tick. Dashboard refresh, dataset export and a Manifest V3 alarm drive the watchdog. Pending entries/results are finalized with feed-health-aware unresolved reasons.

PayoutSnapshot v3 adds explicit `expirationBinding`. Captured `chafor` payout is `VERIFIED` at the protocol level but remains `UNBOUND` with `expirationSeconds = null`, so it remains ineligible for economic evaluation.

Regression of the v1.3.0 692-tick dataset under the v1.4.0 frozen registry produces 18 CALL/PUT decisions (15 CALL, 3 PUT), 18 resolved entries and 18 signals without lowering the 0.35 score threshold. Six directional results resolve before the feed ends; twelve are finalized as `DATA_UNAVAILABLE`. Economic sample remains zero. At dataset creation, the reconstructed health is `DATA_UNAVAILABLE` with a latest-tick age of 243836 ms.

Raw-capture decoder validation after exact duplicate removal confirms VERIFIED semantic output for all registry hosts: DEMO EU 234 price/24 payout, REAL US North 38/2, and REAL US South 127/6.


## Release 1.5.0 remediation

The hidden-tab stall was traced to a timer-dependent batch flush in the content script. The production route now uses `chrome.runtime.Port` plus `queueMicrotask`, disables automatic discard on the source tab where supported, and exposes lifecycle/freeze telemetry. Chrome can freeze a background tab entirely; the extension does not fake continuity in that case and the asset/feed watchdog transitions to STALE/DATA_UNAVAILABLE.

The global health model was replaced with per `(asset, feed)` health, candles are feed-scoped, and result timeouts use the specific signal source. Multi-timeframe and overlapping candidates are arbitrated into independent market episodes; only one PRIMARY decision can create a signal.
