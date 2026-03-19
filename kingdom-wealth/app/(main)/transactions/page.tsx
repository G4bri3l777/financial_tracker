"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/app/hooks/useAuth";
import { useAccounts } from "@/app/hooks/useAccounts";
import { useMembers } from "@/app/hooks/useMembers";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import { useBudget } from "@/app/hooks/useBudget";
import AddTransactionForm, { type AddTransactionFormResult } from "@/app/components/AddTransactionForm";
import { CATEGORIES, getCategoryEmoji } from "@/app/lib/categories";
import { db, storage } from "@/app/lib/firebase";

type Tx = {
  id:            string;
  date:          string;
  month:         string;
  desc:          string;
  merchantName:  string;
  amount:        number;
  direction:     "debit" | "credit" | "";
  type:          "income" | "expense" | "transfer" | "refund";
  category:      string;
  subcat:        string;
  accountId:     string;
  assignedTo:    string;
  assignedToName: string;
  comment:       string;
  isCash:        boolean;
  cashReason:    string;
  receiptUrl:    string;
  reviewed:      boolean;
  flagged:       boolean;
  addedManually: boolean;
  sourceDocId:   string;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);

function toYM(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function toYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function monthRange(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(y, m, 0);
  return {
    from: `${ym}-01`,
    to: `${y}-${String(m).padStart(2,"0")}-${String(last.getDate()).padStart(2,"0")}`,
  };
}

const PAGE_SIZE = 10;

export default function TransactionsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId, setHouseholdId] = useState("");
  const [loadingCtx,  setLoadingCtx]  = useState(true);
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [saving,       setSaving]      = useState(false);
  const [toast,        setToast]       = useState("");
  const [showAdd,      setShowAdd]     = useState(false);
  const [expandedId,   setExpandedId]  = useState<string | null>(null);

  const [accountFilter,  setAccountFilter]  = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subcatFilter,   setSubcatFilter]   = useState("all");
  const [personFilter,   setPersonFilter]   = useState("all");
  const [typeFilter,     setTypeFilter]     = useState("all");
  const [dateFrom,       setDateFrom]       = useState(() => monthRange(toYM()).from);
  const [dateTo,         setDateTo]         = useState(() => monthRange(toYM()).to);
  const [search,         setSearch]         = useState("");
  const [currentPage,    setCurrentPage]    = useState(1);

  const currentYM = toYM();
  const { budget } = useBudget(householdId || undefined, currentYM);
  const { accounts } = useAccounts(householdId || undefined);
  const members = useMembers(householdId || undefined);

  const subcatOptions = useMemo(() => ({
    transactions: transactions.map(t => ({ category: t.category, subcat: t.subcat })),
  }), [transactions]);
  const { subcatsByParent } = useSubcategories(householdId || undefined, subcatOptions);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const hid = String(snap.data()?.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, "households", householdId, "transactions"),
      orderBy("date", "desc"),
    );
    return onSnapshot(q, snap => {
      setTransactions(snap.docs.map(d => {
        const x = d.data() as Record<string, unknown>;
        const dateStr = String(x.date ?? "");
        return {
          id:            d.id,
          date:          dateStr,
          month:         String(x.month ?? dateStr.slice(0, 7)),
          desc:          String(x.desc ?? ""),
          merchantName:  String(x.merchantName ?? x.desc ?? ""),
          amount:        Math.abs(Number(x.amount ?? 0)),
          direction:     x.direction === "debit" || x.direction === "credit"
                           ? x.direction : "",
          type:          (x.type as Tx["type"]) ?? "expense",
          category:      String(x.category ?? ""),
          subcat:        String(x.subcat ?? ""),
          accountId:     String(x.accountId ?? ""),
          assignedTo:    String(x.assignedTo ?? ""),
          assignedToName: String(x.assignedToName ?? ""),
          comment:       String(x.comment ?? ""),
          isCash:        Boolean(x.isCash),
          cashReason:    String(x.cashReason ?? ""),
          receiptUrl:    String(x.receiptUrl ?? ""),
          reviewed:      Boolean(x.reviewed),
          flagged:       Boolean(x.flagged),
          addedManually: Boolean(x.addedManually),
          sourceDocId:   String(x.sourceDocId ?? ""),
        } satisfies Tx;
      }));
    });
  }, [householdId]);

  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (accountFilter  !== "all" && tx.accountId  !== accountFilter)  return false;
      if (categoryFilter !== "all" && tx.category   !== categoryFilter) return false;
      if (subcatFilter   !== "all" && tx.subcat     !== subcatFilter)   return false;
      if (personFilter   !== "all" && tx.assignedTo !== personFilter)   return false;
      if (typeFilter     !== "all" && tx.type       !== typeFilter)     return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo   && tx.date > dateTo)   return false;
      if (search.trim() &&
          !tx.merchantName.toLowerCase().includes(search.toLowerCase()) &&
          !tx.desc.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [transactions, accountFilter, categoryFilter, subcatFilter,
      personFilter, typeFilter, dateFrom, dateTo, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedFiltered = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage]
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [accountFilter, categoryFilter, subcatFilter, personFilter, typeFilter, dateFrom, dateTo, search]);

  const kpis = useMemo(() => {
    const income   = filtered.filter(t => t.type === "income" || t.type === "refund")
                             .reduce((s,t) => s + t.amount, 0);
    const expenses = filtered.filter(t => t.type === "expense")
                             .reduce((s,t) => s + t.amount, 0);
    return { income, expenses, net: income - expenses };
  }, [filtered]);

  const budgetVsActual = useMemo(() => {
    if (!budget) return [];
    const cats = budget.categories ?? {};
    const currentMonthTxns = transactions.filter(
      t => t.type === "expense" && t.month === currentYM
    );
    const topCats = new Set(
      Object.keys(cats).filter(k => !k.includes(":"))
    );
    return Array.from(topCats).map(cat => {
      const subcatKeys = Object.keys(cats).filter(k => k.startsWith(`${cat}:`));
      const budgeted = subcatKeys.length > 0
        ? subcatKeys.reduce((s, k) => s + (cats[k] || 0), 0)
        : (cats[cat] || 0);
      const actual = currentMonthTxns
        .filter(t => t.category === cat)
        .reduce((s, t) => s + t.amount, 0);
      return { cat, budgeted, actual };
    }).filter(r => r.budgeted > 0 || r.actual > 0)
      .sort((a, b) => b.actual - a.actual);
  }, [budget, transactions, currentYM]);

  async function updateTx(txId: string, patch: Partial<Tx>) {
    if (!householdId) return;
    await updateDoc(
      doc(db, "households", householdId, "transactions", txId),
      patch as Record<string, unknown>,
    );
  }

  async function uploadReceiptForEdit(file: File, txId: string): Promise<string> {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `households/${householdId}/receipts/${txId}.${ext}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    return getDownloadURL(fileRef);
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const accountById = useMemo(() => {
    const m = new Map<string, (typeof accounts)[number]>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  if (authLoading || loadingCtx) return (
    <div className="flex h-screen items-center justify-center bg-kw-bg">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-kw-bg text-kw-navy">

      {toast && (
        <div className="kw-toast">
          {toast}
        </div>
      )}

      <div className="border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
          
            <h1 className="text-xl font-bold text-[#1B2A4A]">Transactions</h1>
            <span className="kw-badge-gray">
              {filtered.length} shown
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowAdd((p) => !p)}
              className="kw-btn-primary"
            >
              {showAdd ? "✕ Cancel" : "+ Add Transaction"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">

        {showAdd && householdId && user && (
          <div className="kw-card">
            <h2 className="mb-4 kw-section-title">New Transaction</h2>
            <AddTransactionForm
              householdId={householdId}
              user={user}
              accounts={accounts}
              members={members}
              subcatsByParent={subcatsByParent}
              defaultAssignedTo={user.uid}
              onSaved={(result: AddTransactionFormResult) => {
                showToast(result.message);
                if (result.success) setShowAdd(false);
              }}
              onCancel={() => setShowAdd(false)}
            />
          </div>
        )}

        {budgetVsActual.length > 0 && (
          <div className="kw-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="kw-section-title">
                Budget vs Actual — {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
              </h3>
              <Link href="/budget" className="text-xs font-semibold text-[#C9A84C] hover:text-[#1B2A4A]">
                Edit budget →
              </Link>
            </div>
            <div className="space-y-2.5">
              {budgetVsActual.slice(0, 8).map(row => {
                const pct     = row.budgeted > 0 ? Math.min(100, Math.round((row.actual / row.budgeted) * 100)) : 0;
                const isOver  = row.actual > row.budgeted && row.budgeted > 0;
                const barColor = isOver ? "#DC2626" : pct > 80 ? "#D97706" : "#16A34A";
                return (
                  <div key={row.cat} className="flex items-center gap-3">
                    <span className="w-6 text-sm">{getCategoryEmoji(row.cat)}</span>
                    <span className="w-24 shrink-0 text-xs font-semibold text-[#1B2A4A]">{row.cat}</span>
                    <div className="flex-1 h-2 overflow-hidden rounded-full bg-[#F4F6FA]">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: barColor }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[11px]">
                      <span className={isOver ? "font-bold text-red-600" : "text-[#1B2A4A]"}>{fmt(row.actual)}</span>
                      {row.budgeted > 0 && <span className="text-[#9AA5B4]"> / {fmt(row.budgeted)}</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-kw-border bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[180px] flex-1">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#9AA5B4] text-xs">⌕</span>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search merchants..."
                className="h-8 w-full rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] pl-7 pr-3 text-xs focus:border-[#C9A84C] focus:outline-none"
              />
            </div>
            <select
              value={accountFilter}
              onChange={e => setAccountFilter(e.target.value)}
              className="kw-input-sm"
            >
              <option value="all">All accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.nickname}</option>)}
            </select>
            <select
              value={categoryFilter}
              onChange={e => { setCategoryFilter(e.target.value); setSubcatFilter("all"); }}
              className="kw-input-sm"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
            </select>
            {categoryFilter !== "all" && (subcatsByParent[categoryFilter] ?? []).length > 0 && (
              <select
                value={subcatFilter}
                onChange={e => setSubcatFilter(e.target.value)}
                className="h-8 rounded-xl border border-[#E4E8F0] bg-[#FFF8E8] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
              >
                <option value="all">All subcats</option>
                {(subcatsByParent[categoryFilter] ?? []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
              </select>
            )}
            <select
              value={personFilter}
              onChange={e => setPersonFilter(e.target.value)}
              className="kw-input-sm"
            >
              <option value="all">Everyone</option>
              {members.map(m => <option key={m.uid} value={m.uid}>{m.firstName || m.displayName}</option>)}
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="kw-input-sm"
            >
              <option value="all">All types</option>
              <option value="expense">Expense</option>
              <option value="income">Income</option>
              <option value="transfer">Transfer</option>
              <option value="refund">Refund</option>
            </select>
            <input
              type="date"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="kw-input-sm"
            />
            <span className="kw-caption">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="kw-input-sm"
            />
            {(accountFilter !== "all" || categoryFilter !== "all" || personFilter !== "all" || typeFilter !== "all" || dateFrom || dateTo || search) && (
              <button
                type="button"
                onClick={() => {
                  setAccountFilter("all"); setCategoryFilter("all");
                  setSubcatFilter("all"); setPersonFilter("all");
                  setTypeFilter("all"); setDateFrom(""); setDateTo(""); setSearch("");
                }}
                className="rounded-xl border border-red-100 bg-red-50 px-3 py-1 text-xs font-semibold text-red-500 hover:bg-red-100"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white">
          {filtered.length === 0 ? (
            <div className="kw-empty text-sm text-kw-muted">No transactions match these filters.</div>
          ) : (
            paginatedFiltered.map((tx, i) => {
              const acc = tx.accountId ? accountById.get(tx.accountId) : undefined;
              const isCredit = tx.direction === "credit" || tx.type === "income" || tx.type === "refund";
              const isExpanded = expandedId === tx.id;
              return (
                <div key={tx.id} className={`border-b border-[#F4F6FA] ${i%2===0?"bg-white":"bg-[#FAFAFA]"}`}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : tx.id)}
                    className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[#F9FAFC]"
                  >
                    {tx.receiptUrl ? (
                      <img
                        src={tx.receiptUrl}
                        alt="Receipt"
                        className="h-9 w-9 shrink-0 rounded-lg object-cover border border-[#E4E8F0]"
                        onClick={e => { e.stopPropagation(); window.open(tx.receiptUrl, "_blank"); }}
                      />
                    ) : (
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F4F6FA] text-base">
                        {tx.category ? getCategoryEmoji(tx.category) : "💳"}
                      </div>
                    )}
                    <span className="w-20 shrink-0 text-xs text-[#9AA5B4]">{tx.date}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-[#1B2A4A]">
                        {tx.merchantName || tx.desc}
                        {tx.isCash && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-700">CASH</span>
                        )}
                      </p>
                      {(tx.category || tx.subcat) && (
                        <p className="kw-caption text-[10px]">
                          {getCategoryEmoji(tx.category)} {tx.category}
                          {tx.subcat && ` › ${tx.subcat}`}
                        </p>
                      )}
                    </div>
                    {acc && (
                      <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ backgroundColor: acc.color ?? "#9AA5B4" }}>
                        ••{acc.last4}
                      </span>
                    )}
                    <span className="w-16 shrink-0 text-right text-[11px] text-[#9AA5B4]">{tx.assignedToName?.split(" ")[0]}</span>
                    <span className={`w-20 shrink-0 text-right text-sm font-bold ${isCredit ? "text-green-600" : "text-[#1B2A4A]"}`}>
                      {isCredit ? "+" : "−"}{fmt(tx.amount)}
                    </span>
                    <span className="kw-caption text-[10px]">{isExpanded ? "▲" : "▾"}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[#F4F6FA] bg-[#F9FAFC] px-5 py-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <label className="kw-label">Date</label>
                          <input
                            type="date"
                            defaultValue={tx.date}
                            onBlur={e => void updateTx(tx.id, { date: e.target.value, month: e.target.value.slice(0,7) })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="kw-label">Amount</label>
                          <input
                            type="number"
                            defaultValue={tx.amount}
                            onBlur={e => void updateTx(tx.id, { amount: Math.abs(Number(e.target.value)) })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="kw-label">Category</label>
                          <select
                            defaultValue={tx.category}
                            onChange={e => void updateTx(tx.id, { category: e.target.value, subcat: "" })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          >
                            <option value="">—</option>
                            {CATEGORIES.map(c => <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="kw-label">Subcategory</label>
                          <select
                            defaultValue={tx.subcat}
                            onChange={e => void updateTx(tx.id, { subcat: e.target.value })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          >
                            <option value="">—</option>
                            {(subcatsByParent[tx.category] ?? []).map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="kw-label">Account</label>
                          <select
                            defaultValue={tx.accountId}
                            onChange={e => void updateTx(tx.id, { accountId: e.target.value })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          >
                            <option value="">—</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.nickname} ••{a.last4}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="kw-label">Person</label>
                          <select
                            defaultValue={tx.assignedTo}
                            onChange={e => {
                              const m = members.find(x => x.uid === e.target.value);
                              void updateTx(tx.id, { assignedTo: e.target.value, assignedToName: m?.firstName || m?.displayName || "" });
                            }}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          >
                            {members.map(m => <option key={m.uid} value={m.uid}>{m.firstName || m.displayName}</option>)}
                          </select>
                        </div>
                        <div className="col-span-2">
                          <label className="kw-label">Comment</label>
                          <input
                            type="text"
                            defaultValue={tx.comment}
                            onBlur={e => void updateTx(tx.id, { comment: e.target.value })}
                            placeholder="Add note..."
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-4">
                          <label className="kw-label">Receipt {tx.receiptUrl && "✅"}</label>
                          <div className="flex items-center gap-3">
                            {tx.receiptUrl && (
                              <a href={tx.receiptUrl} target="_blank" rel="noreferrer" className="kw-btn-sm">
                                View receipt →
                              </a>
                            )}
                            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed border-[#C9A84C] px-3 py-1.5 text-xs font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
                              📷 {tx.receiptUrl ? "Replace" : "Add receipt"}
                              <input
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="hidden"
                                onChange={async e => {
                                  const file = e.target.files?.[0];
                                  if (!file) return;
                                  const url = await uploadReceiptForEdit(file, tx.id);
                                  await updateTx(tx.id, { receiptUrl: url });
                                  showToast("Receipt uploaded ✅");
                                }}
                              />
                            </label>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
          {filtered.length > 0 && (
            <div className="flex items-center justify-between border-t border-[#F4F6FA] px-5 py-3">
              <span className="kw-caption">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="kw-btn-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span className="text-xs font-semibold text-kw-navy">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="kw-btn-sm disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
