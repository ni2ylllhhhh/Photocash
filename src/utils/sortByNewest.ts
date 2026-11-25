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
  if (!items || items.length === 0) {
    try {
      sessionStorage.removeItem(key);
    } catch {}
    return;
  }
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

export function clearDeletedContentCaches(opts: {
  userId?: string;
  postId?: string;
  storyId?: string;
}): void {
  try {
    if (opts.userId) {
      sessionStorage.removeItem(`pc_user_profile_v1_${opts.userId}`);
      sessionStorage.removeItem(`pc_user_posts_v2_${opts.userId}`);
      sessionStorage.removeItem("pc_search_seed_users_v1");

      // Scrub any posts/stories by this deleted user from feed & story caches
      const feedRaw = sessionStorage.getItem("pc_cached_posts_v2");
      if (feedRaw) {
        const parsed = JSON.parse(feedRaw);
        if (Array.isArray(parsed)) {
          safeCacheList(
            "pc_cached_posts_v2",
            parsed.filter((p: any) => p?.authorId !== opts.userId),
            8
          );
        }
      }
      const storiesRaw = sessionStorage.getItem("pc_cached_stories_v3");
      if (storiesRaw) {
        const parsed = JSON.parse(storiesRaw);
        if (Array.isArray(parsed)) {
          safeCacheList(
            "pc_cached_stories_v3",
            parsed.filter((s: any) => s?.authorId !== opts.userId),
            50
          );
        }
      }
    }

    if (opts.postId) {
      const feedRaw = sessionStorage.getItem("pc_cached_posts_v2");
      if (feedRaw) {
        const parsed = JSON.parse(feedRaw);
        if (Array.isArray(parsed)) {
          safeCacheList(
            "pc_cached_posts_v2",
            parsed.filter((p: any) => p?.id !== opts.postId),
            8
          );
        }
      }
    }

    if (opts.storyId) {
      const storiesRaw = sessionStorage.getItem("pc_cached_stories_v3");
      if (storiesRaw) {
        const parsed = JSON.parse(storiesRaw);
        if (Array.isArray(parsed)) {
          safeCacheList(
            "pc_cached_stories_v3",
            parsed.filter((s: any) => s?.id !== opts.storyId),
            50
          );
        }
      }
    }
  } catch {}
}
