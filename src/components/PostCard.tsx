import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ref, update, remove } from "firebase/database";
import { contentDb } from "../firebase";
import { Post } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { useStarReward } from "../context/StarRewardContext";
import { formatTimeAgo, formatCompactNumber } from "../utils";
import {
  EllipsisVertical,
  Check,
  Share2,
  Sparkles,
  Heart,
  MessageSquare,
} from "lucide-react";

export function PostCard({
  post,
  onComment,
}: {
  post: Post;
  onComment: (post: Post) => void;
}) {
  const navigate = useNavigate();
  const { user, toggleFollow, isFollowing } = useUser();
  const { settings } = useSettings();
  const { startStarSession } = useStarReward();
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showFullCaption, setShowFullCaption] = useState(false);
  const [imageExpanded, setImageExpanded] = useState(false);

  const likesCount = post.likes ? Object.keys(post.likes).length : 0;
  const starsCount =
    typeof post.starsCount === "number"
      ? post.starsCount
      : typeof post.stars === "number"
      ? post.stars
      : post.stars && typeof post.stars === "object"
      ? Object.keys(post.stars).length
      : 0;
  const commentsCount = post.comments ? Object.keys(post.comments).length : 0;
  const isLiked = Boolean(user && post.likes?.[user.id]);
  const isAuthor = user?.id === post.authorId;
  const following = isFollowing(post.authorId);

  const handleLike = async () => {
    if (!user) return;
    await update(ref(contentDb, `posts/${post.id}/likes`), {
      [user.id]: isLiked ? null : true,
    });
  };

  const handleStar = () => {
    startStarSession(post.id, post.authorName, post.authorId);
  };

  const handleShare = async () => {
    const shareUrl = `${settings.botLink}?start=${user?.id ?? ""}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: "PhotoCash",
          text: post.caption ?? "",
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
      }
    } catch {}
  };

  const handleDelete = async () => {
    await remove(ref(contentDb, `posts/${post.id}`));
    setMenuOpen(false);
  };

  const captionText = post.caption ?? "";
  const isLong = captionText.length > 120;

  return (
    <article className="mb-1.5 bg-white">
      <header className="flex items-start gap-2 px-3 pt-2.5">
        <button
          type="button"
          onClick={() => navigate(`/u/${post.authorId}`)}
          aria-label={post.authorName}
        >
          <img
            src={post.authorPhoto}
            alt=""
            className="h-9 w-9 rounded-full object-cover"
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate(`/u/${post.authorId}`)}
              className="truncate text-[13px] font-bold text-ink"
            >
              {post.authorName}
            </button>
            {!isAuthor && (
              <button
                type="button"
                onClick={() => toggleFollow(post.authorId)}
                className={`shrink-0 rounded-full px-2.5 py-[3px] text-[10px] font-bold transition ${
                  following ? "bg-canvas text-ink" : "brand-grad text-white"
                }`}
              >
                {following ? "Following" : "Follow"}
              </button>
            )}
          </div>
          <p className="truncate text-[11px] text-muted">
            @{post.authorUsername} • {formatTimeAgo(post.createdAt)}
          </p>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-label="Post options"
            className="p-1 text-muted"
          >
            <EllipsisVertical size={16} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 w-32 overflow-hidden rounded-lg border border-line bg-white text-[12px] shadow-lg">
              <button
                type="button"
                onClick={() => {
                  navigate(`/u/${post.authorId}`);
                  setMenuOpen(false);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-canvas"
              >
                View profile
              </button>
              <button
                type="button"
                onClick={handleShare}
                className="block w-full px-3 py-2 text-left hover:bg-canvas"
              >
                Copy link
              </button>
              {isAuthor && (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="block w-full px-3 py-2 text-left text-brand-pink hover:bg-canvas"
                >
                  Delete post
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Caption with Facebook-style 120 character truncation and tap-to-toggle */}
      {captionText && (
        <div
          onClick={() => isLong && setShowFullCaption((prev) => !prev)}
          className={`cursor-pointer whitespace-pre-wrap px-3 pb-2 pt-1.5 text-[13px] leading-snug text-ink ${
            isLong ? "select-none" : ""
          }`}
        >
          {isLong && !showFullCaption ? (
            <span>
              {captionText.slice(0, 120)}...{" "}
              <span className="font-bold text-muted hover:underline">
                See more
              </span>
            </span>
          ) : (
            <span>
              {captionText}
              {isLong && (
                <span className="ml-1 font-bold text-muted hover:underline">
                  {" "}See less
                </span>
              )}
            </span>
          )}
        </div>
      )}

      {/* Post Photo with 4:3 ratio default, tap to expand/collapse */}
      {post.imageUrl && (
        <div className="relative w-full bg-black">
          <button
            type="button"
            onClick={() => setImageExpanded((prev) => !prev)}
            className="relative block w-full overflow-hidden focus:outline-none"
            aria-label={imageExpanded ? "Collapse image" : "Expand image"}
          >
            <img
              src={post.imageUrl}
              alt={post.caption || "Post photo"}
              className={`w-full transition-all duration-300 ${
                imageExpanded
                  ? "max-h-[85vh] object-contain"
                  : "aspect-[4/3] object-cover"
              }`}
              loading="lazy"
            />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-line px-3 py-1.5">
        <div className="flex items-center gap-3 text-[12px] font-medium">
          <span className="flex items-center gap-1 font-bold text-amber-600">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-gradient-to-tr from-amber-500 to-yellow-400 text-[10px] text-white shadow-xs">
              ★
            </span>
            {formatCompactNumber(starsCount)} Stars
          </span>
          <span className="text-gray-300">•</span>
          <span className="flex items-center gap-1 font-semibold text-rose-500">
            <Heart size={13} className="fill-rose-500 text-rose-500" />
            {formatCompactNumber(likesCount)} Likes
          </span>
        </div>
        <span className="text-[12px] text-muted">
          {formatCompactNumber(commentsCount)} Comments • Share
        </span>
      </div>

      <div className="grid grid-cols-4 border-b-[6px] border-canvas">
        <ActionButton
          icon={<Sparkles size={16} className="text-amber-500" />}
          label="Star"
          onClick={handleStar}
          className="text-amber-600 hover:text-amber-700"
        />
        <ActionButton
          icon={<Heart size={16} fill={isLiked ? "#f2295b" : "none"} className={isLiked ? "text-[#f2295b]" : ""} />}
          label="Like"
          onClick={handleLike}
          active={isLiked}
        />
        <ActionButton
          icon={<MessageSquare size={16} />}
          label="Comment"
          onClick={() => onComment(post)}
        />
        <ActionButton
          icon={copied ? <Check size={16} /> : <Share2 size={16} />}
          label={copied ? "Copied" : "Share"}
          onClick={handleShare}
        />
      </div>
    </article>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  active,
  className = "",
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 py-2 text-[12px] font-semibold transition active:bg-canvas ${
        active ? "text-brand-pink" : className || "text-muted"
      }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}
