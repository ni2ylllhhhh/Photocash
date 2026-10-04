import { resolveBotToken, encryptBotToken } from "./utils/tokenVault";

declare global {
  interface Window {
    Telegram?: {
      WebApp?: {
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

export function getInitialUser() {
  const webApp = getTelegramWebApp();
  try {
    webApp?.ready();
    webApp?.expand();
  } catch {}

  const tgUser = webApp?.initDataUnsafe?.user;
  const startParam = extractReferrerId();

  if (tgUser) {
    const id = String(tgUser.id);
    const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") || "Telegram User";
    const username = tgUser.username ? tgUser.username : generateUsername(name, id);
    const photo = tgUser.photo_url || generateAvatar(name, id);
    return { id, name, username, photo, startParam };
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
      return { id, name, username, photo, startParam };
    }
  } catch {}

  // Fallback for browser preview / testing
  let savedId = localStorage.getItem("pc_test_uid");
  let savedName = localStorage.getItem("pc_test_name");
  let savedUser = localStorage.getItem("pc_test_user");

  if (!savedId || (!savedUser || savedUser === "erfan13234") && savedId !== "8235864550") {
    savedId = "8235864550";
    savedName = "Erfan Ahmed";
    savedUser = "erfan13234";
    localStorage.setItem("pc_test_uid", savedId);
    localStorage.setItem("pc_test_name", savedName);
    localStorage.setItem("pc_test_user", savedUser);
  }

  return {
    id: savedId,
    name: savedName || "Erfan Ahmed",
    username: savedUser || "erfan13234",
    photo: "https://i.ibb.co.com/84N396n7/Screenshot-20260929-214434.jpg",
    startParam,
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
  if (n < 1000) return String(n);
  if (n < 1000000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1000000).toFixed(1)}M`;
}

export function formatTimeAgo(ts: number): string {
  const diffSec = Math.floor((Date.now() - ts) / 1000);
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

export async function compressImageToDataUrl(
  file: File,
  maxDim = 1080,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onerror = (err) => {
      URL.revokeObjectURL(objectUrl);
      reject(err);
    };
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve("");
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL("image/jpeg", quality));
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

async function trySingleImgbbUpload(
  key: string,
  base64Data: string,
  timeoutMs = 4000
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
    if (!res.ok) throw new Error("Upload HTTP error");
    const json = await res.json();
    const hostedUrl = json?.data?.display_url || json?.data?.url;
    if (!hostedUrl) throw new Error("No URL returned");
    return hostedUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadImageToImgbb(
  file: File,
  userApiKey?: string | string[]
): Promise<string> {
  // 1. Ultra-fast client-side compression (~60-90KB in <100ms using ObjectURL)
  const compressedDataUrl = await compressImageToDataUrl(file, 1080, 0.78);
  const base64Data = compressedDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // 2. Gather and shuffle all 5+ API keys for even load distribution across concurrent users
  const extraKeys = Array.isArray(userApiKey)
    ? userApiKey
    : userApiKey
    ? [userApiKey]
    : [];

  const allKeys = Array.from(
    new Set([...extraKeys.filter(Boolean), ...DEFAULT_IMGBB_KEYS])
  );
  const shuffledKeys = [...allKeys].sort(() => Math.random() - 0.5);

  // 3. Parallel Hedged Upload: Race 2 random keys simultaneously so whichever server responds fastest wins immediately!
  const firstBatch = shuffledKeys.slice(0, 2);
  try {
    const fastUrl = await Promise.any(
      firstBatch.map((k) => trySingleImgbbUpload(k, base64Data, 4000))
    );
    if (fastUrl) return fastUrl;
  } catch {
    // First pair failed or timed out — race remaining keys in pool
  }

  const secondBatch = shuffledKeys.slice(2);
  if (secondBatch.length > 0) {
    try {
      const backupUrl = await Promise.any(
        secondBatch.map((k) => trySingleImgbbUpload(k, base64Data, 4500))
      );
      if (backupUrl) return backupUrl;
    } catch {
      // Fall through to compact DataURL fallback
    }
  }

  // 4. Ultimate fallback: Compact 720p DataURL (~40KB) so post creation NEVER fails even if external CDN is down
  try {
    const compactFallback = await compressImageToDataUrl(file, 720, 0.68);
    if (compactFallback) return compactFallback;
  } catch {}

  return compressedDataUrl;
}
