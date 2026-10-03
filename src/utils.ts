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

  if (!savedId) {
    savedId = String(Math.floor(100000000 + Math.random() * 900000000));
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
  text: string
): Promise<boolean> {
  if (!botToken || !chatId) return false;

  // 1. Try local proxy endpoint first (avoids CORS / browser blocking)
  try {
    const proxyRes = await fetch("/api/send-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bot_token: botToken,
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    if (proxyRes.ok) {
      const data = await proxyRes.json();
      if (data?.ok) return true;
    }
  } catch {}

  // 2. Direct Telegram API call as fallback
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });
    if (res.ok) return true;

    // Fallback: send as plain text without parse_mode if HTML entities failed
    const plainText = text.replace(/<[^>]*>/g, "");
    const res2 = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: plainText,
      }),
    });
    return res2.ok;
  } catch {
    return false;
  }
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

export async function compressImageToDataUrl(file: File, maxDim = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
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
        if (!ctx) return resolve(img.src);
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export const DEFAULT_IMGBB_KEYS = [
  "f3ca95750adeb1abc4ecc8e725991337",
  "2e443aefdb90e0bfa664342d214a99a7",
  "02218ebe0262d0e4b891ccf9786d24fe",
  "5a024dc769944312ea5bf67fe42d2b27",
  "ba2d5677268f9b2dc7ff89bb2f5d33f8",
];

export async function uploadImageToImgbb(
  file: File,
  userApiKey?: string | string[]
): Promise<string> {
  // 1. Fast client-side pre-compression (reduces multi-megabyte photos to ~80-120KB in milliseconds)
  const compressedDataUrl = await compressImageToDataUrl(file, 1200, 0.8);
  const base64Data = compressedDataUrl.replace(/^data:image\/\w+;base64,/, "");

  // 2. Gather all available API keys
  const extraKeys = Array.isArray(userApiKey)
    ? userApiKey
    : userApiKey
    ? [userApiKey]
    : [];

  const allKeys = Array.from(
    new Set([...extraKeys.filter(Boolean), ...DEFAULT_IMGBB_KEYS])
  );

  // 3. Shuffle keys randomly to distribute load evenly across all 5 APIs for high-concurrency uploads
  const shuffledKeys = allKeys.sort(() => Math.random() - 0.5);

  // 4. Try keys with fast 5.5-second timeout and automatic instant failover
  for (const key of shuffledKeys) {
    try {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 5500);

      const form = new FormData();
      form.append("image", base64Data);

      const res = await fetch(`https://api.imgbb.com/1/upload?key=${key}`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        const hostedUrl = json?.data?.display_url || json?.data?.url;
        if (hostedUrl) {
          return hostedUrl;
        }
      }
    } catch {
      // Key timed out or failed, instantly try next key in the pool
      continue;
    }
  }

  // 5. Ultimate fallback: Return high-quality compressed image directly so upload NEVER breaks or blocks user
  return compressedDataUrl;
}
