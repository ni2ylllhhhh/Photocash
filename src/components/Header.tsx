import { useNavigate } from "react-router-dom";
import { Plus, Search, Send } from "lucide-react";
import { useSettings } from "../context/SettingsContext";
import { openExternalLink } from "../utils";

export function Header({ onSearch }: { onSearch?: () => void }) {
  const navigate = useNavigate();
  const { settings } = useSettings();

  const handleOpenBotChat = () => {
    const cleanBotUsername = (settings.botUsername || "PhotoCash12_bot")
      .replace(/^https?:\/\/t\.me\//i, "")
      .replace(/^@/, "")
      .split("/")[0]
      .split("?")[0]
      .trim();
    const botChatUrl = cleanBotUsername
      ? `https://t.me/${cleanBotUsername}`
      : settings.botLink || "https://t.me/PhotoCash12_bot";
    openExternalLink(botChatUrl);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[#f4c89e]/80 bg-gradient-to-r from-[#fff3e8] via-[#fff6f3] to-[#ffedf2] px-3 py-1.5 shadow-[0_2px_10px_rgba(217,140,70,0.08)]">
      <div className="flex items-center">
        <img
          src="/assets/photocash-header-logo.png"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).src =
              "https://i.ibb.co/rK4GDfLW/file-00000000ffac82119b6a8714423cb0bd.png";
          }}
          alt="PhotoCash"
          className="h-14 w-auto max-w-[200px] -my-1 object-contain select-none"
        />
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => navigate("/create")}
          aria-label="Create post"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[#f4c89e]/50 bg-white/80 text-ink shadow-xs active:scale-95"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={() => (onSearch ? onSearch() : navigate("/search"))}
          aria-label="Search"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[#f4c89e]/50 bg-white/80 text-ink shadow-xs active:scale-95"
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          onClick={handleOpenBotChat}
          aria-label="Open Bot Chat"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-[#f4c89e]/50 bg-white/80 text-ink shadow-xs active:scale-95"
        >
          <Send size={15} />
        </button>
      </div>
    </header>
  );
}
