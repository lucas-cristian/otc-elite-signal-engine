import { Tick } from '../common/models/types';
import { parseFrame } from './frame-parser';

export interface ConnectionSequenceState {
  nextAssignedSequence: number;
  nextEmitSequence: number;
  pending: Map<number, Promise<Tick | null>>;
  draining: boolean; // Guard para evitar drenagem concorrente
}

export type TickEmitter = (tick: Tick) => void;

export class FrameSequencer {
  private connections = new Map<string, ConnectionSequenceState>();
  private readonly frameParseTimeoutMs = 500;
  private readonly emitter: TickEmitter;

  constructor(emitter: TickEmitter) {
    this.emitter = emitter;
  }

  public handleConnectionEvent(connectionId: string, event: 'OPEN' | 'CLOSE' | 'ERROR') {
    if (event === 'OPEN') {
      this.connections.set(connectionId, {
        nextAssignedSequence: 0,
        nextEmitSequence: 0,
        pending: new Map(),
        draining: false,
      });
    } else {
      // CLOSE ou ERROR
      const state = this.connections.get(connectionId);
      if (state) {
        state.pending.clear();
        this.connections.delete(connectionId);
      }
    }
  }

  public async queueFrame(connectionId: string, payloadBuffer: Uint8Array): Promise<void> {
    const state = this.connections.get(connectionId);
    if (!state) return; // Ignora frames de conexões não registradas ou fechadas

    const seq = state.nextAssignedSequence++;

    // Encapsula em um timeout para evitar deadlock por parse travado
    const parsePromise = new Promise<Tick | null>((resolve) => {
      const timer = setTimeout(() => {
        console.warn(`[FrameSequencer] Timeout no parse do frame ${seq} (conn: ${connectionId})`);
        resolve(null);
      }, this.frameParseTimeoutMs);

      parseFrame(payloadBuffer).then((tick) => {
        clearTimeout(timer);
        resolve(tick);
      }).catch((err) => {
        clearTimeout(timer);
        console.error(`[FrameSequencer] Erro no parse do frame ${seq}:`, err);
        resolve(null); // Fail-closed: avança sem emitir
      });
    });

    state.pending.set(seq, parsePromise);

    // Só inicia uma drenagem se não houver outra em andamento
    if (!state.draining) {
      this.drain(connectionId);
    }
  }

  private async drain(connectionId: string) {
    const state = this.connections.get(connectionId);
    if (!state || state.draining) return;

    state.draining = true;

    try {
      while (state.pending.has(state.nextEmitSequence)) {
        const seq = state.nextEmitSequence;
        const promise = state.pending.get(seq);

        if (!promise) break;

        const tick = await promise;
        state.pending.delete(seq);
        state.nextEmitSequence++;

        // Verifica se a conexão ainda está viva após o await
        if (!this.connections.has(connectionId)) break;

        if (tick) {
          this.emitter(tick);
        }
      }
    } finally {
      if (state) {
        state.draining = false;
      }
    }
  }
}
