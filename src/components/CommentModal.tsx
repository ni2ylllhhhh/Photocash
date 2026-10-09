import React, { useState } from "react";
import { ref, push, set } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { formatTimeAgo, formatCompactNumber } from "../utils";
import {
  getPostCommentsCount,
  getCombinedPostComments,
  useEngagementTick,
} from "../utils/postEngagement";
import { VerifiedBadge } from "./VerifiedBadge";
import { X, Send } from "lucide-react";

const EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "😍", "💰", "⚡"];

export function CommentModal({
  post,
  onClose,
}: {
  post: Post | null;
  onClose: () => void;
}) {
  const { user } = useUser();
  const now = useEngagementTick(15000);
  const [textInput, setTextInput] = useState("");
  const [sending, setSending] = useState(false);

  if (!post) return null;

  const totalCommentsCount = getPostCommentsCount(post, now);
  const commentsList = getCombinedPostComments(post, now, 50);

  const handleSendEmoji = async (emoji: string) => {
    if (!user || sending) return;
    setSending(true);
    try {
      const commentsRef = push(ref(contentDb, `posts/${post.id}/comments`));
      await set(commentsRef, {
        id: commentsRef.key,
        uid: user.id,
        name: user.name,
        photo: user.photo,
        emoji,
        text: "",
        createdAt: Date.now(),
      });
    } finally {
      setSending(false);
    }
  };

  const handleSendText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanText = textInput.trim();
    if (!user || !cleanText || sending) return;
    setSending(true);
    setTextInput("");
    try {
      const commentsRef = push(ref(contentDb, `posts/${post.id}/comments`));
      await set(commentsRef, {
        id: commentsRef.key,
        uid: user.id,
        name: user.name,
        photo: user.photo,
        emoji: "💬",
        text: cleanText,
        createdAt: Date.now(),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Comments"
        className="w-full max-w-[480px] rounded-t-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-3.5 py-2.5">
          <h2 className="text-[13px] font-bold text-ink">
            Comments ({formatCompactNumber(totalCommentsCount)})
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas text-ink"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-64 overflow-y-auto px-3.5 py-2.5">
          {commentsList.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">
              No comments yet — be the first to comment!
            </p>
          ) : (
            <ul className="space-y-2.5">
              {commentsList.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2.5 rounded-xl bg-canvas/60 px-2.5 py-2"
                >
                  <img
                    src={item.photo}
                    alt=""
                    className="mt-0.5 h-7 w-7 shrink-0 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="flex items-center gap-1 text-[12px] font-bold text-ink">
                        <span className="truncate">{item.name}</span>
                        <VerifiedBadge className="h-[13px] w-[13px]" />
                      </p>
                      <span className="shrink-0 text-[10px] text-muted">
                        {formatTimeAgo(item.createdAt)}
                      </span>
                    </div>
                    {item.text ? (
                      <p className="mt-0.5 break-words text-[12px] leading-snug text-ink">
                        {item.text}
                      </p>
                    ) : (
                      <span className="mt-0.5 inline-block text-lg leading-none">
                        {item.emoji}
                      </span>
                    )}
                  </div>
                  {item.text && item.emoji && item.emoji !== "💬" && (
                    <span className="shrink-0 text-base">{item.emoji}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line px-3 py-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
          {/* Quick Emoji Reaction Bar */}
          <div className="no-scrollbar mb-2 flex gap-1.5 overflow-x-auto">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSendEmoji(emoji)}
                aria-label={`Comment ${emoji}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-base transition active:scale-90 hover:bg-gray-200/70"
              >
                {emoji}
              </button>
            ))}
          </div>

          {/* Text Comment Input */}
          <form onSubmit={handleSendText} className="flex items-center gap-2">
            {user?.photo && (
              <img
                src={user.photo}
                alt=""
                className="h-7 w-7 shrink-0 rounded-full object-cover"
              />
            )}
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="Write a comment..."
              maxLength={300}
              className="flex-1 rounded-full border border-line bg-canvas px-3.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-brand-pink"
            />
            <button
              type="submit"
              disabled={!textInput.trim() || sending}
              aria-label="Send comment"
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white transition active:scale-90 ${
                textInput.trim() && !sending ? "brand-grad shadow-xs" : "bg-gray-300"
              }`}
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
