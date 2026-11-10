// Zwischenspeicher für fertig analysierte Videos (IndexedDB, nur in diesem Browser).
// Ein Eintrag hält Transkript, Laute und die Tonspuren als Float32Arrays.

const DB = 'slinky-cut', STORE = 'analyses', VERSION = 1;

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode), req = fn(t.objectStore(STORE));
    t.oncomplete = () => { db.close(); resolve(req?.result); };
    t.onerror = t.onabort = () => { db.close(); reject(t.error); };
  }));
}

export const get = key => tx('readonly', s => s.get(key)).catch(() => undefined);
export const put = (key, value) => tx('readwrite', s => s.put(value, key));
export const remove = key => tx('readwrite', s => s.delete(key));
export const keys = () => tx('readonly', s => s.getAllKeys()).catch(() => []);
