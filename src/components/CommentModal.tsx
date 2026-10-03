import { ref, push, set } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { formatTimeAgo } from "../utils";
import { X } from "lucide-react";

const EMOJIS = ["👍", "❤️", "🔥", "👏", "🎉", "😍", "💰", "⚡"];

export function CommentModal({
  post,
  onClose,
}: {
  post: Post | null;
  onClose: () => void;
}) {
  const { user } = useUser();
  if (!post) return null;

  const commentsList = post.comments
    ? Object.values(post.comments).sort((a, b) => b.createdAt - a.createdAt)
    : [];

  const handleSendEmoji = async (emoji: string) => {
    if (!user) return;
    const commentsRef = push(ref(contentDb, `posts/${post.id}/comments`));
    await set(commentsRef, {
      id: commentsRef.key,
      uid: user.id,
      name: user.name,
      photo: user.photo,
      emoji,
      createdAt: Date.now(),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Comments"
        className="w-full max-w-[480px] rounded-t-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-3 py-2">
          <h2 className="text-[13px] font-bold text-ink">
            Comments ({commentsList.length})
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="flex h-6 w-6 items-center justify-center rounded-full bg-canvas"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-56 overflow-y-auto px-3 py-2">
          {commentsList.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-muted">
              No reactions yet — send the first emoji!
            </p>
          ) : (
            <ul className="space-y-2">
              {commentsList.map((item) => (
                <li key={item.id} className="flex items-center gap-2">
                  <img
                    src={item.photo}
                    alt=""
                    className="h-7 w-7 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] font-semibold text-ink">
                      {item.name}
                    </p>
                    <p className="text-[10px] text-muted">
                      {formatTimeAgo(item.createdAt)}
                    </p>
                  </div>
                  <span className="text-xl">{item.emoji}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-line px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))]">
          <p className="mb-1.5 text-[10px] font-medium text-muted">
            Emoji comment only
          </p>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => handleSendEmoji(emoji)}
                aria-label={`Comment ${emoji}`}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-lg active:scale-90"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
