import { Tick } from '../common/models/types';

/**
 * Skeleton do parser de frames. A heurística cega é proibida.
 * Requer-se o conhecimento prévio de schema (parserSchemaId).
 */
export async function parseFrame(payloadBuffer: Uint8Array): Promise<Tick | null> {
  // Simulação: na Fase 2 o parse real depende do Discovery.
  // Por enquanto apenas rejeitamos, documentando o ponto de fail-closed.
  
  // Exemplo de verificação estruturada:
  const parserSchemaId = detectSchema(payloadBuffer);
  
  if (!parserSchemaId) {
    // Fail-Closed behavior
    return null;
  }

  // TODO: Parser Real na fase de discovery (Fase 2 avançada)
  return null;
}

function detectSchema(buffer: Uint8Array): string | null {
  // Discovery real não implementado, rejeita por segurança.
  return null;
}
