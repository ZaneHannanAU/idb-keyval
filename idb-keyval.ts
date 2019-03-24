const dpb = new WeakMap<Store, Promise<IDBDatabase>>();
export class Store {
  constructor(dbName = 'keyval-store', readonly storeName = 'keyval', autoreload = false) {
    const main = (resolve, reject) => {
      const openreq = indexedDB.open(dbName, 1);
      openreq.onerror = () => reject(openreq.error);
      openreq.onsuccess = () => resolve(openreq.result);

      // First time setup: create an empty object store
      openreq.onupgradeneeded = () => {
        openreq.result.createObjectStore(storeName);
      };
    }
    dbp.set(this, new Promise(main));
    if (autoreload) {
      // Will cause a memory leak in scripts that retrieve a new Store each time.
      // Don't use autoreload in that case.
      let curr: IDBDatabase | null = null;
      let r: ((d: IDBDatabase) => void), j: ((e: any) => void);
      dpb.get(this)!.then(db => {curr = db});
      let frozen = 0;
      const freeze = () => {
        if (frozen++) return;
        curr && curr.close();
        curr = null;
        dpb.set(this, new Promise((R, J) => {r = R; j = J}));
      }
      const resume = () => {
        if (--frozen || !(r && j)) return;
        dpb.get(this)!.then(db => {curr = db});
        curr || main(r, j);
      }
      document.addEventListener('freeze', freeze, {capture: true});
      window.addEventListener('pagehide', freeze, {capture: true});
      document.addEventListener('resume', resume, {capture: true});
      window.addEventListener('pageshow', resume, {capture: true});
    }
  }

  _withIDBStore(type: IDBTransactionMode, callback: ((store: IDBObjectStore) => void)): Promise<void> {
    return dbp.get(this)!.then(db => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(this.storeName, type);
      transaction.oncomplete = () => resolve();
      transaction.onabort = transaction.onerror = () => reject(transaction.error);
      callback(transaction.objectStore(this.storeName));
    }));
  }
}

let store: Store;

function getDefaultStore() {
  if (!store) store = new Store();
  return store;
}

export function get<Type>(key: IDBValidKey, store = getDefaultStore()): Promise<Type> {
  let req: IDBRequest;
  return store._withIDBStore('readonly', store => {
    req = store.get(key);
  }).then(() => req.result);
}

export function set(key: IDBValidKey, value: any, store = getDefaultStore()): Promise<void> {
  return store._withIDBStore('readwrite', store => {
    store.put(value, key);
  });
}

export function del(key: IDBValidKey, store = getDefaultStore()): Promise<void> {
  return store._withIDBStore('readwrite', store => {
    store.delete(key);
  });
}

export function clear(store = getDefaultStore()): Promise<void> {
  return store._withIDBStore('readwrite', store => {
    store.clear();
  });
}

export function keys(store = getDefaultStore()): Promise<IDBValidKey[]> {
  const keys: IDBValidKey[] = [];

  return store._withIDBStore('readonly', store => {
    // This would be store.getAllKeys(), but it isn't supported by Edge or Safari.
    // And openKeyCursor isn't supported by Safari.
    (store.openKeyCursor || store.openCursor).call(store).onsuccess = function() {
      if (!this.result) return;
      keys.push(this.result.key);
      this.result.continue()
    };
  }).then(() => keys);
}
