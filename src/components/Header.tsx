import { useNavigate } from "react-router-dom";
import { Plus, Search, Send } from "lucide-react";
import { APP_LOGO_URL } from "../types";

export function Header({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <img
          src={APP_LOGO_URL}
          alt="PhotoCash Logo"
          className="h-7 w-7 rounded-full object-cover shadow-sm ring-1 ring-brand-orange/40"
        />
        <h1 className="text-[17px] font-extrabold tracking-tight text-ink">
          PhotoCash
        </h1>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => navigate("/create")}
          aria-label="Create post"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-ink active:scale-95"
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          onClick={onSearch}
          aria-label="Search"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-ink active:scale-95"
        >
          <Search size={15} />
        </button>
        <button
          type="button"
          onClick={() => navigate("/wallet")}
          aria-label="Wallet"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-canvas text-ink active:scale-95"
        >
          <Send size={15} />
        </button>
      </div>
    </header>
  );
}
