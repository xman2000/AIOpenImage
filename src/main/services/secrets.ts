import { safeStorage } from "electron";

/**
 * Wraps Electron's safeStorage, which encrypts against an OS-managed key:
 * DPAPI on Windows, Keychain on macOS, the desktop keyring on Linux.
 *
 * Encryption is not guaranteed to be available -- a Linux box with no keyring
 * has none, and outside an Electron process `safeStorage` is undefined
 * entirely. Every function here degrades to returning the value unchanged so a
 * missing keyring costs the user access to the app rather than silently losing
 * their key.
 */

const ENCRYPTED_PREFIX = "enc.v1:";

const encryptionAvailable = (): boolean => {
  try {
    return typeof safeStorage?.isEncryptionAvailable === "function" && safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};

export const isEncryptionAvailable = encryptionAvailable;

export const isEncrypted = (value: string): boolean => value.startsWith(ENCRYPTED_PREFIX);

/** Returns a prefixed base64 blob, or the original string when unavailable. */
export const encryptSecret = (plainText: string): string => {
  if (!plainText || !encryptionAvailable()) {
    return plainText;
  }
  try {
    return `${ENCRYPTED_PREFIX}${safeStorage.encryptString(plainText).toString("base64")}`;
  } catch {
    return plainText;
  }
};

/** Accepts either a prefixed blob or a legacy plaintext value. */
export const decryptSecret = (storedValue: string): string => {
  if (!storedValue || !isEncrypted(storedValue)) {
    return storedValue;
  }
  if (!encryptionAvailable()) {
    return "";
  }
  try {
    return safeStorage.decryptString(Buffer.from(storedValue.slice(ENCRYPTED_PREFIX.length), "base64"));
  } catch {
    // Wrong machine, wrong user, or a rotated OS key: the ciphertext is not
    // recoverable, so report no key rather than a corrupted one.
    return "";
  }
};
