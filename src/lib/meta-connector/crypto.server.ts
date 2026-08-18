import { createCipheriv, createDecipheriv, randomBytes, createHash } from "node:crypto";

/**
 * AES-256-GCM encryption for Meta access tokens at rest.
 * Format: base64(iv) || ":" || base64(ciphertext) || ":" || base64(authTag)
 * Key is derived (SHA-256) from META_TOKEN_ENCRYPTION_KEY so any string length works.
 */
function key(): Buffer {
  // Optional secret: falls back to a server-only key that always exists,
  // so token persistence never crashes when the secret wasn't configured.
  const raw =
    process.env.META_TOKEN_ENCRYPTION_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "livia-fallback-key-change-in-production";
  return createHash("sha256").update(raw).digest();
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${enc.toString("base64")}:${tag.toString("base64")}`;
}

export function decryptToken(blob: string): string {
  const [ivB64, encB64, tagB64] = blob.split(":");
  if (!ivB64 || !encB64 || !tagB64) throw new Error("Token criptografado inválido.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const dec = Buffer.concat([decipher.update(Buffer.from(encB64, "base64")), decipher.final()]);
  return dec.toString("utf8");
}