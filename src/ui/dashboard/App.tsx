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

export default function App() {
  const { analytics } = useJournal('ALL');
  
  return (
    <div className="app">
      <h1>Dashboard Inicializado</h1>
      <p>Decisões tomadas: {analytics.decisionCount}</p>
    </div>
  );
}
