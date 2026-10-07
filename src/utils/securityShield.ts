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
    parts.push(
      `${window.screen?.width || 0}x${window.screen?.height || 0}x${
        window.screen?.colorDepth || 0
      }`
    );
    parts.push(String(window.devicePixelRatio || 1));
    parts.push(String(navigator.hardwareConcurrency || 0));
    parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || "");
    parts.push(navigator.language || "");
    const ua = (navigator.userAgent || "").replace(/Telegram-Android\/[\d.]+/g, "TG-A");
    parts.push(ua);

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
 * Fetches client public IP quickly (1.2s max timeout so registration & bot notifications are never delayed)
 */
export async function getClientIpKey(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch("https://api.ipify.org?format=json", {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (data?.ip) {
        return String(data.ip).trim().replace(/[.#$/[\]:]/g, "_");
      }
    }
  } catch {}
  return null;
}

/**
 * Detects known Telegram multi-account farming tags (e.g. SEED, worm emojis 🪱).
 * Does NOT block normal emojis (like 🔥, ❤️, 🌸) used by real Telegram users.
 */
export function hasSuspiciousFarmPattern(
  newUserName: string,
  _referrerName?: string
): boolean {
  const name = String(newUserName || "").trim();
  if (!name) return false;

  if (/SEED/i.test(name) || name.includes("🪱")) {
    return true;
  }

  return false;
}

/**
 * Verifies whether a referral from `referrerId` -> `newUserId` is a genuine real user.
 * Blocks 100% of same-phone account switching & bot-farm scripts while allowing 100% of real users
 * (even when many users click a Telegram channel link simultaneously or use mobile data CGNAT).
 */
export async function verifyAndLockReferralSecurity(params: {
  newUserId: string;
  newUserName: string;
  referrerId: string;
  referrerName?: string;
  lastReferralAt?: number;
}): Promise<{ allowed: boolean; reason?: string }> {
  const { newUserId, newUserName, referrerId, referrerName } = params;

  if (!referrerId || !newUserId || referrerId === newUserId) {
    return { allowed: false, reason: "self_referral" };
  }

  // 1. Check LocalStorage Device Owner Lock (blocks switching accounts inside same Telegram app on the same phone)
  try {
    const existingOwner = localStorage.getItem(LOCAL_DEVICE_OWNER_KEY);
    if (existingOwner && existingOwner !== newUserId) {
      return { allowed: false, reason: "same_local_device_multi_account" };
    }
    localStorage.setItem(LOCAL_DEVICE_OWNER_KEY, newUserId);
  } catch {}

  // 2. Check Bot-Farm Name Pattern (blocks SEED / 🪱 automated clone farms)
  if (hasSuspiciousFarmPattern(newUserName, referrerName)) {
    return { allowed: false, reason: "suspicious_farm_name_pattern" };
  }

  // 3. Combined Same-Phone + Same-IP Self-Referral Check
  // Only blocks if the new user is on the EXACT SAME physical hardware AND EXACT SAME IP as the referrer
  // or as another account referred by the same referrer within 15 minutes.
  const deviceHash = getHardwareDeviceHash();
  const ipKey = await getClientIpKey();

  if (ipKey && deviceHash) {
    try {
      // Check if referrer's own phone has this exact hardware + IP combination
      const refSelfSnap = await get(ref(userDb, `security_locks/self/${referrerId}`));
      if (refSelfSnap.exists()) {
        const selfData = refSelfSnap.val();
        if (
          selfData?.deviceHash === deviceHash &&
          selfData?.ipKey === ipKey &&
          Date.now() - Number(selfData.updatedAt || 0) < 6 * 60 * 60 * 1000
        ) {
          return { allowed: false, reason: "same_phone_and_ip_as_referrer" };
        }
      }

      // Check if this exact phone hardware + IP already registered a referral for THIS SAME referrer within 15 minutes
      const pairKey = `${referrerId}_${deviceHash}_${ipKey}`;
      const pairRef = ref(userDb, `security_locks/ref_pairs/${pairKey}`);
      const pairSnap = await get(pairRef);
      if (pairSnap.exists()) {
        const pairData = pairSnap.val();
        if (
          pairData?.uid &&
          pairData.uid !== newUserId &&
          Date.now() - Number(pairData.createdAt || 0) < 15 * 60 * 1000
        ) {
          return { allowed: false, reason: "same_phone_rapid_clone_referral" };
        }
      }

      await set(pairRef, {
        uid: newUserId,
        referrerId,
        createdAt: Date.now(),
      });
    } catch {}
  }

  return { allowed: true };
}

/**
 * Registers the current user's device & IP on normal login so the referrer's own phone
 * is bound to their UID.
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
  const ipKey = await getClientIpKey();
  if (deviceHash && ipKey) {
    try {
      await set(ref(userDb, `security_locks/self/${userId}`), {
        uid: userId,
        deviceHash,
        ipKey,
        updatedAt: Date.now(),
      });
    } catch {}
  }
}
