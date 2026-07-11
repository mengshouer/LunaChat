// WebCrypto primitives for the optional passphrase encryption of API keys
// and for encrypted whole-file exports. Pure functions, no React.

const ENC_PREFIX = "enc:v1:";
const PBKDF2_ITERATIONS = 600_000;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function randomSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveKey(
  passphrase: string,
  saltB64: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: fromBase64(saltB64) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    // extractable so the session key can be cached in sessionStorage
    true,
    ["encrypt", "decrypt"],
  );
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(ENC_PREFIX);
}

export async function encryptString(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(plaintext),
  );
  return `${ENC_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

// Throws on wrong key / corrupted data (AES-GCM auth tag mismatch).
export async function decryptString(
  key: CryptoKey,
  value: string,
): Promise<string> {
  if (!isEncrypted(value)) throw new Error("Not an encrypted value");
  const [ivB64, ctB64] = value.slice(ENC_PREFIX.length).split(":");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) as BufferSource },
    key,
    fromBase64(ctB64) as BufferSource,
  );
  return new TextDecoder().decode(pt);
}

export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  return toBase64(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importKeyRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(b64) as BufferSource,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
}

// Whole-file encryption for backups. Each file is self-contained: a fresh
// salt is generated per export, the passphrase is asked at export time.
export async function encryptJson(
  passphrase: string,
  obj: unknown,
): Promise<{ salt: string; payload: string }> {
  const salt = randomSalt();
  const key = await deriveKey(passphrase, salt);
  const payload = await encryptString(key, JSON.stringify(obj));
  return { salt, payload };
}

export async function decryptJson<T>(
  passphrase: string,
  salt: string,
  payload: string,
): Promise<T> {
  const key = await deriveKey(passphrase, salt);
  try {
    return JSON.parse(await decryptString(key, payload)) as T;
  } catch {
    throw new Error("Wrong passphrase or corrupted file");
  }
}
