"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  orderBy, query, serverTimestamp, updateDoc,
} from "firebase/firestore";
import {
  getStorage, ref as storageRef,
  uploadBytes, getDownloadURL,
} from "firebase/storage";
import { useAuth } from "@/app/hooks/useAuth";
import { useAccounts } from "@/app/hooks/useAccounts";
import { useMembers } from "@/app/hooks/useMembers";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import { useBudget } from "@/app/hooks/useBudget";
import { CATEGORIES, getCategoryEmoji } from "@/app/lib/categories";
import { db } from "@/app/lib/firebase";

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

type AddForm = {
  date:       string;
  desc:       string;
  amount:     string;
  type:       "income" | "expense" | "transfer" | "refund";
  category:   string;
  subcat:     string;
  accountId:  string;
  assignedTo: string;
  comment:    string;
  isCash:     boolean;
  cashReason: string;
  receiptFile: File | null;
  transferFromAccountId: string;
  transferToAccountId:   string;
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
  const [uploadPct,    setUploadPct]   = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState<null | "type" | "account" | "transferFrom" | "transferTo">(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

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

  const defaultForm = (): AddForm => ({
    date:        toYmd(),
    desc:        "",
    amount:      "",
    type:        "expense",
    category:    "",
    subcat:      "",
    accountId:   "",
    assignedTo:  user?.uid ?? "",
    comment:     "",
    isCash:      false,
    cashReason:  "",
    receiptFile: null,
    transferFromAccountId: "",
    transferToAccountId:   "",
  });
  const [form, setForm] = useState<AddForm>(defaultForm);

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
        const x = d.data();
        return {
          id:            d.id,
          date:          String(x.date ?? ""),
          month:         String(x.month ?? x.date?.slice(0,7) ?? ""),
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

  async function uploadReceipt(file: File, txId: string): Promise<string> {
    const storage  = getStorage();
    const ext      = file.name.split(".").pop() ?? "jpg";
    const path     = `households/${householdId}/receipts/${txId}.${ext}`;
    const fileRef  = storageRef(storage, path);
    setUploadPct(10);
    await uploadBytes(fileRef, file);
    setUploadPct(80);
    const url = await getDownloadURL(fileRef);
    setUploadPct(100);
    setTimeout(() => setUploadPct(0), 1000);
    return url;
  }

  async function saveTransaction() {
    if (!householdId || !user) return;
    const amount = Math.abs(parseFloat(form.amount || "0"));
    if (!form.date || !form.desc.trim() || !(amount > 0)) {
      showToast("Date, merchant, and amount are required.");
      return;
    }

    // Transfer requires both FROM and TO
    if (form.type === "transfer") {
      if (!form.transferFromAccountId || !form.transferToAccountId) {
        showToast("Please select both FROM and TO accounts for a transfer.");
        return;
      }
      if (form.transferFromAccountId === form.transferToAccountId) {
        showToast("FROM and TO accounts must be different.");
        return;
      }
    }

    setSaving(true);
    try {
      const mem = members.find(m => m.uid === form.assignedTo);
      const assignedToName = mem?.firstName || mem?.displayName || user.displayName || "Member";

      const pairId = form.type === "transfer"
        ? `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        : null;

      const basePayload = {
        date:          form.date,
        month:         form.date.slice(0, 7),
        desc:          form.desc.trim(),
        merchantName:  form.desc.trim(),
        amount,
        type:          form.type,
        category:      form.category  || null,
        subcat:        form.subcat    || null,
        assignedTo:    form.assignedTo || user.uid,
        assignedToName,
        comment:       form.comment.trim() || null,
        isCash:        form.isCash,
        cashReason:    form.isCash ? form.cashReason.trim() : null,
        reviewed:      false,
        flagged:       false,
        addedManually: true,
        createdAt:     serverTimestamp(),
      };

      if (form.type !== "transfer") {
        // ── Single transaction ──────────────────────────
        const acc = form.accountId ? accounts.find(a => a.id === form.accountId) : null;
        const direction = form.type === "income" || form.type === "refund" ? "credit" : "debit";
        const docRef = await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction,
            accountId:    acc?.id    ?? null,
            accountLabel: acc ? `${acc.bankName} ••${acc.last4}` : null,
          },
        );
        if (form.receiptFile) {
          const url = await uploadReceipt(form.receiptFile, docRef.id);
          await updateDoc(docRef, { receiptUrl: url });
        }
      } else {
        // ── Transfer: create TWO linked transactions ────
        const fromId = form.transferFromAccountId === "__external__"
          ? null : form.transferFromAccountId;
        const toId   = form.transferToAccountId   === "__external__"
          ? null : form.transferToAccountId;

        const fromAcc = fromId ? accounts.find(a => a.id === fromId) : null;
        const toAcc   = toId   ? accounts.find(a => a.id === toId)   : null;

        const isCardPayment = toAcc?.type === "credit";
        const transferType  = isCardPayment ? "card-payment"
          : (fromId && toId) ? "internal"
          : fromId ? "external-own"
          : "external-third-party";

        // DEBIT side — money leaves the FROM account
        const debitRef = await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction:             "debit",
            accountId:             fromId,
            accountLabel:          fromAcc ? `${fromAcc.bankName} ••${fromAcc.last4}` : "External",
            transferPairId:        pairId,
            transferType,
            transferFromAccountId: fromId,
            transferToAccountId:   toId,
          },
        );

        // CREDIT side — money arrives at the TO account
        await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction:             "credit",
            accountId:             toId,
            accountLabel:          toAcc ? `${toAcc.bankName} ••${toAcc.last4}` : "External",
            transferPairId:        pairId,
            transferType,
            transferFromAccountId: fromId,
            transferToAccountId:   toId,
          },
        );

        // Attach receipt to debit side if provided
        if (form.receiptFile) {
          const url = await uploadReceipt(form.receiptFile, debitRef.id);
          await updateDoc(debitRef, { receiptUrl: url });
        }
      }

      showToast(`✅ ${form.desc.trim()} — ${fmt(amount)} saved`);
                setForm(defaultForm());
                setShowAdd(false);
                setDropdownOpen(null);
    } catch (e) {
      showToast("Error: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setSaving(false);
    }
  }

  async function updateTx(txId: string, patch: Partial<Tx>) {
    if (!householdId) return;
    await updateDoc(
      doc(db, "households", householdId, "transactions", txId),
      patch as Record<string, unknown>,
    );
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
    <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-[#1B2A4A] shadow-lg border border-[#E4E8F0]">
          {toast}
        </div>
      )}

      <div className="border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
          
            <h1 className="text-xl font-bold text-[#1B2A4A]">Transactions</h1>
            <span className="rounded-full bg-[#F4F6FA] px-2.5 py-1 text-xs font-semibold text-[#9AA5B4]">
              {filtered.length} shown
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { setShowAdd(p => !p); setForm(defaultForm()); setDropdownOpen(null); }}
              className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-bold text-[#1B2A4A]"
            >
              {showAdd ? "✕ Cancel" : "+ Add Transaction"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl space-y-4 px-6 py-5">

        {showAdd && (
          <div ref={dropdownRef} className="rounded-2xl border border-[#E4E8F0] bg-white p-6">
            <h2 className="mb-4 text-sm font-bold text-[#1B2A4A]">New Transaction</h2>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
                  className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Merchant / Description</label>
                <input
                  type="text"
                  value={form.desc}
                  onChange={e => setForm(p => ({ ...p, desc: e.target.value }))}
                  placeholder="e.g. Wegmans, Amazon"
                  className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Amount</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">$</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={form.amount}
                    onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                    placeholder="0.00"
                    className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white pl-6 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                  />
                </div>
              </div>
              <div className="relative">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Type</label>
                <button
                  type="button"
                  onClick={() => setDropdownOpen(d => d === "type" ? null : "type")}
                  className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                >
                  <span className="capitalize">{form.type || "— Select"}</span>
                  <span className="text-[10px] text-[#9AA5B4]">{dropdownOpen === "type" ? "▲" : "▾"}</span>
                </button>
                {dropdownOpen === "type" && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                    {(["expense","income","transfer","refund"] as const).map(t => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setForm(p => ({ ...p, type: t, category: "", transferFromAccountId: "", transferToAccountId: "" }));
                          setDropdownOpen(null);
                        }}
                        className={`flex w-full items-center px-3 py-2 text-left text-sm capitalize ${
                          form.type === t ? "bg-[#C9A84C]/15 font-semibold text-[#1B2A4A]" : "text-[#1B2A4A] hover:bg-[#F9FAFC]"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {form.type !== "transfer" && (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Category</label>
                  <select
                    value={form.category}
                    onChange={e => setForm(p => ({ ...p, category: e.target.value, subcat: "" }))}
                    className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">— Select</option>
                    {CATEGORIES.map(c => (
                      <option key={c.name} value={c.name}>{c.emoji} {c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {form.category && (subcatsByParent[form.category] ?? []).length > 0 && (
                <div>
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Subcategory</label>
                  <select
                    value={form.subcat}
                    onChange={e => setForm(p => ({ ...p, subcat: e.target.value }))}
                    className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                  >
                    <option value="">— Select</option>
                    {(subcatsByParent[form.category] ?? []).map(s => (
                      <option key={s.id} value={s.name}>{s.name}</option>
                    ))}
                  </select>
                </div>
              )}
              {/* ── Non-transfer: single account dropdown ── */}
              {form.type !== "transfer" && (
                <div className="relative">
                  <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                    Account / Card
                  </label>
                  <button
                    type="button"
                    onClick={() => setDropdownOpen(d => d === "account" ? null : "account")}
                    className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                  >
                    {form.accountId ? (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{ backgroundColor: accounts.find(a => a.id === form.accountId)?.color ?? "#9AA5B4" }}
                        />
                        {accounts.find(a => a.id === form.accountId)?.nickname} ••{accounts.find(a => a.id === form.accountId)?.last4}
                      </span>
                    ) : (
                      <span className="text-[#9AA5B4]">— Select</span>
                    )}
                    <span className="text-[10px] text-[#9AA5B4]">{dropdownOpen === "account" ? "▲" : "▾"}</span>
                  </button>
                  {dropdownOpen === "account" && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                      {accounts.map(a => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => {
                            setForm(p => ({ ...p, accountId: a.id }));
                            setDropdownOpen(null);
                          }}
                          className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                            form.accountId === a.id ? "bg-[#C9A84C]/15 font-semibold text-[#1B2A4A]" : "text-[#1B2A4A] hover:bg-[#F9FAFC]"
                          }`}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: a.color ?? "#9AA5B4" }}
                          />
                          {a.nickname}
                          <span className="text-[9px] opacity-60">••{a.last4}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Transfer: FROM + TO account selectors ── */}
              {form.type === "transfer" && (
                <div className="col-span-2 sm:col-span-3 space-y-3">
                  <div className="rounded-2xl border border-[#E4E8F0] bg-[#F9FAFC] p-4">
                    <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                      Transfer Direction
                    </p>

                    {/* FROM account */}
                    <div className="relative mb-3">
                      <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-orange-500">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-100 text-orange-600 text-[9px] font-black">↑</span>
                        From (money leaves)
                      </label>
                      <button
                        type="button"
                        onClick={() => setDropdownOpen(d => d === "transferFrom" ? null : "transferFrom")}
                        className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                      >
                        {form.transferFromAccountId ? (
                          form.transferFromAccountId === "__external__" ? (
                            <span className="text-[#1B2A4A]">External</span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: accounts.find(a => a.id === form.transferFromAccountId)?.color ?? "#9AA5B4" }}
                              />
                              {accounts.find(a => a.id === form.transferFromAccountId)?.nickname} ••{accounts.find(a => a.id === form.transferFromAccountId)?.last4}
                            </span>
                          )
                        ) : (
                          <span className="text-[#9AA5B4]">— Select</span>
                        )}
                        <span className="text-[10px] text-[#9AA5B4]">{dropdownOpen === "transferFrom" ? "▲" : "▾"}</span>
                      </button>
                      {dropdownOpen === "transferFrom" && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                          {accounts.map(a => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => {
                                setForm(p => ({ ...p, transferFromAccountId: a.id, accountId: a.id }));
                                setDropdownOpen(null);
                              }}
                              className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                                form.transferFromAccountId === a.id ? "bg-[#C9A84C]/15 font-semibold" : "hover:bg-[#F9FAFC]"
                              }`}
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.color ?? "#9AA5B4" }} />
                              {a.nickname}
                              <span className="text-[10px] opacity-60">••{a.last4}</span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setForm(p => ({ ...p, transferFromAccountId: "__external__" }));
                              setDropdownOpen(null);
                            }}
                            className={`flex w-full items-center px-3 py-2 text-left text-sm ${form.transferFromAccountId === "__external__" ? "bg-[#C9A84C]/15 font-semibold" : "hover:bg-[#F9FAFC]"}`}
                          >
                            External
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Arrow */}
                    {form.transferFromAccountId && form.transferToAccountId && (
                      <div className="my-2 flex items-center justify-center gap-3 text-xs text-[#9AA5B4]">
                        <span
                          className="rounded-full px-2 py-1 text-[10px] font-bold text-white"
                          style={{
                            backgroundColor: form.transferFromAccountId === "__external__"
                              ? "#9AA5B4"
                              : accounts.find(a => a.id === form.transferFromAccountId)?.color ?? "#9AA5B4"
                          }}
                        >
                          {form.transferFromAccountId === "__external__"
                            ? "External"
                            : accounts.find(a => a.id === form.transferFromAccountId)?.nickname ?? "?"}
                        </span>
                        <span className="font-bold">→</span>
                        <span
                          className="rounded-full px-2 py-1 text-[10px] font-bold text-white"
                          style={{
                            backgroundColor: form.transferToAccountId === "__external__"
                              ? "#9AA5B4"
                              : accounts.find(a => a.id === form.transferToAccountId)?.color ?? "#9AA5B4"
                          }}
                        >
                          {form.transferToAccountId === "__external__"
                            ? "External"
                            : accounts.find(a => a.id === form.transferToAccountId)?.nickname ?? "?"}
                        </span>
                      </div>
                    )}

                    {/* TO account */}
                    <div className="relative">
                      <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-600">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-green-600 text-[9px] font-black">↓</span>
                        To (money arrives)
                      </label>
                      <button
                        type="button"
                        onClick={() => setDropdownOpen(d => d === "transferTo" ? null : "transferTo")}
                        className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                      >
                        {form.transferToAccountId ? (
                          form.transferToAccountId === "__external__" ? (
                            <span className="text-[#1B2A4A]">External</span>
                          ) : (
                            <span className="flex items-center gap-1.5">
                              <span
                                className="h-2 w-2 rounded-full shrink-0"
                                style={{ backgroundColor: accounts.find(a => a.id === form.transferToAccountId)?.color ?? "#9AA5B4" }}
                              />
                              {accounts.find(a => a.id === form.transferToAccountId)?.nickname} ••{accounts.find(a => a.id === form.transferToAccountId)?.last4}
                            </span>
                          )
                        ) : (
                          <span className="text-[#9AA5B4]">— Select</span>
                        )}
                        <span className="text-[10px] text-[#9AA5B4]">{dropdownOpen === "transferTo" ? "▲" : "▾"}</span>
                      </button>
                      {dropdownOpen === "transferTo" && (
                        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                          {accounts.map(a => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => {
                                setForm(p => ({ ...p, transferToAccountId: a.id }));
                                setDropdownOpen(null);
                              }}
                              className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                                form.transferToAccountId === a.id ? "bg-[#C9A84C]/15 font-semibold" : "hover:bg-[#F9FAFC]"
                              }`}
                            >
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: a.color ?? "#9AA5B4" }} />
                              {a.nickname}
                              <span className="text-[10px] opacity-60">••{a.last4}</span>
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              setForm(p => ({ ...p, transferToAccountId: "__external__" }));
                              setDropdownOpen(null);
                            }}
                            className={`flex w-full items-center px-3 py-2 text-left text-sm ${form.transferToAccountId === "__external__" ? "bg-[#C9A84C]/15 font-semibold" : "hover:bg-[#F9FAFC]"}`}
                          >
                            External
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Transfer type hint */}
                  {form.transferFromAccountId && form.transferToAccountId && (() => {
                    const fromAcc = accounts.find(a => a.id === form.transferFromAccountId);
                    const toAcc   = accounts.find(a => a.id === form.transferToAccountId);
                    const isCardPayment = toAcc?.type === "credit";
                    const isInternal    = fromAcc && toAcc && fromAcc.type !== "credit";
                    return (
                      <p className="text-[10px] text-[#9AA5B4] px-1">
                        {isCardPayment
                          ? "💳 This looks like a credit card payment — two transactions will be created"
                          : isInternal
                            ? "🔄 Internal transfer between your accounts — two transactions will be created"
                            : "↔ Transfer recorded"}
                      </p>
                    );
                  })()}
                </div>
              )}
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Person</label>
                <div className="flex gap-1">
                  {members.map(m => (
                    <button
                      key={m.uid}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, assignedTo: m.uid }))}
                      className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                        form.assignedTo === m.uid
                          ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                          : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                      }`}
                    >
                      {m.firstName || m.displayName}
                    </button>
                  ))}
                </div>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Comment</label>
                <input
                  type="text"
                  value={form.comment}
                  onChange={e => setForm(p => ({ ...p, comment: e.target.value }))}
                  placeholder="Optional note..."
                  className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label
                  className="flex cursor-pointer items-center gap-2"
                  onClick={() => setForm(p => ({ ...p, isCash: !p.isCash }))}
                >
                  <div className={`relative h-5 w-9 rounded-full transition-colors ${form.isCash ? "bg-[#C9A84C]" : "bg-[#E4E8F0]"}`}>
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.isCash ? "translate-x-4" : "translate-x-0.5"}`} />
                  </div>
                  <span className="text-xs font-semibold text-[#1B2A4A]">This was a cash expense</span>
                </label>
                {form.isCash && (
                  <input
                    type="text"
                    value={form.cashReason}
                    onChange={e => setForm(p => ({ ...p, cashReason: e.target.value }))}
                    placeholder="Why cash? (e.g. vendor only accepts cash)"
                    className="mt-2 h-9 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm focus:border-amber-400 focus:outline-none"
                  />
                )}
              </div>
              <div className="col-span-2 sm:col-span-3">
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Receipt Photo (optional)</label>
                <div className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#C9A84C] bg-[#FFFBF0] px-4 py-2.5 text-xs font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
                    📷 {form.receiptFile ? form.receiptFile.name : "Attach receipt"}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => setForm(p => ({ ...p, receiptFile: e.target.files?.[0] ?? null }))}
                    />
                  </label>
                  {form.receiptFile && (
                    <>
                      <img
                        src={URL.createObjectURL(form.receiptFile)}
                        alt="Receipt preview"
                        className="h-12 w-12 rounded-lg object-cover border border-[#E4E8F0]"
                      />
                      <button
                        type="button"
                        onClick={() => setForm(p => ({ ...p, receiptFile: null }))}
                        className="text-xs text-[#9AA5B4] hover:text-red-400"
                      >
                        ✕ Remove
                      </button>
                    </>
                  )}
                </div>
                {uploadPct > 0 && uploadPct < 100 && (
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
                    <div className="h-1.5 rounded-full bg-[#C9A84C] transition-all" style={{ width: `${uploadPct}%` }} />
                  </div>
                )}
              </div>
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveTransaction()}
                className="rounded-xl bg-[#C9A84C] px-6 py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Transaction"}
              </button>
              <button
                type="button"
                onClick={() => { setShowAdd(false); setForm(defaultForm()); }}
                className="rounded-xl border border-[#E4E8F0] px-4 py-2.5 text-sm font-semibold text-[#9AA5B4]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}



        {budgetVsActual.length > 0 && (
          <div className="rounded-2xl border border-[#E4E8F0] bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#1B2A4A]">
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

        <div className="rounded-2xl border border-[#E4E8F0] bg-white p-4">
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
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="all">All accounts</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.nickname}</option>)}
            </select>
            <select
              value={categoryFilter}
              onChange={e => { setCategoryFilter(e.target.value); setSubcatFilter("all"); }}
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
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
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="all">Everyone</option>
              {members.map(m => <option key={m.uid} value={m.uid}>{m.firstName || m.displayName}</option>)}
            </select>
            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
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
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
            />
            <span className="text-xs text-[#9AA5B4]">—</span>
            <input
              type="date"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
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
            <div className="py-16 text-center text-sm text-[#9AA5B4]">No transactions match these filters.</div>
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
                        <p className="text-[10px] text-[#9AA5B4]">
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
                    <span className="text-[10px] text-[#9AA5B4]">{isExpanded ? "▲" : "▾"}</span>
                  </button>
                  {isExpanded && (
                    <div className="border-t border-[#F4F6FA] bg-[#F9FAFC] px-5 py-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Date</label>
                          <input
                            type="date"
                            defaultValue={tx.date}
                            onBlur={e => void updateTx(tx.id, { date: e.target.value, month: e.target.value.slice(0,7) })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Amount</label>
                          <input
                            type="number"
                            defaultValue={tx.amount}
                            onBlur={e => void updateTx(tx.id, { amount: Math.abs(Number(e.target.value)) })}
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Category</label>
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
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Subcategory</label>
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
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Account</label>
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
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Person</label>
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
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Comment</label>
                          <input
                            type="text"
                            defaultValue={tx.comment}
                            onBlur={e => void updateTx(tx.id, { comment: e.target.value })}
                            placeholder="Add note..."
                            className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                        <div className="col-span-2 sm:col-span-4">
                          <label className="mb-1 block text-[10px] font-bold uppercase text-[#9AA5B4]">Receipt {tx.receiptUrl && "✅"}</label>
                          <div className="flex items-center gap-3">
                            {tx.receiptUrl && (
                              <a href={tx.receiptUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]">
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
                                  const url = await uploadReceipt(file, tx.id);
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
              <span className="text-xs text-[#9AA5B4]">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–{Math.min(currentPage * PAGE_SIZE, filtered.length)} of {filtered.length}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#F9FAFC]"
                >
                  ← Prev
                </button>
                <span className="text-xs font-semibold text-[#1B2A4A]">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] disabled:cursor-not-allowed disabled:opacity-50 hover:bg-[#F9FAFC]"
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
