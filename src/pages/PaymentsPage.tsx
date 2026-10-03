import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ref, onValue } from "firebase/database";
import { userDb } from "../firebase";
import { Withdrawal } from "../types";
import { useUser } from "../context/UserContext";
import { LayoutShell } from "../components/Navigation";
import { formatUSDT, formatTimeAgo } from "../utils";
import { ArrowLeft } from "lucide-react";

export function PaymentsPage() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);

  useEffect(() => {
    if (!user) return;
    const wRef = ref(userDb, "withdrawals");
    const unsubscribe = onValue(wRef, (snapshot) => {
      const data = snapshot.val() || {};
      const list: Withdrawal[] = Object.values(data);
      const userList = list
        .filter((w) => w.uid === user.id)
        .sort((a, b) => b.createdAt - a.createdAt);
      setWithdrawals(userList);
    });
    return () => unsubscribe();
  }, [user?.id]);

  const badgeClass = (status: string) => {
    if (status === "approved") return "bg-green-50 text-green-600";
    if (status === "rejected") return "bg-red-50 text-red-600";
    return "bg-amber-50 text-amber-600";
  };

  return (
    <LayoutShell bare className="px-3 pt-3">
      <header className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Back"
          className="p-1"
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-[17px] font-extrabold text-ink">Payments</h1>
      </header>

      {withdrawals.length === 0 ? (
        <p className="rounded-2xl bg-white py-10 text-center text-[12px] text-muted">
          No withdrawal requests yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {withdrawals.map((item) => (
            <li key={item.id} className="rounded-2xl bg-white p-3">
              <div className="flex items-center justify-between">
                <p className="text-[15px] font-extrabold text-ink">
                  {formatUSDT(item.amount, 2)}
                </p>
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${badgeClass(item.status)}`}>
                  {item.status}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted">
                {item.method} • {item.account}
              </p>
              <p className="text-[10px] text-muted">{formatTimeAgo(item.createdAt)}</p>
            </li>
          ))}
        </ul>
      )}
    </LayoutShell>
  );
}
