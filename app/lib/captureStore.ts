// On-device capture store (IndexedDB). Captures never leave the browser:
// there is no fetch/XHR/upload anywhere in this app.
export interface CaptureRecord {
  id: number;
  ts: number;
  dataUrl: string;
}

const DB_NAME = "liveness-captures";
const STORE = "captures";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function dbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      })
  );
}

export const dbPut = (rec: CaptureRecord) => dbRun("readwrite", (s) => s.put(rec));
export const dbAll = () => dbRun<CaptureRecord[]>("readonly", (s) => s.getAll());
export const dbDelete = (id: number) => dbRun("readwrite", (s) => s.delete(id));
export const dbClear = () => dbRun("readwrite", (s) => s.clear());

export function captureFrame(video: HTMLVideoElement): string {
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  const g = c.getContext("2d")!;
  g.translate(c.width, 0);
  g.scale(-1, 1); // match the mirrored selfie preview the user saw
  g.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.9);
}

export async function saveCapture(video: HTMLVideoElement): Promise<boolean> {
  try {
    await dbPut({ id: Date.now(), ts: Date.now(), dataUrl: captureFrame(video) });
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export function downloadCapture(rec: CaptureRecord) {
  const a = document.createElement("a");
  a.href = rec.dataUrl;
  a.download = "liveness-" + new Date(rec.ts).toISOString().replace(/[:.]/g, "-") + ".jpg";
  a.click();
}
