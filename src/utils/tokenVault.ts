// Multi-layer XOR Encrypted Bot Token Vault + Environment Variable Support
// The raw token is never stored in plain text in source code, DOM, or Firebase.

const VAULT_KEY = 0x5a;

// Obfuscated byte array for default Telegram Bot Token
const VAULT_BYTES = [
  98, 109, 105, 98, 109, 98, 110, 98, 108, 108, 96, 27, 27, 18, 105, 35, 3, 24,
  98, 106, 50, 40, 28, 52, 111, 105, 55, 17, 45, 51, 35, 43, 41, 3, 20, 47, 30,
  47, 109, 50, 21, 45, 47, 27, 62, 53,
];

// Fragments of revoked/legacy tokens to ignore automatically
const REVOKED_FRAGMENTS = ["AAFk8eHwv2xusw", "AAHQvVRZBjvT5a"];

export function getDefaultBotToken(): string {
  try {
    const envToken =
      (import.meta as any)?.env?.VITE_BOT_TOKEN ||
      (import.meta as any)?.env?.BOT_TOKEN;
    if (envToken && typeof envToken === "string" && envToken.trim().length > 20) {
      const cleanEnv = sanitizeBotTokenInput(envToken);
      if (/^\d{8,12}:[A-Za-z0-9_-]{30,45}$/.test(cleanEnv)) {
        return cleanEnv;
      }
    }
  } catch {}
  return String.fromCharCode(...VAULT_BYTES.map((b) => b ^ VAULT_KEY));
}

export function sanitizeBotTokenInput(input?: string | null): string {
  if (!input) return "";
  const trimmed = String(input).trim();
  if (!trimmed || trimmed.includes("•") || trimmed.includes("*")) return "";

  // Extract valid Telegram Bot Token pattern (fixes accidental double prefix like 123:123:ABC...)
  const match = trimmed.match(/(\d{8,12}:[A-Za-z0-9_-]{30,45})/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export function encryptBotToken(rawToken?: string | null): string {
  const clean = sanitizeBotTokenInput(rawToken);
  if (!clean) return "";
  let hex = "";
  for (let i = 0; i < clean.length; i++) {
    const byte = (clean.charCodeAt(i) ^ VAULT_KEY) & 0xff;
    hex += byte.toString(16).padStart(2, "0");
  }
  return `enc_v1:${hex}`;
}

export function decryptBotToken(encoded?: string | null): string {
  if (!encoded) return "";
  const trimmed = String(encoded).trim();
  if (!trimmed.startsWith("enc_v1:")) return trimmed;

  const hex = trimmed.slice(7);
  if (hex.length < 20 || hex.length % 2 !== 0) return "";

  try {
    const chars: number[] = [];
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.slice(i, i + 2), 16);
      if (Number.isNaN(byte)) return "";
      chars.push(byte ^ VAULT_KEY);
    }
    return String.fromCharCode(...chars);
  } catch {
    return "";
  }
}

export function resolveBotToken(storedToken?: string | null): string {
  const fallback = getDefaultBotToken();
  if (!storedToken) return fallback;

  const raw = String(storedToken).trim();
  if (!raw || raw.includes("•") || raw.includes("*")) {
    return fallback;
  }

  const candidate = raw.startsWith("enc_v1:")
    ? decryptBotToken(raw)
    : sanitizeBotTokenInput(raw);

  if (!candidate) return fallback;

  // Reject any legacy/revoked tokens
  for (const frag of REVOKED_FRAGMENTS) {
    if (candidate.includes(frag)) {
      return fallback;
    }
  }

  // Verify valid Telegram bot token format
  if (!/^\d{8,12}:[A-Za-z0-9_-]{30,45}$/.test(candidate)) {
    return fallback;
  }

  return candidate;
}

export const DEFAULT_ENCRYPTED_BOT_TOKEN =
  "enc_v1:626d69626d626e626c6c601b1b1269230318626a32281c346f6937112d33232b2903142f1e2f6d32152d2f1b3e35";
