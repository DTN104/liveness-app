import { CONFIG } from "./config";

// Face verification (1:1 identity), fully client-side.
//
// Liveness (the scanner) proves a real live person is present. THIS module
// answers a different question: "is this the same person we enrolled?"
// It uses a face-recognition network to turn a face into a 128-d embedding
// ("descriptor"). Enroll stores one descriptor on-device; verify compares a
// fresh descriptor to it by Euclidean distance. Nothing is ever uploaded.
//
// NOTE: a descriptor is a biometric template. For a real product, gate enroll
// behind a passed liveness check + explicit consent, and treat storage as
// regulated biometric data (GDPR special-category / BIPA).

let faceApiPromise: Promise<any> | null = null;

// Lazy, browser-only load of face-api + the three nets we need.
export function loadFaceApi(): Promise<any> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      const faceapi: any = await import("@vladmandic/face-api");
      await Promise.all([
        faceapi.nets.tinyFaceDetector.loadFromUri(CONFIG.faceApiModelDir),
        faceapi.nets.faceLandmark68Net.loadFromUri(CONFIG.faceApiModelDir),
        faceapi.nets.faceRecognitionNet.loadFromUri(CONFIG.faceApiModelDir),
      ]);
      return faceapi;
    })().catch((err) => {
      faceApiPromise = null; // allow retry after a failed load
      throw err;
    });
  }
  return faceApiPromise;
}

// 128-d face descriptor from the current video frame, or null if no face.
export async function computeDescriptor(video: HTMLVideoElement): Promise<Float32Array | null> {
  const faceapi = await loadFaceApi();
  const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const result = await faceapi
    .detectSingleFace(video, opts)
    .withFaceLandmarks()
    .withFaceDescriptor();
  return result ? (result.descriptor as Float32Array) : null;
}

export function euclideanDistance(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ---------- IndexedDB template store (on-device only) ----------
const DB_NAME = "liveness-faceauth";
const DB_VERSION = 1;
const STORE = "templates";
const KEY = "me";

export interface Template {
  descriptor: number[];
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTemplate(descriptor: Float32Array | number[]): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({
      id: KEY,
      descriptor: Array.from(descriptor as ArrayLike<number>),
      createdAt: Date.now(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTemplate(): Promise<Template | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const r = req.result;
      resolve(r ? { descriptor: r.descriptor, createdAt: r.createdAt } : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTemplate(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- High-level flows ----------
export type VerifyStatus = "match" | "nomatch" | "no-template" | "no-face";

export interface VerifyResult {
  status: VerifyStatus;
  distance?: number;
  threshold: number;
}

// Capture the current frame as the enrolled identity.
export async function enroll(video: HTMLVideoElement): Promise<{ ok: boolean; error?: string }> {
  try {
    const d = await computeDescriptor(video);
    if (!d) return { ok: false, error: "No face detected — center your face and retry" };
    await saveTemplate(d);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Compare the current frame against the enrolled template.
export async function verify(video: HTMLVideoElement): Promise<VerifyResult> {
  const t = await getTemplate();
  if (!t) return { status: "no-template", threshold: CONFIG.matchThreshold };
  const d = await computeDescriptor(video);
  if (!d) return { status: "no-face", threshold: CONFIG.matchThreshold };
  const distance = euclideanDistance(d, t.descriptor);
  return {
    status: distance < CONFIG.matchThreshold ? "match" : "nomatch",
    distance,
    threshold: CONFIG.matchThreshold,
  };
}
