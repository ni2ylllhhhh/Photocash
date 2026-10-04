import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { userDb } from "../firebase";
import { Withdrawal } from "../types";
import { useUser } from "../context/UserContext";
import { useSettings } from "../context/SettingsContext";
import { LayoutShell } from "../components/Navigation";
import { formatUSDT, openExternalLink } from "../utils";
import { ChevronLeft, ChevronDown, Headphones } from "lucide-react";

function formatDateTime(timestamp?: number): string {
  if (!timestamp) return "—";
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return "—";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
}

function formatMethodLabel(method: string): string {
  const lower = (method || "").toLowerCase();
  if (lower.includes("bkash")) return "BKASH";
  if (lower.includes("nagad")) return "NAGAD";
  if (lower.includes("binance")) return "BINANCE";
  return (method || "BKASH").toUpperCase();
}

export function PaymentsPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const { settings } = useSettings();
  const [withdrawals, setWithdrawals] = useState<(Withdrawal & { orderNumber: number })[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [timeFilter, setTimeFilter] = useState<string>("all");

  useEffect(() => {
    if (!user) return;
    const wRef = ref(userDb, "withdrawals");
    const unsubscribe = onValue(wRef, (snapshot) => {
      const data = snapshot.val() || {};
      const list: Withdrawal[] = Object.entries(data).map(([key, val]: [string, any]) => ({
        ...val,
        id: val.id || key,
      }));

      // Sort oldest to newest first to assign sequential WD-0000000001, WD-0000000002...
      const userAsc = list
        .filter((w) => w.uid === user.id)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .map((w, idx) => ({
          ...w,
          orderNumber: idx + 1,
        }));

      // Display newest first
      userAsc.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      setWithdrawals(userAsc);
    });
    return () => unsubscribe();
  }, [user?.id]);

  const filteredWithdrawals = useMemo(() => {
    const now = Date.now();
    return withdrawals.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) {
        return false;
      }
      if (timeFilter === "today") {
        return now - (item.createdAt || 0) <= 24 * 60 * 60 * 1000;
      }
      if (timeFilter === "7d") {
        return now - (item.createdAt || 0) <= 7 * 24 * 60 * 60 * 1000;
      }
      if (timeFilter === "30d") {
        return now - (item.createdAt || 0) <= 30 * 24 * 60 * 60 * 1000;
      }
      return true;
    });
  }, [withdrawals, statusFilter, timeFilter]);

  const renderStatusText = (status: string) => {
    if (status === "approved") {
      return (
        <span className="text-[14px] font-extrabold text-emerald-600">
          Approved
        </span>
      );
    }
    if (status === "rejected") {
      return (
        <span className="text-[14px] font-extrabold text-rose-500">
          Rejected
        </span>
      );
    }
    return (
      <span className="text-[14px] font-extrabold text-[#d99b16]">
        Pending Review
      </span>
    );
  };

  return (
    <LayoutShell bare className="min-h-screen bg-[#faf6f0]">
      {/* Top Header matching Screenshot 2 */}
      <header className="flex items-center justify-between border-b border-[#efe7dc] bg-white px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f9f3eb] text-[#c87d28] transition active:scale-95"
          >
            <ChevronLeft size={21} strokeWidth={2.4} />
          </button>
          <h1 className="text-[18px] font-extrabold tracking-tight text-[#111111]">
            Withdrawal Records
          </h1>
        </div>

        <button
          type="button"
          onClick={() => openExternalLink(settings.supportLink)}
          aria-label="Support"
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f9f3eb] text-[#c87d28] transition active:scale-95"
        >
          <Headphones size={20} strokeWidth={2.1} />
        </button>
      </header>

      {/* Filter Dropdowns Row matching Screenshot 2 */}
      <div className="grid grid-cols-2 gap-3 border-b border-[#efe7dc] bg-white px-4 py-3.5">
        <div className="relative">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full appearance-none rounded-xl border border-[#e6dccf] bg-white px-3.5 py-2.5 pr-8 text-[14px] font-medium text-[#222222] outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#777777]"
          />
        </div>

        <div className="relative">
          <select
            value={timeFilter}
            onChange={(e) => setTimeFilter(e.target.value)}
            className="w-full appearance-none rounded-xl border border-[#e6dccf] bg-white px-3.5 py-2.5 pr-8 text-[14px] font-medium text-[#222222] outline-none"
          >
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#777777]"
          />
        </div>
      </div>

      {/* Withdrawal Records List */}
      {filteredWithdrawals.length === 0 ? (
        <div className="bg-white py-12 text-center text-[13px] font-medium text-[#8e8e93]">
          No withdrawal records found.
        </div>
      ) : (
        <div className="space-y-2.5 pb-8">
          {filteredWithdrawals.map((item) => {
            const wdCode = `WD-${String(item.orderNumber).padStart(10, "0")}`;
            return (
              <div
                key={item.id}
                className="border-b border-[#efe7dc] bg-white px-4 py-4"
              >
                {/* Top Row: WD-0000000003 & Status */}
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[15px] font-bold text-[#1a1a1a]">
                    {wdCode}
                  </span>
                  {renderStatusText(item.status)}
                </div>

                {/* Method */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[14px] font-medium text-[#8e8e93]">
                    Method
                  </span>
                  <span className="text-[14px] font-bold text-[#222222]">
                    {formatMethodLabel(item.method)}
                  </span>
                </div>

                {/* Amount */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[14px] font-medium text-[#8e8e93]">
                    Amount
                  </span>
                  <span className="text-[14.5px] font-extrabold text-[#1a1a1a]">
                    {formatUSDT(item.amount, 2)}
                  </span>
                </div>

                {/* number */}
                <div className="flex items-center justify-between py-1.5">
                  <span className="text-[14px] font-medium text-[#8e8e93]">
                    number
                  </span>
                  <span className="text-[15px] font-bold text-[#111111]">
                    {item.account}
                  </span>
                </div>

                {/* Divider */}
                <div className="my-2.5 border-t border-[#f3efe8]" />

                {/* Application time */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-[14px] font-medium text-[#8e8e93]">
                    Application time
                  </span>
                  <span className="text-[14px] font-semibold text-[#4a4a4a]">
                    {formatDateTime(item.createdAt)}
                  </span>
                </div>

                {/* Update time */}
                <div className="flex items-center justify-between py-1">
                  <span className="text-[14px] font-medium text-[#8e8e93]">
                    Update time
                  </span>
                  <span className="text-[14px] font-semibold text-[#4a4a4a]">
                    {item.updatedAt ? formatDateTime(item.updatedAt) : "—"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </LayoutShell>
  );
}
