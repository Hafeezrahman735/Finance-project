import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Secrets at rest (eng review F17): AES-256-GCM, ciphertext = base64(iv ‖ tag ‖ data).
 * Every ciphertext is stored next to the `keyId` (first 8 hex of SHA-256 of
 * the key) it was written with, so a rotation is: add the new key as current,
 * keep the old one in TOKEN_ENCRYPTION_KEY_PREVIOUS, and let rows re-encrypt
 * as they are read (`needsRotation`).
 */
export interface Sealed {
  ciphertext: string;
  keyId: string;
}

export class SecretsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretsError";
  }
}

export const keyIdOf = (key: Buffer): string => createHash("sha256").update(key).digest("hex").slice(0, 8);

export function parseKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new SecretsError("encryption key must be 64 hex characters");
  return Buffer.from(hex, "hex");
}

/** Development fallback: derive a key from the JWT secret so zero-key setups still encrypt. */
export const deriveDevKey = (jwtSecret: string): Buffer => createHash("sha256").update(`ledgeriq-token-key:${jwtSecret}`).digest();

export class Secrets {
  private readonly keys: Map<string, Buffer>;
  readonly currentKeyId: string;

  constructor(current: Buffer, previous: Buffer[] = []) {
    this.keys = new Map([current, ...previous].map((k) => [keyIdOf(k), k]));
    this.currentKeyId = keyIdOf(current);
  }

  seal(plain: string): Sealed {
    const key = this.keys.get(this.currentKeyId)!;
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: Buffer.concat([iv, tag, data]).toString("base64"), keyId: this.currentKeyId };
  }

  open(sealed: Sealed): string {
    const key = this.keys.get(sealed.keyId);
    if (!key) throw new SecretsError(`no encryption key with id ${sealed.keyId}; set TOKEN_ENCRYPTION_KEY_PREVIOUS`);
    const buf = Buffer.from(sealed.ciphertext, "base64");
    if (buf.length < 12 + 16 + 1) throw new SecretsError("ciphertext too short");
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    try {
      return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
    } catch {
      throw new SecretsError("ciphertext failed authentication (wrong key or tampered)");
    }
  }

  /** True when the row was written with a previous key and should be re-sealed under the current one. */
  needsRotation(sealed: Sealed): boolean {
    return sealed.keyId !== this.currentKeyId;
  }
}

export function createSecrets(config: { TOKEN_ENCRYPTION_KEY?: string; TOKEN_ENCRYPTION_KEY_PREVIOUS?: string; JWT_SECRET: string }, warn?: (msg: string) => void): Secrets {
  const previous = (config.TOKEN_ENCRYPTION_KEY_PREVIOUS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseKey);
  if (config.TOKEN_ENCRYPTION_KEY) return new Secrets(parseKey(config.TOKEN_ENCRYPTION_KEY), previous);
  warn?.("TOKEN_ENCRYPTION_KEY not set: bank access tokens are encrypted with a key derived from JWT_SECRET (fine locally; set a real key before production)");
  return new Secrets(deriveDevKey(config.JWT_SECRET), previous);
}
