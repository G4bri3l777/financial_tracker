"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useMembers } from "@/app/hooks/useMembers";
import { useBudget, useTemplateBudget } from "@/app/hooks/useBudget";
import { db } from "@/app/lib/firebase";

// ── Constants ────────────────────────────────────────────────
const DR: Record<string, { min: number; max: number; emoji: string }> = {
  Housing:     { min: 25, max: 35, emoji: "🏠" },
  Food:        { min: 10, max: 15, emoji: "🍽️" },
  Transport:   { min: 10, max: 15, emoji: "🚗" },
  Health:      { min: 5,  max: 10, emoji: "🏥" },
  Personal:    { min: 5,  max: 10, emoji: "👤" },
  Recreation:  { min: 5,  max: 10, emoji: "🎉" },
  Giving:      { min: 10, max: 15, emoji: "🎁" },
  Saving:      { min: 10, max: 15, emoji: "🐷" },
  Debt:        { min: 5,  max: 10, emoji: "💳" },
  Insurance:   { min: 5,  max: 10, emoji: "🛡️" },
};

const TOP_CATS = Object.keys(DR);

function fmt(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

function toYM(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m, 1);
  return toYM(d);
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return toYM(d);
}

// ── Page ─────────────────────────────────────────────────────
export default function BudgetPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId,   setHouseholdId]   = useState("");
  const [userRole,      setUserRole]      = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [loadingCtx,    setLoadingCtx]    = useState(true);
  const [saving,        setSaving]        = useState(false);
  const [toast,         setToast]         = useState("");

  const currentYM = toYM();
  const [budgetMonth, setBudgetMonth] = useState(currentYM);

  const isPast    = budgetMonth < currentYM;
  const isCurrent = budgetMonth === currentYM;
  const isFuture  = budgetMonth > currentYM;
  const canEdit   = !isPast;

  // Local editable state
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [comments,   setComments]   = useState<Record<string, string>>({});
  const [owners,     setOwners]     = useState<Record<string, string>>({});

  // New category/subcat inputs
  const [addingCatTo,  setAddingCatTo]  = useState<string | null>(null); // parent cat key or null for top
  const [newCatName,   setNewCatName]   = useState("");

  // Transactions (all)
  const [transactions, setTransactions] = useState<{
    date: string; month: string; type: string;
    category: string; subcat: string; amount: number; direction: string;
  }[]>([]);

  const members = useMembers(householdId || undefined);
  const { budget, loading: budgetLoading } = useBudget(
    householdId || undefined,
    budgetMonth,
  );
  const { budget: templateBudget } = useTemplateBudget(
    householdId || undefined,
    budgetMonth,
  );

  // Load context
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const data = snap.data() ?? {};
      const hid = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setUserRole(String(data.role ?? "member"));
      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

  // Load combined household income
  useEffect(() => {
    if (!householdId || members.length === 0) return;
    Promise.all(members.map(m => getDoc(doc(db, "users", m.uid)))).then(docs => {
      const total = docs.reduce((s, d) => s + Number(d.data()?.monthlyIncome ?? 0), 0);
      if (total > 0) setMonthlyIncome(total);
    });
  }, [householdId, members]);

  // Load transactions
  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, "households", householdId, "transactions"),
      orderBy("date", "desc"),
    );
    return onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => {
        const x = d.data();
        return {
          date:      String(x.date ?? ""),
          month:     String(x.month ?? x.date?.slice(0, 7) ?? ""),
          type:      String(x.type ?? ""),
          category:  String(x.category ?? ""),
          subcat:    String(x.subcat ?? ""),
          amount:    Math.abs(Number(x.amount ?? 0)),
          direction: String(x.direction ?? ""),
        };
      }));
    });
  }, [householdId]);

  // ── Historical averages at CATEGORY and SUBCATEGORY level ──
  const historicalAvg = useMemo(() => {
    // ── STEP 1: 3-month average (for meaningful historical values) ──
    const [by, bm] = budgetMonth.split("-").map(Number);
    const cutoffDate = new Date(by, bm - 4, 1);
    const cutoff = toYM(cutoffDate);

    const recentExpenses = transactions.filter(
      t => t.type === "expense" && t.month >= cutoff && t.month < budgetMonth
    );

    const months = new Set(recentExpenses.map(t => t.month));
    const numMonths = Math.max(1, months.size);

    const sums: Record<string, number> = {};
    recentExpenses.forEach(t => {
      if (!t.category) return;
      sums[t.category] = (sums[t.category] ?? 0) + t.amount;
      if (t.subcat) {
        const key = `${t.category}:${t.subcat}`;
        sums[key] = (sums[key] ?? 0) + t.amount;
      }
    });

    const avgs: Record<string, number> = {};
    Object.entries(sums).forEach(([k, v]) => {
      avgs[k] = v / numMonths;
    });

    // ── STEP 2: Collect ALL known subcategory keys from ALL transactions ──
    // Any subcat ever used gets included in the structure with $0 avg
    // if it has no spending in the 3-month window.
    // This ensures budget rows exist for every subcat in Firestore,
    // not just recent ones.
    transactions.forEach(t => {
      if (!t.category || !t.subcat) return;
      const key = `${t.category}:${t.subcat}`;
      if (avgs[key] === undefined) {
        avgs[key] = 0; // Known subcat, just no recent spending
      }
      // Also ensure the parent category key exists
      if (avgs[t.category] === undefined) {
        avgs[t.category] = 0;
      }
    });

    return avgs;
  }, [transactions, budgetMonth]);

  // ── Actual spending for the selected month ─────────────────
  const actualSpending = useMemo(() => {
    const monthTxns = transactions.filter(
      t => t.type === "expense" && t.month === budgetMonth
    );
    const actual: Record<string, number> = {};
    monthTxns.forEach(t => {
      if (!t.category) return;
      actual[t.category] = (actual[t.category] ?? 0) + t.amount;
      if (t.subcat) {
        const key = `${t.category}:${t.subcat}`;
        actual[key] = (actual[key] ?? 0) + t.amount;
      }
    });
    return actual;
  }, [transactions, budgetMonth]);

  // Actual income received in the budget month
  const actualIncome = useMemo(() => {
    return transactions
      .filter(t =>
        (t.type === "income" || t.type === "refund") &&
        t.month === budgetMonth
      )
      .reduce((s, t) => s + t.amount, 0);
  }, [transactions, budgetMonth]);

  // ── DR guidelines ──────────────────────────────────────────
  const drGuidelines = useMemo(() => {
    const g: Record<string, number> = {};
    Object.entries(DR).forEach(([cat, { max }]) => {
      if (max > 0 && monthlyIncome > 0)
        g[cat] = Math.round((monthlyIncome * max) / 100);
    });
    return g;
  }, [monthlyIncome]);

  // ── Build tree from flat categories (preserves key order for stable subcategory ordering) ───
  const categoryTree = useMemo(() => {
    const tree: Record<string, { budget: number | null; subcats: Record<string, number> }> = {};

    TOP_CATS.forEach(cat => {
      if (!tree[cat]) tree[cat] = { budget: null, subcats: {} };
    });

    Object.entries(categories).forEach(([key, val]) => {
      if (key.includes(":")) {
        const [parent, sub] = key.split(":");
        if (!tree[parent]) tree[parent] = { budget: null, subcats: {} };
        tree[parent].subcats[sub] = val;
      } else {
        if (!tree[key]) tree[key] = { budget: null, subcats: {} };
        tree[key].budget = val;
      }
    });

    return tree;
  }, [categories]);

  // ── Initialize from budget or historical ──────────────────
  useEffect(() => {
    if (budgetLoading) return;
    if (budget) {
      setCategories(prev => {
        const fromServer = budget.categories ?? {};
        let result: Record<string, number>;
        if (Object.keys(prev).length === 0) {
          result = Object.fromEntries(
            Object.entries(fromServer).sort((a, b) => a[0].localeCompare(b[0]))
          );
        } else {
          const merged: Record<string, number> = {};
          for (const k of Object.keys(prev)) {
            merged[k] = fromServer[k] ?? prev[k];
          }
          for (const k of Object.keys(fromServer)) {
            if (merged[k] === undefined) merged[k] = fromServer[k];
          }
          result = merged;
        }
        // Merge in any new subcats from actual spending that aren't
        // in the saved budget yet (appeared after budget was created)
        Object.keys(actualSpending).forEach(key => {
          if (result[key] === undefined) {
            result[key] = 0;
            if (key.includes(":")) {
              const [parent] = key.split(":");
              if (result[parent] === undefined) result[parent] = 0;
            }
          }
        });
        return result;
      });
      setComments(budget.comments ?? {});
      setOwners(budget.owners ?? {});
    } else {
      // No budget for this month yet — build from template structure + historical values
      const init: Record<string, number> = {};

      const templateKeys = templateBudget
        ? Object.keys(templateBudget.categories ?? {})
        : [];
      const histKeys = Object.keys(historicalAvg);

      const allKeys = new Set([
        ...TOP_CATS,
        ...templateKeys.filter(k => !k.includes(":")),
        ...histKeys.filter(k => !k.includes(":")),
      ]);

      const subcatMap: Record<string, Set<string>> = {};
      [
        ...templateKeys.filter(k => k.includes(":")),
        ...histKeys.filter(k => k.includes(":")),
      ].forEach(k => {
        const [parent, sub] = k.split(":");
        if (!subcatMap[parent]) subcatMap[parent] = new Set();
        subcatMap[parent].add(sub);
      });
      // Include all parents that have subcats (ensures manually created subcategories are imported)
      Object.keys(subcatMap).forEach(p => allKeys.add(p));

      // Also include subcategories that appear in THIS month's
      // actual transactions (new subcats used for the first time)
      Object.keys(actualSpending).forEach(key => {
        if (key.includes(":")) {
          const [parent, sub] = key.split(":");
          allKeys.add(parent);
          if (!subcatMap[parent]) subcatMap[parent] = new Set();
          subcatMap[parent].add(sub);
        } else {
          allKeys.add(key);
        }
      });

      allKeys.forEach(cat => {
        const subcats = subcatMap[cat];
        if (subcats && subcats.size > 0) {
          init[cat] = 0;
          Array.from(subcats).sort().forEach(sub => {
            const key  = `${cat}:${sub}`;
            const hist = historicalAvg[key] ?? 0;
            init[key]  = Math.ceil(hist / 25) * 25;
          });
        } else {
          const hist = historicalAvg[cat] ?? 0;
          const dr   = drGuidelines[cat] ?? 0;
          const base = hist > 0 ? hist : dr;
          init[cat]  = base > 0 ? Math.ceil(base / 25) * 25 : 0;
        }
      });

      setCategories(init);
      setComments({});
      setOwners(templateBudget?.owners ?? {});
    }
  }, [budget, budgetLoading, historicalAvg, drGuidelines, templateBudget, actualSpending]);

  // ── Totals ────────────────────────────────────────────────
  const totalBudgeted = useMemo(() => {
    let total = 0;
    Object.entries(categoryTree).forEach(([cat, node]) => {
      const subcatKeys = Object.keys(node.subcats);
      if (subcatKeys.length > 0) {
        total += subcatKeys.reduce((s, sub) => s + (node.subcats[sub] || 0), 0);
      } else {
        total += node.budget || 0;
      }
    });
    return total;
  }, [categoryTree]);

  const surplus   = monthlyIncome - totalBudgeted;
  const allocPct  = monthlyIncome > 0
    ? Math.min(100, Math.round((totalBudgeted / monthlyIncome) * 100))
    : 0;

  const isPending           = budget?.status === "pending_approval";
  const isApproved          = budget?.status === "approved";
  const hasApproved         = budget?.approvedBy?.includes(user?.uid ?? "") ?? false;
  const pastWithoutApproved = isPast && !isApproved;

  // ── Auto-save ─────────────────────────────────────────────
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const scheduleSave = useCallback((
    cats: Record<string, number>,
    comms: Record<string, string>,
    own: Record<string, string> = owners,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (!householdId || !user) return;
      const payload = {
        version:       budget?.version ?? 1,
        month:         budgetMonth,
        income:        monthlyIncome,
        categories:    cats,
        historicalAvg,
        drGuidelines,
        comments:      comms,
        owners:        own,
        status:        "draft" as const,
        proposedBy:    budget?.proposedBy ?? user.uid,
        proposedAt:    budget?.proposedAt ?? null,
        approvedBy:    budget?.approvedBy ?? [],
        approvedAt:    budget?.approvedAt ?? null,
        updatedAt:     serverTimestamp(),
      };
      try {
        if (budget) {
          await updateDoc(
            doc(db, "households", householdId, "budgets", budget.id),
            payload,
          );
        } else {
          await addDoc(
            collection(db, "households", householdId, "budgets"),
            { ...payload, createdAt: serverTimestamp() },
          );
        }
      } catch (e) { console.error("Budget save error:", e); }
    }, 800);
  }, [budget, householdId, user, budgetMonth, monthlyIncome, historicalAvg, drGuidelines, owners]);

  function updateCategoryValue(key: string, val: number) {
    const next = { ...categories, [key]: val };
    setCategories(next);
    scheduleSave(next, comments);
  }

  function updateComment(key: string, val: string) {
    const next = { ...comments, [key]: val };
    setComments(next);
    scheduleSave(categories, next);
  }

  function updateOwner(key: string, val: string) {
    const next = { ...owners, [key]: val };
    setOwners(next);
    scheduleSave(categories, comments, next);
  }

  function addSubcategory(parentCat: string, subName: string) {
    if (!subName.trim()) return;
    const key = `${parentCat}:${subName.trim()}`;
    const hist = historicalAvg[key] ?? 0;
    const init = Math.ceil(hist / 25) * 25 || 0;
    const next = { ...categories, [parentCat]: 0, [key]: init };
    setCategories(next);
    scheduleSave(next, comments);
    setAddingCatTo(null);
    setNewCatName("");
  }

  function addTopCategory(name: string) {
    if (!name.trim() || categories[name.trim()] !== undefined) return;
    const next = { ...categories, [name.trim()]: 0 };
    setCategories(next);
    scheduleSave(next, comments);
    setAddingCatTo(null);
    setNewCatName("");
  }

  function removeKey(key: string) {
    const next = { ...categories };
    Object.keys(next).forEach(k => {
      if (k === key || k.startsWith(`${key}:`)) delete next[k];
    });
    setCategories(next);
    scheduleSave(next, comments);
  }

  async function proposeBudget() {
    if (!householdId || !user || !budget) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "households", householdId, "budgets", budget.id),
        {
          status:     "pending_approval",
          proposedBy: user.uid,
          proposedAt: serverTimestamp(),
          approvedBy: [user.uid],
          updatedAt:  serverTimestamp(),
        },
      );
      showToast("Budget proposed! Waiting for partner's approval.");
    } finally { setSaving(false); }
  }

  async function approveBudget() {
    if (!householdId || !user || !budget) return;
    setSaving(true);
    try {
      const newApproved = [...(budget.approvedBy ?? []), user.uid];
      const allDone = newApproved.length >= members.length;
      await updateDoc(
        doc(db, "households", householdId, "budgets", budget.id),
        {
          approvedBy: newApproved,
          status:     allDone ? "approved" : "pending_approval",
          approvedAt: allDone ? serverTimestamp() : null,
          updatedAt:  serverTimestamp(),
        },
      );
      showToast(allDone ? "Budget approved by everyone! 🎉" : "Approval recorded.");
    } finally { setSaving(false); }
  }

  async function requestChanges() {
    if (!householdId || !user || !budget) return;
    setSaving(true);
    try {
      await updateDoc(
        doc(db, "households", householdId, "budgets", budget.id),
        { status: "draft", approvedBy: [], updatedAt: serverTimestamp() },
      );
      showToast("Changes requested — returned to draft.");
    } finally { setSaving(false); }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  if (authLoading || loadingCtx || budgetLoading) return (
    <div className="flex flex-1 items-center justify-center bg-[#F4F6FA]">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  const histTotal = Object.entries(historicalAvg)
    .filter(([k]) => !k.includes(":"))
    .reduce((s, [, v]) => s + v, 0);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-green-200 bg-white px-5 py-2.5 text-sm font-semibold text-green-700 shadow-lg">
          {toast}
        </div>
      )}

      {/* ── HEADER ──────────────────────────────────────── */}
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs text-[#9AA5B4]">
              <Link href="/dashboard" className="hover:text-[#1B2A4A]">Dashboard</Link>
              <span>/</span>
              <span className="font-semibold text-[#1B2A4A]">Budget</span>
            </div>

            {/* Month navigator */}
            <div className="mt-1.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setBudgetMonth(prevMonth(budgetMonth))}
                className="rounded-lg border border-[#E4E8F0] px-2 py-1 text-xs text-[#9AA5B4] hover:text-[#1B2A4A]"
              >
                ←
              </button>
              <h1 className="text-xl font-bold text-[#1B2A4A]">
                {monthLabel(budgetMonth)}
              </h1>
              <button
                type="button"
                onClick={() => setBudgetMonth(nextMonth(budgetMonth))}
                className="rounded-lg border border-[#E4E8F0] px-2 py-1 text-xs text-[#9AA5B4] hover:text-[#1B2A4A]"
              >
                →
              </button>

              {/* Mode badge */}
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                isPast    ? "bg-[#F4F6FA] text-[#9AA5B4]"
                : isCurrent ? "bg-blue-100 text-blue-700"
                :             "bg-[#FFF8E8] text-[#C9A84C]"
              }`}>
                {isPast ? "Past · read only"
                : isCurrent ? "This month · live"
                : "Planning mode"}
              </span>

              {/* Budget status */}
              {budget && (
                <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                  isApproved ? "bg-green-100 text-green-700"
                  : isPending  ? "bg-amber-100 text-amber-700"
                  :              "bg-[#F4F6FA] text-[#9AA5B4]"
                }`}>
                  {budget.status.replace("_", " ")}
                </span>
              )}
            </div>

            <p className="mt-0.5 text-[11px] text-[#9AA5B4]">
              {isPast
                ? "Comparing budget to what you actually spent"
                : isCurrent
                  ? "Live tracking · auto-saves as draft"
                  : `Pre-filled from ${monthLabel(prevMonth(budgetMonth))} spending · auto-saves`}
            </p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {canEdit && !isPending && !isApproved && (
              <button
                type="button"
                disabled={saving || surplus < 0}
                onClick={() => void proposeBudget()}
                className="rounded-xl bg-[#C9A84C] px-5 py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-40"
                title={surplus < 0 ? "Fix deficit first" : ""}
              >
                {saving ? "Saving..." : "Propose →"}
              </button>
            )}
            {isPending && !hasApproved && (
              <>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void approveBudget()}
                  className="rounded-xl bg-green-600 px-5 py-2.5 text-sm font-bold text-white"
                >
                  ✓ Approve
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void requestChanges()}
                  className="rounded-xl border border-[#E4E8F0] bg-white px-4 py-2.5 text-sm font-semibold text-[#9AA5B4]"
                >
                  Request Changes
                </button>
              </>
            )}
            {canEdit && (
              <button
                type="button"
                onClick={() => {
                  const init: Record<string, number> = {};
                  TOP_CATS.forEach(cat => {
                    const subcatKeys = Object.keys(historicalAvg).filter(k => k.startsWith(`${cat}:`));
                    if (subcatKeys.length > 0) {
                      init[cat] = 0;
                      subcatKeys.forEach(k => {
                        init[k] = Math.ceil((historicalAvg[k] ?? 0) / 25) * 25;
                      });
                    } else {
                      const hist = historicalAvg[cat] ?? 0;
                      const dr   = drGuidelines[cat] ?? 0;
                      const base = hist > 0 ? hist : dr;
                      if (base > 0) init[cat] = Math.ceil(base / 25) * 25;
                    }
                  });
                  setCategories(init);
                  scheduleSave(init, comments);
                }}
                className="rounded-xl border border-[#E4E8F0] bg-white px-3 py-2.5 text-xs font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
              >
                ↺ Reset
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-4xl flex-1 space-y-4 px-6 py-5">

        {/* ── STATS CARD ──────────────────────────────────── */}
        {(() => {
          const totalActualExpenses = Object.entries(actualSpending)
            .filter(([k]) => !k.includes(":"))
            .reduce((s, [, v]) => s + v, 0);

          const surplusVsBudget = monthlyIncome - totalBudgeted;

          // Real balance = actually received income − actual expenses
          const realBalance = actualIncome - totalActualExpenses;

          const spentPct = monthlyIncome > 0
            ? Math.min(100, Math.round((totalActualExpenses / monthlyIncome) * 100))
            : 0;
          const budgetPct = monthlyIncome > 0
            ? Math.min(100, Math.round((totalBudgeted / monthlyIncome) * 100))
            : 0;

          const realBalanceColor =
            realBalance >= 0                 ? "#16A34A"
            : realBalance >= -(monthlyIncome || 1) * 0.1 ? "#D97706"
            : "#DC2626";

          const expectedBalanceColor =
            surplusVsBudget >= 0             ? "#16A34A"
            : surplusVsBudget >= -monthlyIncome * 0.1 ? "#D97706"
            : "#DC2626";

          const receivedPct = monthlyIncome > 0
            ? Math.min(100, Math.round((actualIncome / monthlyIncome) * 100))
            : 0;

          return (
            <div className="rounded-2xl border border-[#E4E8F0] bg-white p-5">
              {isCurrent && (
                <p className="mb-3 text-xs font-semibold text-amber-600">
                  📅 Month in progress — figures will update as income and expenses are recorded
                </p>
              )}
              {pastWithoutApproved && (
                <p className="mb-3 text-xs text-[#9AA5B4]">
                  No approved budget for this month — showing actuals only
                </p>
              )}
              <div className="mb-4 grid grid-cols-3 gap-4">

                {pastWithoutApproved ? (
                  /* Simplified: Actual Received | Actual Expenses | Real Balance */
                  <>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Actually Received
                      </p>
                      <p className={`text-2xl font-bold ${
                        actualIncome > 0 ? "text-[#1B2A4A]" : "text-[#9AA5B4]"
                      }`}>
                        {actualIncome > 0 ? fmt(actualIncome) : "—"}
                      </p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {actualIncome > 0 ? "income received" : "no income recorded"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Actual Expenses
                      </p>
                      <p
                        className="text-2xl font-bold"
                        style={{
                          color: totalActualExpenses > 0 ? realBalanceColor : "#9AA5B4",
                        }}
                      >
                        {totalActualExpenses > 0 ? fmt(totalActualExpenses) : "—"}
                      </p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {totalActualExpenses > 0 ? "spent" : "no spending"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Real Balance
                      </p>
                      <p className="text-2xl font-bold" style={{ color: realBalanceColor }}>
                        {(realBalance >= 0 ? "+" : "−") + fmt(Math.abs(realBalance))}
                      </p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {realBalance >= 0 ? "Surplus" : "Deficit"} · received − spent
                      </p>
                    </div>
                  </>
                ) : (
                  /* Full view: Planned/Income | Budgeted/Actual Expenses | Expected/Real Balance */
                  <>
                    {/* Col 1: Income */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        {isPast ? "Planned Income" : "Monthly Income"}
                      </p>
                      <p className="text-2xl font-bold text-[#1B2A4A]">{fmt(monthlyIncome)}</p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {members.map(m => m.firstName || m.displayName).join(" + ")}
                      </p>
                      {(isPast || isCurrent) && actualIncome > 0 && (
                        <>
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                            {isPast ? "Actually Received" : "Received So Far"}
                          </p>
                          <p className={`text-2xl font-bold ${
                            actualIncome >= monthlyIncome ? "text-green-600" : "text-amber-600"
                          }`}>
                            {fmt(actualIncome)}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            {actualIncome >= monthlyIncome
                              ? "Full amount received"
                              : `${fmt(monthlyIncome - actualIncome)} pending`}
                          </p>
                        </>
                      )}
                    </div>

                    {/* Col 2: Budgeted + Actual Expenses */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Budgeted Expenses
                      </p>
                      <p
                        className="text-2xl font-bold"
                        style={{
                          color: totalBudgeted > 0 ? expectedBalanceColor : "#9AA5B4",
                        }}
                      >
                        {totalBudgeted > 0 ? fmt(totalBudgeted) : "—"}
                      </p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {isFuture ? "from your budget plan" : "from your plan"}
                      </p>
                      {(isPast || isCurrent) && (
                        <>
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                            Actual Expenses
                          </p>
                          <p
                            className="text-2xl font-bold"
                            style={{
                              color: totalActualExpenses > 0 ? realBalanceColor : "#9AA5B4",
                            }}
                          >
                            {totalActualExpenses > 0 ? fmt(totalActualExpenses) : "—"}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            {totalActualExpenses > 0 && totalBudgeted > 0
                              ? totalActualExpenses > totalBudgeted
                                ? `${fmt(totalActualExpenses - totalBudgeted)} over budget`
                                : `${fmt(totalBudgeted - totalActualExpenses)} under budget`
                              : totalActualExpenses > 0 ? "spent so far" : "no spending yet"}
                          </p>
                        </>
                      )}
                    </div>

                    {/* Col 3: Expected + Real Balance */}
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Expected Balance
                      </p>
                      <p className="text-2xl font-bold" style={{ color: expectedBalanceColor }}>
                        {(surplusVsBudget >= 0 ? "+" : "−") + fmt(Math.abs(surplusVsBudget))}
                      </p>
                      <p className="text-[10px] text-[#9AA5B4]">
                        {surplusVsBudget >= 0 ? "Surplus" : "Deficit"} · {budgetPct}% budgeted
                      </p>
                      {(isPast || isCurrent) && (
                        <>
                          <p className="mt-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                            Real Balance
                          </p>
                          <p className="text-2xl font-bold" style={{ color: realBalanceColor }}>
                            {(realBalance >= 0 ? "+" : "−") + fmt(Math.abs(realBalance))}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            {realBalance >= 0 ? "Surplus" : "Deficit"} · received − spent
                          </p>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* Budget allocation bar (all modes) - hide when past without approved */}
              {!pastWithoutApproved && surplusVsBudget < 0 && !isPast && (
                <p className="mt-2 text-xs font-semibold text-red-600">
                  ⚠️ Over budget by {fmt(Math.abs(surplusVsBudget))} — reduce some categories before proposing
                </p>
              )}
            </div>
          );
        })()}

        {/* ── APPROVAL STATUS ─────────────────────────── */}
        {!isPast && budget && (
          <div className="rounded-2xl border border-[#E4E8F0] bg-white px-5 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                {(["draft","pending_approval","approved"] as const).map((s, i) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
                      budget.status === s ? "bg-[#C9A84C] text-[#1B2A4A]"
                      : (["draft","pending_approval","approved"].indexOf(budget.status) > i)
                        ? "bg-[#1B2A4A] text-white"
                        : "bg-[#F4F6FA] text-[#9AA5B4]"
                    }`}>
                      {(["draft","pending_approval","approved"].indexOf(budget.status) > i) ? "✓" : i + 1}
                    </div>
                    <span className="text-xs text-[#9AA5B4]">
                      {s === "draft" ? "Draft"
                      : s === "pending_approval" ? "Pending"
                      : "Approved"}
                    </span>
                    {i < 2 && <span className="text-xs text-[#E4E8F0]">→</span>}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3">
                {members.map(m => (
                  <div key={m.uid} className="flex items-center gap-1.5">
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold ${
                      budget.approvedBy?.includes(m.uid) ? "bg-green-100 text-green-700" : "bg-[#F4F6FA] text-[#9AA5B4]"
                    }`}>
                      {(m.firstName || m.displayName || "?").charAt(0)}
                    </div>
                    <span className="text-[11px]">
                      {budget.approvedBy?.includes(m.uid) ? "✓" : "⏳"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── CATEGORY TABLE ───────────────────────────── */}
        <div className="overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white">

          {/* Column headers */}
          <div className={`grid gap-0 border-b border-[#F4F6FA] px-5 py-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4] ${
            pastWithoutApproved
              ? "grid-cols-[1fr_80px_80px_80px_110px_minmax(130px,1fr)]"
              : "grid-cols-[1fr_80px_80px_130px_80px_110px_minmax(130px,1fr)]"
          }`}>
            <span>Category</span>
            <span className="text-right">Historical</span>
            <span className="text-right">DR Target</span>
            {!pastWithoutApproved && (
              <span className="text-center">
                {isPast ? "Budgeted" : isCurrent ? "Budget" : "Your Budget"}
              </span>
            )}
            <span className="text-right">
              {isPast ? "Actual" : isCurrent ? "Spent" : "Status"}
            </span>
            <span className="text-center">Owner</span>
            <span className="pl-2">Comment</span>
          </div>

          {/* Rows */}
          {Object.entries(categoryTree).map(([cat, node], catIdx) => {
            const subcatNames = Object.keys(node.subcats);
            const hasSubcats  = subcatNames.length > 0;
            const drInfo      = DR[cat];

            const catBudget = hasSubcats
              ? subcatNames.reduce((s, sub) => s + (node.subcats[sub] || 0), 0)
              : (node.budget || 0);
            const catActual  = actualSpending[cat]      ?? 0;
            const catHist    = historicalAvg[cat]       ?? 0;
            const catDR      = drGuidelines[cat]        ?? 0;
            const catOverBudget = isCurrent && catActual > catBudget && catBudget > 0;

            return (
              <div
                key={cat}
                className={`border-b border-[#F9FAFC] ${catIdx % 2 === 0 ? "bg-white" : "bg-[#FAFAFA]"}`}
              >
                {/* CATEGORY ROW */}
                <div className={`grid items-center gap-0 px-5 py-3 ${
                  pastWithoutApproved
                    ? "grid-cols-[1fr_80px_80px_80px_110px_minmax(130px,1fr)]"
                    : "grid-cols-[1fr_80px_80px_130px_80px_110px_minmax(130px,1fr)]"
                }`}>
                  <div className="flex items-center gap-2">
                    <span className="text-base">{drInfo?.emoji ?? "📌"}</span>
                    <div>
                      <p className="text-sm font-bold text-[#1B2A4A]">{cat}</p>
                      {drInfo && (
                        <p className="text-[9px] text-[#9AA5B4]">
                          DR {drInfo.min}–{drInfo.max}% of income
                        </p>
                      )}
                    </div>
                    {canEdit && (
                      <button
                        type="button"
                        onClick={() => removeKey(cat)}
                        className="ml-1 text-[10px] text-[#C4C9D4] hover:text-red-400"
                        title="Remove category"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <p className={`text-right text-sm ${catHist > 0 ? "font-semibold text-[#1B2A4A]" : "text-[#C4C9D4]"}`}>
                    {catHist > 0 ? fmt(catHist) : "—"}
                  </p>

                  <p className={`text-right text-sm ${catDR > 0 ? "font-semibold text-[#1B2A4A]" : "text-[#C4C9D4]"}`}>
                    {catDR > 0 ? fmt(catDR) : "—"}
                  </p>

                  {/* Budget cell — hidden when past month has no approved budget */}
                  {!pastWithoutApproved && (
                    <>
                      {isPast ? (
                        <p className="text-right text-sm font-semibold text-[#9AA5B4]">
                          {catBudget > 0 ? fmt(catBudget) : "—"}
                        </p>
                      ) : hasSubcats ? (
                        <p className="text-center text-sm font-bold text-[#1B2A4A]">
                          {fmt(catBudget)}
                        </p>
                      ) : (
                        <div className="flex justify-center">
                          <div className="relative w-28">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">$</span>
                            <input
                              type="number"
                              min={0}
                              step={25}
                              value={catBudget || ""}
                              onChange={e => updateCategoryValue(cat, Number(e.target.value))}
                              placeholder="0"
                              className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white pl-6 pr-2 text-right text-sm font-bold focus:border-[#C9A84C] focus:outline-none"
                            />
                          </div>
                        </div>
                      )}
                    </>
                  )}

                  {isPast ? (
                    <p className={`text-right text-sm font-bold ${
                      pastWithoutApproved
                        ? "text-[#1B2A4A]"
                        : catBudget > 0
                          ? catActual > catBudget ? "text-red-600" : "text-green-600"
                          : "text-[#9AA5B4]"
                    }`}>
                      {catActual > 0 ? fmt(catActual) : "—"}
                    </p>
                  ) : isCurrent ? (
                    <div className="text-right">
                      <p className={`text-sm font-bold ${catOverBudget ? "text-red-600" : "text-[#1B2A4A]"}`}>
                        {catActual > 0 ? fmt(catActual) : "—"}
                      </p>
                      {catBudget > 0 && catActual > 0 && (
                        <p className={`text-[9px] ${catOverBudget ? "text-red-500" : "text-green-600"}`}>
                          {catOverBudget ? `${fmt(catActual - catBudget)} over` : `${fmt(catBudget - catActual)} left`}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="text-center text-base">
                      {catBudget > catDR && catDR > 0 ? "⚠️"
                      : catBudget > 0 ? "✅"
                      : "—"}
                    </div>
                  )}
                  <div className="flex justify-center">
                    <select
                      value={owners[cat] ?? ""}
                      onChange={e => updateOwner(cat, e.target.value)}
                      disabled={!canEdit}
                      className="h-8 w-[105px] rounded-lg border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-[11px] text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none disabled:opacity-60"
                    >
                      <option value="">— Owner</option>
                      {members.map(m => (
                        <option key={m.uid} value={m.uid}>
                          {m.firstName || m.displayName}
                        </option>
                      ))}
                      <option value="joint">Joint</option>
                    </select>
                  </div>
                  <div className="pl-2">
                    <input
                      type="text"
                      value={comments[cat] ?? ""}
                      onChange={e => updateComment(cat, e.target.value)}
                      placeholder="Add comment..."
                      disabled={!canEdit}
                      className="h-7 w-full rounded-lg border border-[#F4F6FA] bg-[#F9FAFC] px-2 text-[11px] text-[#9AA5B4] focus:border-[#C9A84C] focus:outline-none disabled:opacity-60"
                    />
                  </div>
                </div>

                {isCurrent && catBudget > 0 && catActual > 0 && (
                  <div className="px-5 pb-1.5">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
                      <div
                        className="h-1.5 rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(100, (catActual / catBudget) * 100)}%`,
                          backgroundColor: catOverBudget ? "#DC2626" : "#16A34A",
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* SUBCATEGORY ROWS */}
                {subcatNames.map(sub => {
                  const subKey    = `${cat}:${sub}`;
                  const subBudget = node.subcats[sub] ?? 0;
                  const subActual = actualSpending[subKey] ?? 0;
                  const subHist   = historicalAvg[subKey]  ?? 0;
                  const subOver   = isCurrent && subActual > subBudget && subBudget > 0;

                  return (
                    <div
                      key={subKey}
                      className={`grid min-h-[2.25rem] items-center gap-0 border-t border-[#F4F6FA] px-5 py-2 ${
                        pastWithoutApproved
                          ? "grid-cols-[1fr_80px_80px_80px_110px_minmax(130px,1fr)]"
                          : "grid-cols-[1fr_80px_80px_130px_80px_110px_minmax(130px,1fr)]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 pl-6">
                        <span className="shrink-0 text-[10px] text-[#C4C9D4]">└</span>
                        <p className="text-xs font-semibold text-[#1B2A4A]">{sub}</p>
                        {canEdit && (
                          <button
                            type="button"
                            onClick={() => removeKey(subKey)}
                            className="text-[10px] text-[#C4C9D4] hover:text-red-400"
                          >×</button>
                        )}
                      </div>

                      <p className={`text-right text-xs ${subHist > 0 ? "text-[#9AA5B4]" : "text-[#C4C9D4]"}`}>
                        {subHist > 0 ? fmt(subHist) : "—"}
                      </p>

                      <p className="text-right text-xs text-[#C4C9D4]">—</p>

                      {/* Subcat budget cell — hidden when no approved budget */}
                      {!pastWithoutApproved && (
                        <>
                          {isPast ? (
                            <p className="text-right text-xs font-semibold text-[#9AA5B4]">
                              {subBudget > 0 ? fmt(subBudget) : "—"}
                            </p>
                          ) : (
                            <div className="flex justify-center">
                              <div className="relative w-24 min-w-24">
                                <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[10px] text-[#9AA5B4]">$</span>
                                <input
                                  type="number"
                                  min={0}
                                  step={25}
                                  value={subBudget || ""}
                                  onChange={e => updateCategoryValue(subKey, Number(e.target.value))}
                                  placeholder="0"
                                  className="h-7 w-full min-w-0 rounded-lg border border-[#E4E8F0] bg-white pl-5 pr-1 text-right text-xs font-bold focus:border-[#C9A84C] focus:outline-none"
                                />
                              </div>
                            </div>
                          )}
                        </>
                      )}

                      {isPast ? (
                        <p className={`text-right text-xs font-semibold ${
                          !pastWithoutApproved && subBudget > 0 && subActual > subBudget
                            ? "text-red-500"
                            : "text-[#9AA5B4]"
                        }`}>
                          {subActual > 0 ? fmt(subActual) : "—"}
                        </p>
                      ) : isCurrent ? (
                        <div className="text-right">
                          <p className={`text-xs font-semibold ${subOver ? "text-red-500" : "text-[#9AA5B4]"}`}>
                            {subActual > 0 ? fmt(subActual) : "—"}
                          </p>
                        </div>
                      ) : (
                        <div />
                      )}
                      <div className="flex justify-center">
                        <select
                          value={owners[subKey] ?? ""}
                          onChange={e => updateOwner(subKey, e.target.value)}
                          disabled={!canEdit}
                          className="h-7 w-[105px] rounded-lg border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-[10px] text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none disabled:opacity-60"
                        >
                          <option value="">— Owner</option>
                          {members.map(m => (
                            <option key={m.uid} value={m.uid}>
                              {m.firstName || m.displayName}
                            </option>
                          ))}
                          <option value="joint">Joint</option>
                        </select>
                      </div>
                      <div className="min-w-0 pl-2">
                        <input
                          type="text"
                          value={comments[subKey] ?? ""}
                          onChange={e => updateComment(subKey, e.target.value)}
                          placeholder="Comment..."
                          disabled={!canEdit}
                          className="h-6 min-w-0 resize-none rounded-lg border border-[#F4F6FA] bg-[#F9FAFC] px-2 text-[10px] text-[#9AA5B4] focus:border-[#C9A84C] focus:outline-none disabled:opacity-60"
                        />
                      </div>
                    </div>
                  );
                })}

                {canEdit && (
                  <div className="border-t border-[#F9FAFC] px-5 py-1">
                    {addingCatTo === cat ? (
                      <div className="flex items-center gap-2 pl-6">
                        <span className="text-[10px] text-[#C4C9D4]">└</span>
                        <input
                          autoFocus
                          type="text"
                          value={newCatName}
                          onChange={e => setNewCatName(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Enter") addSubcategory(cat, newCatName);
                            if (e.key === "Escape") { setAddingCatTo(null); setNewCatName(""); }
                          }}
                          placeholder="Subcategory name..."
                          className="h-7 flex-1 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => addSubcategory(cat, newCatName)}
                          className="rounded-lg bg-[#C9A84C] px-2 py-1 text-[10px] font-bold text-[#1B2A4A]"
                        >
                          Add
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAddingCatTo(null); setNewCatName(""); }}
                          className="text-[10px] text-[#9AA5B4]"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingCatTo(cat)}
                        className="pl-6 text-[10px] font-semibold text-[#C9A84C] hover:text-[#b8943a]"
                      >
                        + Add subcategory
                      </button>
                    )}
                  </div>
                )}

                {(isPending || isApproved) && (
                  <div className="px-5 pb-2">
                    <input
                      type="text"
                      value={comments[cat] ?? ""}
                      onChange={e => updateComment(cat, e.target.value)}
                      placeholder={`Comment on ${cat}...`}
                      disabled={isApproved}
                      className="h-7 w-full rounded-lg border border-[#F4F6FA] bg-[#F9FAFC] px-2 text-[11px] text-[#9AA5B4] focus:border-[#C9A84C] focus:outline-none disabled:opacity-50"
                    />
                  </div>
                )}
              </div>
            );
          })}

          {canEdit && (
            <div className="border-t border-[#E4E8F0] px-5 py-3">
              {addingCatTo === "__top__" ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    type="text"
                    value={newCatName}
                    onChange={e => setNewCatName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") addTopCategory(newCatName);
                      if (e.key === "Escape") { setAddingCatTo(null); setNewCatName(""); }
                    }}
                    placeholder="New category name..."
                    className="h-8 max-w-xs flex-1 rounded-xl border border-[#C9A84C] bg-white px-3 text-xs focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => addTopCategory(newCatName)}
                    className="rounded-xl bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#1B2A4A]"
                  >
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => { setAddingCatTo(null); setNewCatName(""); }}
                    className="text-xs text-[#9AA5B4]"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAddingCatTo("__top__")}
                  className="text-sm font-semibold text-[#C9A84C] hover:text-[#b8943a]"
                >
                  + Add category
                </button>
              )}
            </div>
          )}

          {/* Totals row */}
          <div className={`grid items-center gap-0 border-t border-[#E4E8F0] bg-[#F9FAFC] px-5 py-3 ${
            pastWithoutApproved
              ? "grid-cols-[1fr_80px_80px_80px_110px_minmax(130px,1fr)]"
              : "grid-cols-[1fr_80px_80px_130px_80px_110px_minmax(130px,1fr)]"
          }`}>
            {/* 1: Label */}
            <p className="text-sm font-bold text-[#1B2A4A]">Total</p>

            {/* 2: Historical total */}
            <p className="text-right text-sm font-bold text-[#9AA5B4]">
              {fmt(histTotal)}
            </p>

            {/* 3: DR total */}
            <p className="text-right text-sm font-bold text-[#9AA5B4]">
              {fmt(Object.values(drGuidelines).reduce((s, v) => s + v, 0))}
            </p>

            {/* 4: Budgeted total — hidden when pastWithoutApproved */}
            {!pastWithoutApproved && (
              <p className={`text-center text-sm font-bold ${
                surplus < 0 ? "text-red-600" : "text-[#1B2A4A]"
              }`}>
                {fmt(totalBudgeted)}
              </p>
            )}

            {/* 5: Actual total */}
            <p className={`text-right text-sm font-bold ${
              pastWithoutApproved ? "text-[#1B2A4A]"
              : surplus >= 0 ? "text-green-600" : "text-red-600"
            }`}>
              {(() => {
                const actualTotal = Object.entries(actualSpending)
                  .filter(([k]) => !k.includes(":"))
                  .reduce((s, [, v]) => s + v, 0);
                if (pastWithoutApproved) return actualTotal > 0 ? fmt(actualTotal) : "—";
                return surplus >= 0 ? `+${fmt(surplus)}` : `−${fmt(Math.abs(surplus))}`;
              })()}
            </p>

            {/* 6: Owner — empty */}
            <div />

            {/* 7: Comment — empty */}
            <div />
          </div>
        </div>

        {!isPast && (
          <div className="flex flex-wrap gap-4 rounded-xl border border-[#E4E8F0] bg-white px-4 py-3 text-[11px] text-[#9AA5B4]">
            <span>✅ Within DR guideline</span>
            <span>⚠️ Over DR guideline</span>
            {isCurrent && (
              <>
                <span className="text-green-600">● Under budget</span>
                <span className="text-red-600">● Over budget</span>
              </>
            )}
            <span className="ml-auto italic">Auto-saves every keystroke</span>
          </div>
        )}
      </div>
    </div>
  );
}
