import type { Lifetime } from './life';
import { withDeadline } from './deadline';
let opened: Promise<IDBDatabase> | undefined;
function db() {
  return opened ??= withDeadline(new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fly-lifetime-history', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('lifetimes', { keyPath: ['lineage', 'generation'] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(Error('Lifetime archive is blocked by another tab'));
  }), 4000, 'Lifetime archive did not respond');
}
export async function archiveLifetimes(lineage: string, records: Lifetime[]) {
  const store = await db();
  await new Promise<void>((resolve, reject) => {
    const tx = store.transaction('lifetimes', 'readwrite');
    for (const record of records) tx.objectStore('lifetimes').put({ lineage, ...record });
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function readLifetimes(lineage: string, before = Number.MAX_SAFE_INTEGER, limit = 100): Promise<Lifetime[]> {
  const store = await db();
  return new Promise((resolve, reject) => {
    const tx = store.transaction('lifetimes', 'readonly');
    const range = IDBKeyRange.bound([lineage, 0], [lineage, before], false, true);
    const request = tx.objectStore('lifetimes').openCursor(range, 'prev');
    const rows: Lifetime[] = [];
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor || rows.length >= limit) { resolve(rows.reverse()); return; }
      const { lineage: _, ...record } = cursor.value; rows.push(record); cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
}
