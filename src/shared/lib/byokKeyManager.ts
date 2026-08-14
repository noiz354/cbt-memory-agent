/**
 * BYOK Key Manager — IndexedDB + WebCrypto wrap.
 *
 * API keys user dienkripsi sebelum disimpan di IndexedDB.
 * Kunci enkripsi diturunkan dari WebCrypto CryptoKey yang dibuat saat pertama kali app jalan.
 * Key mentah TIDAK PERNAH masuk localStorage atau terlihat di console.
 *
 * Flow:
 * 1. Pertama kali app jalan → generate wrapping key (AES-GCM, persistent di IndexedDB)
 * 2. User input API key → encrypt dengan wrapping key → simpan ciphertext di IndexedDB
 * 3. Saat butuh API key → ambil ciphertext dari IndexedDB → decrypt → return plaintext
 * 4. User revoke key → hapus ciphertext dari IndexedDB
 */

import type { LLMProviderId } from "@/shared/lib/llmRegistry";

const DB_NAME = "cbt-byok-keys";
const DB_VERSION = 1;
const STORE_NAME = "keys";
const WRAP_KEY_STORE = "wrappingKey";
const WRAP_KEY_ID = "cbt-api-key-wrapper";

interface EncryptedKey {
  ciphertext: string; // base64
  iv: string; // base64
  providerId: LLMProviderId;
  modelId: string;
  createdAt: string;
  lastUsedAt: string | null;
}

let wrappingKey: CryptoKey | null = null;

/**
 * Initialize: buat atau ambil wrapping key dari IndexedDB.
 * Dipanggil sekali di startup app.
 */
export async function initKeyManager(): Promise<void> {
  if (wrappingKey) return;

  const db = await openDB();
  wrappingKey = await getWrappingKey(db);
  if (!wrappingKey) {
    wrappingKey = await generateWrappingKey(db);
  }
}

/**
 * Simpan API key (terenkripsi) untuk provider + model tertentu.
 */
export async function saveApiKey(
  providerId: LLMProviderId,
  modelId: string,
  plaintextKey: string,
): Promise<void> {
  await initKeyManager();
  if (!wrappingKey) throw new Error("Wrapping key not initialized");

  const { ciphertext, iv } = await encryptKey(plaintextKey, wrappingKey);
  const entry: EncryptedKey = {
    ciphertext,
    iv,
    providerId,
    modelId,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };

  const db = await openDB();
  await putKey(db, entry);
}

/**
 * Ambil API key (dekripsi) untuk provider + model tertentu.
 * Returns null jika key belum diset.
 */
export async function getApiKey(
  providerId: LLMProviderId,
  modelId: string,
): Promise<string | null> {
  await initKeyManager();
  if (!wrappingKey) throw new Error("Wrapping key not initialized");

  const db = await openDB();
  const entry = await getKey(db, providerId, modelId);
  if (!entry) return null;

  const plaintext = await decryptKey(entry.ciphertext, entry.iv, wrappingKey);

  // Update lastUsedAt
  const updated = { ...entry, lastUsedAt: new Date().toISOString() };
  await putKey(db, updated);

  return plaintext;
}

/**
 * Hapus API key untuk provider + model tertentu.
 */
export async function revokeApiKey(
  providerId: LLMProviderId,
  modelId: string,
): Promise<void> {
  const db = await openDB();
  await deleteKey(db, providerId, modelId);
}

/**
 * List semua provider yang punya key tersimpan.
 */
export async function listConfiguredProviders(): Promise<EncryptedKey[]> {
  const db = await openDB();
  return getAllKeys(db);
}

/**
 * Hapus semua keys (hard purge untuk BYOK).
 */
export async function wipeAllApiKeys(): Promise<void> {
  const db = await openDB();
  await clearAllKeys(db);
}

// ─────────────────────────────────────────────
// IndexedDB helpers
// ─────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("providerModel", ["providerId", "modelId"], { unique: true });
      }
      if (!db.objectStoreNames.contains(WRAP_KEY_STORE)) {
        db.createObjectStore(WRAP_KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function keyId(providerId: LLMProviderId, modelId: string): string {
  return `${providerId}::${modelId}`;
}

async function putKey(db: IDBDatabase, entry: EncryptedKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ ...entry, id: keyId(entry.providerId, entry.modelId) });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getKey(db: IDBDatabase, providerId: LLMProviderId, modelId: string): Promise<EncryptedKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("providerModel");
    const req = index.get([providerId, modelId]);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteKey(db: IDBDatabase, providerId: LLMProviderId, modelId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("providerModel");
    const req = index.get([providerId, modelId]);
    req.onsuccess = () => {
      if (req.result) {
        store.delete(req.result.id);
      }
      tx.oncomplete = () => resolve();
    };
    req.onerror = () => reject(req.error);
  });
}

async function getAllKeys(db: IDBDatabase): Promise<EncryptedKey[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

async function clearAllKeys(db: IDBDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─────────────────────────────────────────────
// WebCrypto helpers
// ─────────────────────────────────────────────

async function getWrappingKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(WRAP_KEY_STORE, "readonly");
    const store = tx.objectStore(WRAP_KEY_STORE);
    const req = store.get(WRAP_KEY_ID);
    req.onsuccess = () => {
      if (req.result?.keyData) {
        crypto.subtle.importKey("raw", req.result.keyData, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
          .then((key) => resolve(key))
          .catch(() => resolve(null));
      } else {
        resolve(null);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

async function generateWrappingKey(db: IDBDatabase): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const keyData = await crypto.subtle.exportKey("raw", key);

  return new Promise((resolve, reject) => {
    const tx = db.transaction(WRAP_KEY_STORE, "readwrite");
    const store = tx.objectStore(WRAP_KEY_STORE);
    store.put({ id: WRAP_KEY_ID, keyData }, WRAP_KEY_ID);
    tx.oncomplete = () => resolve(key as CryptoKey);
    tx.onerror = () => reject(tx.error);
  });
}

async function encryptKey(plaintext: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const buffer = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(buffer))),
    iv: btoa(String.fromCharCode(...iv)),
  };
}

async function decryptKey(ciphertext: string, iv: string, key: CryptoKey): Promise<string> {
  const ivBytes = Uint8Array.from(atob(iv), (c) => c.charCodeAt(0));
  const ctBytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: ivBytes }, key, ctBytes);
  return new TextDecoder().decode(decrypted);
}
