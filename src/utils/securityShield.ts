import { ref, get, set } from "firebase/database";
import { userDb } from "../firebase";

const LOCAL_DEVICE_OWNER_KEY = "pc_device_owner_uid_v1";
const LOCAL_DEVICE_HASH_KEY = "pc_device_hw_hash_v1";

/**
 * Generates a deterministic hardware fingerprint for the current phone/browser
 * combining Screen geometry, WebGL GPU renderer, CPU cores, Timezone, and User-Agent.
 */
export function getHardwareDeviceHash(): string {
  try {
    const cached = localStorage.getItem(LOCAL_DEVICE_HASH_KEY);
    if (cached && cached.length >= 8) return cached;
  } catch {}

  const parts: string[] = [];
  try {
    parts.push(`${window.screen?.width || 0}x${window.screen?.height || 0}x${window.screen?.colorDepth || 0}`);
    parts.push(String(window.devicePixelRatio || 1));
    parts.push(String(navigator.hardwareConcurrency || 0));
    parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    parts.push(navigator.language || "");
    // Strip Telegram-specific dynamic version tail if any, keep hardware model from User-Agent
    const ua = (navigator.userAgent || "").replace(/Telegram-Android\/[\d.]+/g, "TG-A");
    parts.push(ua);

    // WebGL GPU renderer string (identical across all cloned Telegram accounts on the same phone)
    const canvas = document.createElement("canvas");
    const gl =
      (canvas.getContext("webgl") as WebGLRenderingContext | null) ||
      (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (gl) {
      const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo) {
        parts.push(String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || ""));
        parts.push(String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || ""));
      }
    }
  } catch {}

  const raw = parts.join("|");
  let hash1 = 5381;
  let hash2 = 52711;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charCodeAt(i);
    hash1 = (hash1 * 33) ^ ch;
    hash2 = (hash2 * 33) ^ ch;
  }
  const fingerprint = `dev_${(hash1 >>> 0).toString(16)}_${(hash2 >>> 0).toString(16)}`;

  try {
    localStorage.setItem(LOCAL_DEVICE_HASH_KEY, fingerprint);
  } catch {}

  return fingerprint;
}

/**
 * Fetches client public IP (sanitized for Firebase key usage)
 */
export async function getClientIpKey(): Promise<string | null> {
  const endpoints = [
    "https://api.ipify.org?format=json",
    "https://api64.ipify.org?format=json",
  ];
  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) {
        const data = await res.json();
        if (data?.ip) {
          return String(data.ip).trim().replace(/[.#$/[\]:]/g, "_");
        }
      }
    } catch {}
  }
  return null;
}

/**
 * Detects known Telegram multi-account farming tags (e.g. SEED, worm emojis, etc.)
 * or identical farming suffixes between referrer and referee.
 */
export function hasSuspiciousFarmPattern(newUserName: string, referrerName?: string): boolean {
  const name = String(newUserName || "").trim();
  if (!name) return false;

  // Known bot-farm watermarks used by multi-account scripts (like SEED, 🪱, etc.)
  if (/SEED/i.test(name) || name.includes("🪱")) {
    return true;
  }

  if (referrerName) {
    const refClean = String(referrerName).trim();
    // Check if both referrer and new user have the exact same non-standard emoji/symbol watermark
    const emojiRegex = /[\u{1F300}-\u{1FAFF}]/gu;
    const userEmojis: string[] = name.match(emojiRegex) || [];
    const refEmojis: string[] = refClean.match(emojiRegex) || [];
    if (userEmojis.length > 0 && refEmojis.length > 0) {
      const shared = userEmojis.filter((e) => refEmojis.includes(e));
      if (shared.length > 0) return true;
    }
  }

  return false;
}

/**
 * Records the device & IP for a user and verifies whether a referral from `referrerId` -> `newUserId`
 * is a genuine, unique person on a different device and network.
 */
export async function verifyAndLockReferralSecurity(params: {
  newUserId: string;
  newUserName: string;
  referrerId: string;
  referrerName?: string;
  lastReferralAt?: number;
}): Promise<{ allowed: boolean; reason?: string }> {
  const { newUserId, newUserName, referrerId, referrerName, lastReferralAt } = params;

  if (!referrerId || !newUserId || referrerId === newUserId) {
    return { allowed: false, reason: "self_referral" };
  }

  // 1. Check LocalStorage Device Owner Lock (blocks switching accounts inside same Telegram app)
  try {
    const existingOwner = localStorage.getItem(LOCAL_DEVICE_OWNER_KEY);
    if (existingOwner && existingOwner !== newUserId) {
      return { allowed: false, reason: "same_local_device_multi_account" };
    }
    localStorage.setItem(LOCAL_DEVICE_OWNER_KEY, newUserId);
  } catch {}

  // 2. Check Bot-Farm Name Pattern (blocks SEED / 🪱 / cloned account farms)
  if (hasSuspiciousFarmPattern(newUserName, referrerName)) {
    return { allowed: false, reason: "suspicious_farm_name_pattern" };
  }

  // 3. Check Referral Velocity Cooldown (blocks rapid 45-second account switching scripts)
  if (lastReferralAt && Date.now() - lastReferralAt < 90 * 1000) {
    return { allowed: false, reason: "referral_cooldown_too_fast" };
  }

  // 4. Hardware Fingerprint Lock in Firebase (`security_locks/devices/${deviceHash}`)
  const deviceHash = getHardwareDeviceHash();
  try {
    const devRef = ref(userDb, `security_locks/devices/${deviceHash}`);
    const devSnap = await get(devRef);
    if (devSnap.exists()) {
      const devData = devSnap.val();
      // If this physical phone hardware was already used by the referrer or another account
      if (devData?.uid && devData.uid !== newUserId) {
        return { allowed: false, reason: "duplicate_hardware_device" };
      }
    } else {
      await set(devRef, {
        uid: newUserId,
        referrerId,
        createdAt: Date.now(),
      });
    }
  } catch {}

  // 5. Public IP Lock in Firebase (`security_locks/ips/${ipKey}`)
  const ipKey = await getClientIpKey();
  if (ipKey) {
    try {
      const ipRef = ref(userDb, `security_locks/ips/${ipKey}`);
      const ipSnap = await get(ipRef);
      if (ipSnap.exists()) {
        const ipData = ipSnap.val();
        // Block if this IP belongs to the referrer or was already used to register another account within 24 hours
        if (
          ipData?.uid &&
          ipData.uid !== newUserId &&
          (ipData.uid === referrerId ||
            ipData.referrerId === referrerId ||
            Date.now() - Number(ipData.updatedAt || 0) < 24 * 60 * 60 * 1000)
        ) {
          return { allowed: false, reason: "duplicate_ip_address" };
        }
      }
      await set(ipRef, {
        uid: newUserId,
        referrerId,
        updatedAt: Date.now(),
      });
    } catch {}
  }

  return { allowed: true };
}

/**
 * Registers the current user's device & IP on normal login so the referrer's own phone
 * is always locked to the referrer's UID before they try switching accounts.
 */
export async function registerUserDeviceAndIp(userId: string): Promise<void> {
  if (!userId) return;
  try {
    const existingOwner = localStorage.getItem(LOCAL_DEVICE_OWNER_KEY);
    if (!existingOwner) {
      localStorage.setItem(LOCAL_DEVICE_OWNER_KEY, userId);
    }
  } catch {}

  const deviceHash = getHardwareDeviceHash();
  try {
    const devRef = ref(userDb, `security_locks/devices/${deviceHash}`);
    const devSnap = await get(devRef);
    if (!devSnap.exists()) {
      await set(devRef, { uid: userId, createdAt: Date.now() });
    }
  } catch {}

  const ipKey = await getClientIpKey();
  if (ipKey) {
    try {
      const ipRef = ref(userDb, `security_locks/ips/${ipKey}`);
      const ipSnap = await get(ipRef);
      if (!ipSnap.exists()) {
        await set(ipRef, { uid: userId, updatedAt: Date.now() });
      }
    } catch {}
  }
}
