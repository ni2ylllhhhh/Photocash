import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  House,
  Users,
  Plus,
  Wallet,
  User,
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
  { to: "/profile", label: "Profile", Icon: User },
];

export function BottomNav() {
  const navigate = useNavigate();

  return (
    <nav
      className="pointer-events-none fixed bottom-0 left-1/2 z-40 w-full max-w-[480px] -translate-x-1/2 px-3 pb-[max(0.625rem,env(safe-area-inset-bottom))]"
      aria-label="Main navigation"
    >
      <div className="pointer-events-auto rounded-full border border-[#f4c89e] bg-gradient-to-r from-[#fff3e8] via-[#fff6f3] to-[#ffedf2] px-2 py-2 shadow-[0_6px_22px_rgba(217,140,70,0.14),0_2px_8px_rgba(0,0,0,0.06)] backdrop-blur-md">
        <ul className="flex items-end justify-between">
          {NAV_ITEMS.map(({ to, label, Icon, isCenter, badge }) => (
            <li key={to} className="flex flex-1 justify-center">
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
                      <div className="flex flex-col items-center">
                        <div className="-mt-[30px] flex h-[52px] w-[52px] items-center justify-center rounded-full border-2 border-[#d19c42] bg-[radial-gradient(circle_at_35%_28%,#332a17,#0f0d09_72%)] shadow-[0_4px_14px_rgba(180,120,30,0.38),inset_0_1px_2px_rgba(255,225,150,0.35)] transition-transform active:scale-95">
                          <svg
                            width="26"
                            height="26"
                            viewBox="0 0 24 24"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                            className="drop-shadow-[0_1px_4px_rgba(245,185,50,0.55)]"
                          >
                            <defs>
                              <linearGradient id="goldPlusGrad" x1="4" y1="4" x2="20" y2="20" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stopColor="#fff4b8" />
                                <stop offset="45%" stopColor="#f5be3d" />
                                <stop offset="100%" stopColor="#b87614" />
                              </linearGradient>
                            </defs>
                            <path
                              d="M12 4.5V19.5M4.5 12H19.5"
                              stroke="url(#goldPlusGrad)"
                              strokeWidth="3.2"
                              strokeLinecap="round"
                            />
                          </svg>
                        </div>
                        <span
                          className={`mt-0.5 text-[11px] leading-tight transition-colors ${
                            isActive
                              ? "font-bold text-[#946123]"
                              : "font-semibold text-[#8c95a4]"
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="relative flex h-[22px] items-center justify-center">
                        {badge && (
                          <span className="absolute -top-1.5 -right-3.5 z-10 rounded-full bg-[#2ec98e] px-1 py-[1px] text-[7.5px] font-black leading-none text-white shadow-xs">
                            {badge}
                          </span>
                        )}
                        <Icon
                          size={21}
                          strokeWidth={isActive ? 2.2 : 1.75}
                          className={`transition-colors ${
                            isActive ? "text-[#946123]" : "text-[#8c95a4]"
                          }`}
                        />
                      </div>
                      <span
                        className={`text-[11px] leading-tight transition-colors ${
                          isActive
                            ? "font-bold text-[#946123]"
                            : "font-semibold text-[#8c95a4]"
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
      </div>
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
      <main className={`min-h-full w-full ${bare ? "pb-4" : "pb-[88px]"} ${className}`}>
        {children}
      </main>
      {!bare && <BottomNav />}
    </div>
  );
}
