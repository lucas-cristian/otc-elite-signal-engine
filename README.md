# OTC Elite Signal Engine

OTC Elite Signal Engine is a signal-only quantitative research extension for Chrome Manifest V3. It observes Pocket Option OTC reference-feed market data, builds causal market state, evaluates versioned strategies, journals every decision, resolves reference entries/results, exports scientific datasets, and supports deterministic replay.

## Safety boundary

The extension never clicks CALL/PUT, never sends orders, never executes trades, and never represents reference-feed outcomes as realized P&L. It is designed for DEMO-only protocol validation and signal research.

`protocolSchemaVerified` defaults to `false`. Until the production WebSocket schemas are empirically verified against Pocket Option DEMO, source quality is `INFERRED` and the Decision Engine blocks CALL/PUT with `UNVERIFIED_SOURCE_SCHEMA`.

## Architecture

```text
Pocket Option WebSocket
        ↓
MAIN World WebSocket interceptor
        ↓
Strict versioned protocol parser
        ↓
Semantic market event only
        ↓
ISOLATED World runtime validation + sequencing + batching
        ↓
Service Worker QuantPipeline
        ├── append-only IndexedDB journal
        ├── 5s / 10s / 15s / 30s / 60s candles
        ├── causal Feature Engine
        ├── Structure + Volatility regime detection
        ├── independent strategies
        ├── capped evidence aggregation
        ├── Decision → Entry → Signal → Result
        ├── durable recovery
        ├── reference-feed analytics
        └── scientific dataset export / replay
```

## Protocol modes

### PRODUCTION

Only strict, recognized Socket.IO schemas are accepted. Unknown events and unknown structures are rejected. Raw frames never cross the MAIN → ISOLATED production boundary.

### PROTOCOL_DISCOVERY

Opt-in discovery emits metadata only and is kept in a bounded in-memory ring in the Service Worker. It is not persisted by default. Discovery mode does not create market ticks or trading signals.

## Scientific time model

Every tick preserves separate clock domains:

- `sourceTimestampEpochMs`
- `receivedAtEpochMs`
- `receivedAtMonotonicMs`
- `eventTimestampEpochMs`
- `timestampBasis`
- `observedTimestampDeltaMs`
- `transportLatencyMs = null` unless clock synchronization is actually established

No subtraction between `performance.now()` and epoch timestamps is treated as latency.

## Quantitative engine

The Feature Engine includes momentum, velocity, acceleration, volatility, candle anatomy, rejection, persistence, tick imbalance, directional sequences, distance, compression, expansion, trend strength, final-seconds behavior, RSI Wilder, EMA, ATR true range, Stochastic, and Bollinger z-score.

Classical indicators are auxiliary features, not standalone strategies. Insufficient warmup returns `null`. Flat RSI after warmup returns `50`.

Strategies are independent and regime-aware:

- Momentum
- Reversal
- Exhaustion
- Breakout
- Rejection

Correlated evidence is grouped into capped evidence families. `modelScore` is not a probability. `calibratedProbability` is always `null` until a valid OOS calibration process exists.

## Journal and recovery

IndexedDB stores immutable scientific records. Pending work is reconstructed after a Manifest V3 Service Worker restart by set difference:

```text
pending entries = CALL/PUT decisions − decisions with EntryResolutionRecord
pending results = signals − signals with ResultRecord
```

In-memory maps are runtime caches only.

## Result semantics

The V1 evaluation mode is `REFERENCE_FEED`.

- `CORRECT` / `INCORRECT` / `FLAT` are directional reference outcomes.
- `Reference Return` is an estimated reference-feed economic metric.
- A flat price does not become `REFUND` unless platform settlement is factually verified.
- Missing payout produces `economicReturn = null`.
- The dashboard never labels the metric as realized or guaranteed profit.

## Replay and export

Scientific exports contain a versioned manifest, dataset ID, build/app metadata, config hashes, payout snapshots, ticks, candles, decisions, entry resolutions, decision/signal links, signals, results, and SHA-256 checksum.

Replay validates the checksum and feeds recorded ticks one-by-one through the same `QuantPipeline` used in live mode. Deterministic scientific IDs are reproduced by the test suite.

## Development

Requirements: Node.js 20+ and TypeScript 5.8.x.

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate:manifest
```

Or run the complete gate:

```bash
npm run verify
```

## Load in Chrome

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Choose **Load unpacked**.
5. Select the generated `dist/` directory.
6. Open Pocket Option using a DEMO account only.
7. Keep `PROTOCOL_DISCOVERY` for schema investigation until the schema is verified.
8. Do not mark `protocolSchemaVerified` true without recorded DEMO evidence for the exact parser schema/version.

## Current validation status

Sandbox verification completed on 2026-09-12:

- TypeScript strict typecheck: passing
- Unit/invariant tests: passing
- Build: passing
- Manifest validation: passing
- Static scan for `any`, `Math.random()`, mock placeholders, TODO/FIXME and old M1/M5/M15 timeframes: clean
- Authenticated Pocket Option DEMO runtime/DevTools validation: not executable in the current chat sandbox

The final external acceptance step is therefore protocol verification in Pocket Option DEMO. The code intentionally fails closed until that evidence exists.
