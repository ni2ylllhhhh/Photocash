import { RequiredChannel } from "../types";
import { resolveBotToken, encryptBotToken } from "./tokenVault";

export interface ChannelCheckResult {
  channel: RequiredChannel;
  joined: boolean;
  status?: string;
  error?: string;
}

export function extractTelegramUsername(urlOrUsername: string): string {
  if (!urlOrUsername) return "";
  let clean = urlOrUsername.trim();
  clean = clean.replace(/https?:\/\/t\.me\//i, "");
  clean = clean.replace(/^@/, "");
  clean = clean.split("/")[0].split("?")[0].trim();
  return clean;
}

export function markChannelVerified(usernameOrUrl: string) {
  const username = extractTelegramUsername(usernameOrUrl);
  if (!username) return;
  try {
    sessionStorage.setItem(`pc_verified_${username}`, "true");
  } catch {}
}

export function unmarkChannelVerified(usernameOrUrl: string) {
  const username = extractTelegramUsername(usernameOrUrl);
  if (!username) return;
  try {
    localStorage.removeItem(`pc_verified_${username}`);
    sessionStorage.removeItem(`pc_verified_${username}`);
  } catch {}
}

/**
 * Real live channel verification with the Telegram Bot
 * Only returns joined: true IF AND ONLY IF the bot confirms membership with Telegram API!
 */
export async function checkChannelMembership(
  botToken: string,
  channel: RequiredChannel,
  userId: string | number
): Promise<ChannelCheckResult> {
  const username = extractTelegramUsername(channel.username || channel.url);
  if (!username) {
    return { channel, joined: false, status: "missing_username" };
  }

  // Extract numerical Telegram user ID
  const rawId = String(userId);
  const numIdMatch = rawId.match(/\d{5,}/);
  const telegramId = numIdMatch ? numIdMatch[0] : "";

  if (!telegramId) {
    return { channel, joined: false, status: "no_telegram_id" };
  }

  const resolvedToken = resolveBotToken(botToken);

  // 1. Check via Server Proxy /api/verify-channel (zero CORS, server-to-server)
  try {
    const res = await fetch(
      `/api/verify-channel?user_id=${telegramId}&channel=${encodeURIComponent(
        username
      )}&bot_token=${encodeURIComponent(encryptBotToken(resolvedToken))}`,
      { signal: AbortSignal.timeout(3500) }
    );
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.joined) {
        markChannelVerified(username);
        return { channel, joined: true, status: data.status || "member" };
      }
      if (data.ok && (data.status === "left" || data.status === "kicked")) {
        unmarkChannelVerified(username);
        return { channel, joined: false, status: data.status, error: data.description };
      }
    }
  } catch {
    // Server proxy unreachable; fallback to direct API
  }

  // 2. Direct Telegram API fallback
  if (resolvedToken) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${resolvedToken}/getChatMember?chat_id=@${encodeURIComponent(
          username
        )}&user_id=${telegramId}`,
        { signal: AbortSignal.timeout(3500) }
      );
      const data = await res.json();

      if (data.ok && data.result) {
        const status = data.result.status;
        const isMember =
          status === "member" ||
          status === "administrator" ||
          status === "creator" ||
          status === "restricted";

        if (isMember) {
          markChannelVerified(username);
          return { channel, joined: true, status };
        } else {
          unmarkChannelVerified(username);
          return { channel, joined: false, status };
        }
      }
    } catch (err: any) {
      console.warn(`Telegram API direct check notice for @${username}:`, err);
    }
  }

  return { channel, joined: false, status: "not_joined" };
}

export async function verifyAllChannels(
  botToken: string,
  channels: RequiredChannel[],
  userId: string | number
): Promise<{ allJoined: boolean; results: ChannelCheckResult[] }> {
  if (!channels || channels.length === 0) {
    return { allJoined: true, results: [] };
  }

  const results = await Promise.all(
    channels.map((ch) => checkChannelMembership(botToken, ch, userId))
  );

  const allJoined = results.length > 0 && results.every((r) => r.joined);
  return { allJoined, results };
}
