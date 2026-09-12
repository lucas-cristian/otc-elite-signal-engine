import React, { useState, useEffect, useCallback } from 'react';
import { SignalRecord, ResultRecord } from '../../common/models/journal-types';
import { Analytics, computeAnalytics } from '../../service-worker/evaluation/metrics';
import './index.css';

const DB_NAME = 'otc_elite_journal';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function useJournal(asset: string, interval = 5000) {
  const [state, setState] = useState({
    signals: [] as SignalRecord[], 
    results: [] as ResultRecord[], 
    decisions: [] as { finalDecision: string; asset: string }[],
    analytics: computeAnalytics([], [], []),
    lastUpdated: 0, loading: true, error: null as string | null,
  });

  const load = useCallback(async () => {
    try {
      const db = await openDB();
      const allSig = await readAll<SignalRecord>(db, 'signals');
      const allRes = await readAll<ResultRecord>(db, 'results');
      const allDec = await readAll<{ finalDecision: string; asset: string }>(db, 'decisions');
      db.close();

      const sig = asset === 'ALL' ? allSig : allSig.filter(s => s.asset === asset);
      const res = asset === 'ALL' ? allRes : allRes.filter(r => allSig.find(s => s.signalId === r.signalId)?.asset === asset);
      const dec = asset === 'ALL' ? allDec : allDec.filter(d => d.asset === asset);

      setState({
        signals: sig, results: res, decisions: dec,
        analytics: computeAnalytics(sig, res, dec),
        lastUpdated: Date.now(), loading: false, error: null
      });
    } catch (e) {
      setState(p => ({ ...p, loading: false, error: String(e) }));
    }
  }, [asset]);

  useEffect(() => {
    load();
    const id = setInterval(load, interval);
    return () => clearInterval(id);
  }, [load, interval]);

  return { ...state, refresh: load };
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color: string }) {
  return (
    <div className={`stat-card ${color}`}>
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

export default function App() {
  const [asset, setAsset] = useState('ALL');
  const { signals, results, analytics, lastUpdated, loading, error, refresh } = useJournal(asset);

  const ci = analytics.directionalAccuracy;
  const wr = ci ? `${(ci.observedRate * 100).toFixed(1)}%` : '—';
  const ts = lastUpdated > 0 ? new Date(lastUpdated).toLocaleTimeString('pt-BR') : '—';

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <div className="logo-dot" />
          <h1>OTC Elite Signal Engine</h1>
          <span className="version-tag">v1.0 · REFERENCE_FEED</span>
        </div>
      </header>

      <main className="main-content">
        {error && <div className="disclaimer">⚠️ Erro IDB: {error}</div>}
        <div className="stats-row">
          <StatCard label="Decisões" value={String(analytics.decisionCount)} sub={`${analytics.callDecisionCount}↑ · ${analytics.putDecisionCount}↓`} color="blue" />
          <StatCard label="Sinais" value={String(signals.length)} sub={`${analytics.entryUnresolvedCount} não resolvidas`} color="green" />
          <StatCard label="Win Rate" value={wr} sub={`n = ${analytics.correctCount + analytics.incorrectCount}`} color="green" />
        </div>
      </main>
    </div>
  );
}
