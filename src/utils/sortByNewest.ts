/**
 * Helpers for deterministic newest-first ordering of Firebase RTDB items
 * and quota-safe sessionStorage caching.
 */

export function isFirebasePushKey(id?: string | null): boolean {
  return typeof id === "string" && id.startsWith("-") && id.length >= 19;
}

export function compareKeysDesc(aId: string, bId: string): number {
  if (aId === bId) return 0;
  return bId > aId ? 1 : -1;
}

export function compareNewestFirst(
  a: { id?: string; createdAt?: number },
  b: { id?: string; createdAt?: number },
  now = Date.now()
): number {
  const idA = String(a.id || "");
  const idB = String(b.id || "");

  // Firebase push keys encode exact server-offset timestamps in strict ASCII order,
  // guaranteeing newest-first order even when client device clocks are skewed.
  if (isFirebasePushKey(idA) && isFirebasePushKey(idB)) {
    return compareKeysDesc(idA, idB);
  }

  const maxValid = now + 5 * 60 * 1000;
  const rawA = Number(a.createdAt) || 0;
  const rawB = Number(b.createdAt) || 0;
  const timeA = rawA > maxValid ? 0 : rawA;
  const timeB = rawB > maxValid ? 0 : rawB;

  if (timeB !== timeA) return timeB - timeA;
  return compareKeysDesc(idA, idB);
}

/**
 * Saves an array to sessionStorage safely, shrinking the cached slice
 * if oversized base64 images would otherwise hit storage quota.
 */
export function safeCacheList<T>(key: string, items: T[], maxItems = 12): void {
  const slice = items.slice(0, maxItems);
  for (let len = slice.length; len >= 1; len = Math.floor(len / 2)) {
    try {
      sessionStorage.setItem(key, JSON.stringify(slice.slice(0, len)));
      return;
    } catch {
      if (len === 1) break;
    }
  }
}
