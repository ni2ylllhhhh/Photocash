import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  House,
  Users,
  Plus,
  Wallet,
  CircleUser,
} from "lucide-react";

interface NavItem {
  to: string;
  label: string;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  isCenter?: boolean;
  badge?: string;
}

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", Icon: House },
  { to: "/refer", label: "Refer", Icon: Users, badge: "0.5$" },
  { to: "/create", label: "Create", Icon: Plus, isCenter: true },
  { to: "/wallet", label: "Wallet", Icon: Wallet },
  { to: "/profile", label: "Profile", Icon: CircleUser },
];

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav
      className="fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 border-t border-slate-100 bg-white/98 shadow-[0_-3px_16px_rgba(0,0,0,0.05)] backdrop-blur-md"
      aria-label="Main navigation"
    >
      <ul className="flex items-end justify-between px-3 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
        {NAV_ITEMS.map(({ to, label, Icon, isCenter, badge }) => (
          <li key={to} className="flex-1 flex justify-center">
            <NavLink
              to={to}
              onClick={(e) => {
                e.preventDefault();
                navigate(to);
              }}
              className="flex flex-col items-center select-none focus:outline-none"
            >
              {({ isActive }) => {
                if (isCenter) {
                  return (
                    <div className="flex flex-col items-center -mt-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-tr from-[#ff385c] via-[#ff5a36] to-[#ff7d1a] text-white shadow-[0_4px_14px_rgba(255,70,40,0.35)] ring-3 ring-white active:scale-95 transition-transform">
                        <Icon size={20} strokeWidth={2.8} className="text-white" />
                      </div>
                      <span className="mt-0.5 text-[10px] font-bold text-[#ff5a36]">
                        {label}
                      </span>
                    </div>
                  );
                }

                return (
                  <div className="flex flex-col items-center gap-0.5">
                    <div className="relative">
                      {badge && (
                        <span className="absolute -top-1 -right-1.5 z-10 rounded-full bg-[#34d399] px-1 py-0.2 text-[8px] font-black text-white shadow-sm leading-tight">
                          {badge}
                        </span>
                      )}
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-all ${
                          isActive
                            ? "bg-gradient-to-tr from-[#ff385c] to-[#ff6338] text-white shadow-[0_3px_10px_rgba(255,56,92,0.32)]"
                            : "bg-[#f0f4fa] text-[#556987]"
                        }`}
                      >
                        <Icon
                          size={16}
                          strokeWidth={isActive ? 2.4 : 2}
                          className={isActive ? "text-white" : "text-[#556987]"}
                        />
                      </div>
                    </div>
                    <span
                      className={`text-[10px] font-bold transition-colors ${
                        isActive ? "text-[#ff385c]" : "text-[#556987]"
                      }`}
                    >
                      {label}
                    </span>
                  </div>
                );
              }}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function LayoutShell({
  children,
  bare = false,
  className = "",
}: {
  children: React.ReactNode;
  bare?: boolean;
  className?: string;
}) {
  return (
    <div className="mx-auto min-h-full w-full max-w-[480px] bg-canvas">
      <main className={`min-h-full w-full ${bare ? "pb-4" : "pb-16"} ${className}`}>
        {children}
      </main>
      {!bare && <BottomNav />}
    </div>
  );
}
