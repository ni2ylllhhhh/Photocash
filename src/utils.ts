import { resolveBotToken, encryptBotToken } from "./utils/tokenVault";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
        version?: string;
        isVersionAtLeast?: (version: string) => boolean;
        ready: () => void;
        expand: () => void;
        openTelegramLink: (url: string) => void;
        openLink: (url: string) => void;
        close?: () => void;
        requestWriteAccess?: (callback?: (allowed: boolean) => void) => void;
        initData?: string;
        initDataUnsafe?: {
          user?: {
            id: number;
            first_name: string;
            last_name?: string;
            username?: string;
            photo_url?: string;
            language_code?: string;
            allows_write_to_pm?: boolean;
          };
          start_param?: string;
        };
      };
    };
  }
}

export function getTelegramWebApp() {
  return window.Telegram?.WebApp ?? null;
}

export function generateAvatar(name: string, seed: string) {
  let initial = "U";
  try {
    const trimmed = (name || "U").trim();
    const ascii = trimmed.match(/[a-zA-Z0-9]/);
    if (ascii) {
      initial = ascii[0].toUpperCase();
    } else {
      const firstChar = Array.from(trimmed)[0] || "U";
      initial = encodeURIComponent(firstChar);
    }
  } catch {
    initial = "U";
  }

  const colors = ["0d9488", "f2295b", "f7841f", "6366f1", "0ea5e9", "16a34a"];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
  const color = colors[Math.abs(hash) % colors.length];
  return `https://ui-avatars.com/api/?name=${initial}&background=${color}&color=fff&size=128&bold=true`;
}

export function generateUsername(name: string, id: string) {
  const clean = (name || "user").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  return `${clean}_${id.slice(-4)}`;
}

export function extractReferrerId(): string | null {
  const webApp = getTelegramWebApp();

  const savePendingRef = (refId: string) => {
    try {
      sessionStorage.setItem("pc_pending_ref", refId);
      localStorage.setItem("pc_pending_ref", refId);
    } catch {}
  };

  // 1. Direct Telegram WebApp start_param from initDataUnsafe
  const tgParam = webApp?.initDataUnsafe?.start_param;
  if (tgParam && typeof tgParam === "string" && tgParam.trim().length > 0) {
    const clean = tgParam.trim();
    savePendingRef(clean);
    return clean;
  }

  // 2. Direct start_param parsed from raw initData string
  try {
    if (webApp?.initData) {
      const initParams = new URLSearchParams(webApp.initData);
      const param =
        initParams.get("start_param") ||
        initParams.get("startapp") ||
        initParams.get("start");
      if (param && param.trim().length > 0) {
        const clean = param.trim();
        savePendingRef(clean);
        return clean;
      }
    }
  } catch {}

  // 3. Scan URL hash and query string with multiple decodeURIComponent passes
  // Telegram Mobile places start_param inside tgWebAppData as URL-encoded query parameters
  try {
    const rawSearch = window.location.search || "";
    const rawHash = window.location.hash || "";
    let combined = `${rawSearch}&${rawHash}`;

    // Decode up to 3 times to unwrap nested Telegram query-string encoding
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(combined);
        if (next === combined) break;
        combined = next;
      } catch {
        break;
      }
    }

    const match = combined.match(
      /(?:start_param|startapp|tgWebAppStartParam|start|ref)=([a-zA-Z0-9_-]+)/i
    );
    if (match && match[1] && match[1].trim().length > 0) {
      const clean = match[1].trim();
      savePendingRef(clean);
      return clean;
    }
  } catch {}

  // 4. Stored pending ref in session or local storage
  try {
    const stored =
      sessionStorage.getItem("pc_pending_ref") ||
      localStorage.getItem("pc_pending_ref");
    if (stored && stored.trim().length > 0) {
      return stored.trim();
    }
  } catch {}

  return null;
}

export function isBrowserDefaultUser(): boolean {
  const webApp = getTelegramWebApp();
  if (webApp?.initDataUnsafe?.user?.id) return false;
  try {
    let combined = `${window.location.search || ""}&${window.location.hash || ""}&${webApp?.initData || ""}`;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(combined);
        if (next === combined) break;
        combined = next;
      } catch {
        break;
      }
    }
    if (/"id":\s*(\d{6,12})/.test(combined)) {
      return false;
    }
  } catch {}
  return true;
}

export function getInitialUser() {
  const webApp = getTelegramWebApp();
  try {
    webApp?.ready();
    webApp?.expand();
  } catch {}

  const tgUser = webApp?.initDataUnsafe?.user;
  const startParam = extractReferrerId();

  if (tgUser && tgUser.id) {
    const id = String(tgUser.id);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Telegram User";
    const username = tgUser.username ? tgUser.username : generateUsername(name, id);
    const photo = tgUser.photo_url || generateAvatar(name, id);
    return { id, name, username, photo, startParam, isBrowserDefault: false };
  }

  // Backup extraction from decoded URL hash / initData if telegram-web-app.js hasn't populated yet
  try {
    let combined = `${window.location.search || ""}&${window.location.hash || ""}&${webApp?.initData || ""}`;
    for (let i = 0; i < 3; i++) {
      try {
        const next = decodeURIComponent(combined);
        if (next === combined) break;
        combined = next;
      } catch {
        break;
      }
    }
    const idMatch = combined.match(/"id":\s*(\d{6,12})/);
    if (idMatch && idMatch[1]) {
      const id = idMatch[1];
      const fnMatch = combined.match(/"first_name":\s*"([^"]+)"/);
      const lnMatch = combined.match(/"last_name":\s*"([^"]+)"/);
      const unMatch = combined.match(/"username":\s*"([^"]+)"/);
      const name = [fnMatch?.[1], lnMatch?.[1]].filter(Boolean).join(" ") || "Telegram User";
      const username = unMatch?.[1] || generateUsername(name, id);
      const photo = generateAvatar(name, id);
      return { id, name, username, photo, startParam, isBrowserDefault: false };
    }
  } catch {}

  // Chrome / Web Browser Default Account (when no Telegram ID is found)
  // Purge legacy hardcoded test account keys so 8235864550 never appears in browsers
  try {
    localStorage.removeItem("pc_test_uid");
    localStorage.removeItem("pc_test_name");
    localStorage.removeItem("pc_test_user");
    if (localStorage.getItem("pc_device_owner_uid_v1") === "8235864550") {
      localStorage.removeItem("pc_device_owner_uid_v1");
    }
  } catch {}

  let savedId = "";
  let savedName = "";
  let savedUser = "";

  try {
    savedId = localStorage.getItem("pc_browser_default_uid") || "";
    savedName = localStorage.getItem("pc_browser_default_name") || "";
    savedUser = localStorage.getItem("pc_browser_default_user") || "";
  } catch {}

  if (!savedId || savedId === "8235864550" || savedUser === "erfan13234") {
    const randomNineDigits = String(
      Math.floor(100000000 + Math.random() * 900000000)
    );
    savedId = `9${randomNineDigits}`;
    savedName = `Guest User`;
    savedUser = `user_${savedId.slice(-5)}`;
    try {
      localStorage.setItem("pc_browser_default_uid", savedId);
      localStorage.setItem("pc_browser_default_name", savedName);
      localStorage.setItem("pc_browser_default_user", savedUser);
    } catch {}
  }

  return {
    id: savedId,
    name: savedName || "Guest User",
    username: savedUser || `user_${savedId.slice(-5)}`,
    photo: generateAvatar(savedName || "Guest User", savedId),
    startParam,
    isBrowserDefault: true,
  };
}

export function escapeHtml(str?: string | null): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export async function sendTelegramBotMessage(
  botToken: string,
  chatId: string | number,
  text: string,
  webAppUrl = "https://photocash.ziniyaapu7.workers.dev"
): Promise<boolean> {
  const resolvedToken = resolveBotToken(botToken);
  if (!resolvedToken || !chatId) return false;

  const replyMarkupObj = {
    inline_keyboard: [
      [
        {
          text: "📸 Open Photo cash App",
          web_app: { url: webAppUrl },
        },
      ],
    ],
  };
  const replyMarkupJson = JSON.stringify(replyMarkupObj);

  // 1. Direct CORS-Simple POST (URLSearchParams avoids preflight OPTIONS blocking in Telegram mobile WebViews)
  try {
    const params = new URLSearchParams();
    params.set("chat_id", String(chatId));
    params.set("text", text);
    params.set("parse_mode", "HTML");
    params.set("reply_markup", replyMarkupJson);

    const res = await fetch(`https://api.telegram.org/bot${resolvedToken}/sendMessage`, {
      method: "POST",
      body: params,
    });
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (json?.ok) return true;
    }

    // Fallback without HTML parse_mode in case user's name has special characters
    const plainParams = new URLSearchParams();
    plainParams.set("chat_id", String(chatId));
    plainParams.set("text", text.replace(/<[^>]*>/g, ""));
    plainParams.set("reply_markup", replyMarkupJson);

    const resPlain = await fetch(`https://api.telegram.org/bot${resolvedToken}/sendMessage`, {
      method: "POST",
      body: plainParams,
    });
    if (resPlain.ok) {
      const jsonPlain = await resPlain.json().catch(() => null);
      if (jsonPlain?.ok) return true;
    }
  } catch {}

  // 2. Direct GET request fallback
  try {
    const q = new URLSearchParams({
      chat_id: String(chatId),
      text: text.replace(/<[^>]*>/g, ""),
      reply_markup: replyMarkupJson,
    });
    const getRes = await fetch(
      `https://api.telegram.org/bot${resolvedToken}/sendMessage?${q.toString()}`
    );
    if (getRes.ok) return true;
  } catch {}

  // 3. Server proxy fallback
  try {
    const proxyRes = await fetch("/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot_token: encryptBotToken(resolvedToken),
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        reply_markup: replyMarkupObj,
      }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json().catch(() => null);
      if (data?.ok) return true;
    }
  } catch {}

  return false;
}

export function formatUSDT(amount?: number | null, decimals = 4): string {
  const val = Number(amount) || 0;
  return `$${val.toFixed(decimals)}`;
}

export function formatCompactNumber(n: number): string {
  if (!n || n < 0) return "0";
  if (n < 1000) return String(Math.floor(n));
  if (n < 1000000) {
    const k = Math.floor((n / 1000) * 10) / 10;
    return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
  }
  const m = Math.floor((n / 1000000) * 10) / 10;
  return m % 1 === 0 ? `${m}M` : `${m.toFixed(1)}M`;
}

export function formatTimeAgo(ts: number): string {
  if (!ts || isNaN(ts)) return "just now";
  const now = Date.now();
  // Safe calculation: if timestamp is accidentally in the future, clamp it to current time
  const safeTs = Math.min(ts, now);
  const diffSec = Math.max(0, Math.floor((now - safeTs) / 1000));
  if (diffSec < 60) return "just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

export function openExternalLink(url: string) {
  const webApp = getTelegramWebApp();
  if (url.startsWith("https://t.me/")) {
    if (webApp?.openTelegramLink) {
      webApp.openTelegramLink(url);
      return;
    }
  } else if (webApp?.openLink) {
    webApp.openLink(url);
    return;
  }
  window.open(url, "_blank");
}

function drawScaledToDataUrl(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim: number,
  quality: number
): string {
  let width = srcWidth || maxDim;
  let height = srcHeight || maxDim;
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.max(1, Math.round((height * maxDim) / width));
      width = maxDim;
    } else {
      width = Math.max(1, Math.round((width * maxDim) / height));
      height = maxDim;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(source, 0, 0, width, height);
  let dataUrl = canvas.toDataURL("image/jpeg", quality);
  // Instant sub-3ms quality step-down from existing canvas if photo is dense (> ~38KB binary)
  if (dataUrl.length > 52000 && quality > 0.52) {
    dataUrl = canvas.toDataURL("image/jpeg", 0.52);
  }
  return dataUrl;
}

export async function compressImageToDataUrl(
  file: File,
  maxDim = 680,
  quality = 0.68
): Promise<string> {
  // Fast off-thread decode when supported
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const result = drawScaledToDataUrl(
          bitmap,
          bitmap.width,
          bitmap.height,
          maxDim,
          quality
        );
        if (result) return result;
      } finally {
        bitmap.close();
      }
    } catch {
      // Fall through to standard Image loader
    }
  }

  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(
        drawScaledToDataUrl(img, img.naturalWidth || img.width, img.naturalHeight || img.height, maxDim, quality)
      );
    };
    img.src = objectUrl;
  });
}

export const DEFAULT_IMGBB_KEYS = [
  "f3ca95750adeb1abc4ecc8e725991337",
  "2e443aefdb90e0bfa664342d214a99a7",
  "02218ebe0262d0e4b891ccf9786d24fe",
  "5a024dc769944312ea5bf67fe42d2b27",
  "ba2d5677268f9b2dc7ff89bb2f5d33f8",
];

// Remember rate-limited / blocked ImgBB keys temporarily so subsequent uploads skip them immediately
const failedImgbbKeysUntil = new Map<string, number>();

async function trySingleImgbbUpload(
  key: string,
  base64Data: string,
  timeoutMs = 2200
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("image", base64Data);
    const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 400 || res.status === 403 || res.status === 429) {
        failedImgbbKeysUntil.set(key, Date.now() + 5 * 60 * 1000);
      }
      throw new Error(`Upload HTTP ${res.status}`);
    }
    const json = await res.json();
    const hostedUrl = json?.data?.display_url || json?.data?.url;
    if (!hostedUrl) {
      failedImgbbKeysUntil.set(key, Date.now() + 5 * 60 * 1000);
      throw new Error("No URL returned");
    }
    return hostedUrl;
  } catch (err) {
    if (!failedImgbbKeysUntil.has(key)) {
      failedImgbbKeysUntil.set(key, Date.now() + 60 * 1000);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadImageToImgbb(
  file: File,
  userApiKey?: string | string[]
): Promise<string> {
  // 1. Single-pass fast client-side compression (~18-35KB crisp mobile photo)
  const compressedDataUrl = await compressImageToDataUrl(file, 680, 0.68);
  const base64Data = compressedDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // 2. Gather keys and skip any currently on rate-limit/error cooldown
  const extraKeys = Array.isArray(userApiKey)
    ? userApiKey
    : userApiKey
    ? [userApiKey]
    : [];

  const now = Date.now();
  const allKeys = Array.from(
    new Set([...extraKeys.filter(Boolean), ...DEFAULT_IMGBB_KEYS])
  ).filter((k) => (failedImgbbKeysUntil.get(k) || 0) <= now);

  if (allKeys.length === 0) {
    // All CDN keys recently rate-limited: return compact DataURL immediately in 0ms
    return compressedDataUrl;
  }

  // 3. Single fast parallel race (up to 3 keys simultaneously, 2.2s cap)
  const candidates = [...allKeys].sort(() => Math.random() - 0.5).slice(0, 3);
  try {
    const fastUrl = await Promise.any(
      candidates.map((k) => trySingleImgbbUpload(k, base64Data, 2200))
    );
    if (fastUrl) return fastUrl;
  } catch {
    // Fall through immediately to already-compressed DataURL (zero re-compression)
  }

  return compressedDataUrl;
}
