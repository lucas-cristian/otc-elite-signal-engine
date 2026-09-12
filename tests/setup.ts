/**
 * Setup global para testes que usam IDB.
 * Importa IDBKeyRange e demais globals do fake-indexeddb
 * para que os testes rodem corretamente em ambiente Node.js.
 */
import 'fake-indexeddb/auto';
