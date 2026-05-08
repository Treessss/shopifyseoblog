import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;
const SECRET_VERSION = "v1";
const AAD = Buffer.from("shopify-ai-blog-saas:db-secret", "utf8");

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

export class EncryptedSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptedSecretError";
  }
}

export interface EncryptedSecretParts {
  version: typeof SECRET_VERSION;
  iv: string;
  tag: string;
  ciphertext: string;
}

export function encryptSecret(plaintext: string, keyInput = process.env.ENCRYPTION_KEY): string {
  const key = resolveEncryptionKey(keyInput);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(AAD);

  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SECRET_VERSION,
    iv.toString("base64"),
    tag.toString("base64"),
    ciphertext.toString("base64")
  ].join(":");
}

export function decryptSecret(encrypted: string, keyInput = process.env.ENCRYPTION_KEY): string {
  const key = resolveEncryptionKey(keyInput);
  const parts = parseEncryptedSecret(encrypted);
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(parts.iv, "base64"), {
    authTagLength: AUTH_TAG_BYTES
  });
  decipher.setAAD(AAD);
  decipher.setAuthTag(Buffer.from(parts.tag, "base64"));

  try {
    return Buffer.concat([
      decipher.update(Buffer.from(parts.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    throw new EncryptedSecretError("Encrypted secret could not be authenticated or decrypted.");
  }
}

export function maybeDecryptSecret(value: string | null | undefined, keyInput = process.env.ENCRYPTION_KEY) {
  if (!value) return value;
  return isEncryptedSecret(value) ? decryptSecret(value, keyInput) : value;
}

export function isEncryptedSecret(value: string): boolean {
  const [version, iv, tag, ciphertext] = value.split(":");
  return (
    version === SECRET_VERSION &&
    isBase64Bytes(iv, IV_BYTES) &&
    isBase64Bytes(tag, AUTH_TAG_BYTES) &&
    isBase64Bytes(ciphertext)
  );
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function redactSecret(value: string | null | undefined, visibleChars = 4): string | null {
  if (!value) return null;
  if (value.length <= visibleChars * 2) return "*".repeat(value.length);
  return `${value.slice(0, visibleChars)}${"*".repeat(12)}${value.slice(-visibleChars)}`;
}

function parseEncryptedSecret(value: string): EncryptedSecretParts {
  const [version, iv, tag, ciphertext, ...extra] = value.split(":");
  if (extra.length > 0 || version !== SECRET_VERSION) {
    throw new EncryptedSecretError("Encrypted secret uses an unsupported format.");
  }
  if (!isBase64Bytes(iv, IV_BYTES) || !isBase64Bytes(tag, AUTH_TAG_BYTES) || !isBase64Bytes(ciphertext)) {
    throw new EncryptedSecretError("Encrypted secret payload is malformed.");
  }
  return { version, iv, tag, ciphertext };
}

function resolveEncryptionKey(keyInput?: string): Buffer {
  if (!keyInput) {
    throw new EncryptionKeyError("ENCRYPTION_KEY is required to encrypt or decrypt secrets.");
  }

  const normalized = keyInput.trim();
  const candidates = [
    decodeBase64Key(normalized),
    decodeHexKey(normalized),
    Buffer.from(normalized, "utf8")
  ].filter((candidate): candidate is Buffer => candidate !== null);

  const key = candidates.find((candidate) => candidate.byteLength === KEY_BYTES);
  if (!key) {
    throw new EncryptionKeyError("ENCRYPTION_KEY must decode to exactly 32 bytes.");
  }

  return key;
}

function decodeBase64Key(value: string): Buffer | null {
  const decoded = Buffer.from(value, "base64");
  if (decoded.byteLength === 0) return null;

  const normalizedOriginal = value.replace(/=+$/, "");
  const normalizedDecoded = decoded.toString("base64").replace(/=+$/, "");
  if (!timingSafeEqualString(normalizedOriginal, normalizedDecoded)) return null;

  return decoded;
}

function decodeHexKey(value: string): Buffer | null {
  if (!/^[a-f0-9]+$/i.test(value) || value.length % 2 !== 0) return null;
  return Buffer.from(value, "hex");
}

function isBase64Bytes(value: string | undefined, expectedBytes?: number): value is string {
  if (!value) return false;
  const decoded = Buffer.from(value, "base64");
  if (expectedBytes !== undefined && decoded.byteLength !== expectedBytes) return false;
  if (decoded.byteLength === 0) return false;
  return timingSafeEqualString(value.replace(/=+$/, ""), decoded.toString("base64").replace(/=+$/, ""));
}

function timingSafeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.byteLength !== rightBuffer.byteLength) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
