"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc,
} from "firebase/firestore";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie,
} from "recharts";
import { useAuth } from "@/app/hooks/useAuth";
import { useAccounts } from "@/app/hooks/useAccounts";
import { useDebtAnswers } from "@/app/hooks/useDebtAnswers";
import { useHouseholdDebt } from "@/app/hooks/useHouseholdDebt";
import { useLoans, LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, type Loan, type LoanDraft } from "@/app/hooks/useLoans";
import { useMembers } from "@/app/hooks/useMembers";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import { CATEGORIES, getCategoryEmoji, getCategoryColor } from "@/app/lib/categories";
import { db } from "@/app/lib/firebase";

// ── Types ─────────────────────────────────────────────────────────
type Tx = {
  id: string;
  date: string;
  month: string;
  desc: string;
  merchantName: string;
  amount: number;
  direction: "debit" | "credit" | "";
  type: "income" | "expense" | "transfer" | "refund";
  category: string;
  subcat: string;
  isSubscription: boolean;
  accountId: string;
  assignedTo: string;
  assignedToName: string;
  sourceDocId: string;
  transferPairId: string;
  reviewed: boolean;
  flagged: boolean;
  addedManually?: boolean;
};

type DashTab = "overview" | "categories" | "transactions" | "trends";

// ── Helpers ───────────────────────────────────────────────────────
const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
    maximumFractionDigits: 0 }).format(n);
const fmtFull = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

// Map Loan type (useLoans) to Debt subcategory for transactions
const LOAN_TYPE_TO_SUBCAT: Record<Loan["type"], string> = {
  student:     "Student Loan",
  personal:    "Personal Loan",
  car:         "Car Loan",
  medical:     "Medical Debt",
  credit_card: "Credit Card",
  other:       "Personal Loan",
};
const DEFAULT_DEBT_SUBCATS = ["Credit Card", "Student Loan", "Car Loan", "Personal Loan", "Medical Debt"];

function getSubcatForLoan(
  loan: Loan,
  debtSubcatNames?: string[],
): string {
  if (loan.name?.trim() && DEFAULT_DEBT_SUBCATS.includes(loan.name.trim())) {
    return loan.name.trim();
  }
  if (
    loan.type === "other" &&
    loan.subtype?.trim() &&
    debtSubcatNames?.includes(loan.subtype.trim())
  ) {
    return loan.subtype.trim();
  }
  return LOAN_TYPE_TO_SUBCAT[loan.type];
}

const CATEGORY_COLORS: Record<string, string> = {
  Housing:     "#1B2A4A",
  Food:        "#C9A84C",
  Transport:   "#3B82F6",
  Health:      "#EF4444",
  Personal:    "#8B5CF6",
  Recreation:  "#F97316",
  Giving:      "#14B8A6",
  Debt:        "#6B7280",
  Savings:     "#22C55E",
  Insurance:   "#EC4899",
  Income:      "#16A34A",
};

function toYmd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Credit card helpers
function daysUntil(dateStr: string): number {
  if (!dateStr) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + "T00:00:00");
  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}
function dueDateColor(days: number): string {
  if (days < 0) return "#DC2626";
  if (days <= 7) return "#DC2626";
  if (days <= 14) return "#D97706";
  return "#16A34A";
}
function dueDateLabel(days: number, dateStr: string): string {
  if (!dateStr) return "Not set";
  if (days < 0) return `Overdue by ${Math.abs(days)} day${Math.abs(days) !== 1 ? "s" : ""}`;
  if (days === 0) return "Due TODAY";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}
function utilizationColor(pct: number): string {
  if (pct >= 90) return "#DC2626";
  if (pct >= 60) return "#EF4444";
  if (pct >= 30) return "#D97706";
  return "#16A34A";
}
function utilizationLabel(pct: number): string {
  if (pct >= 90) return "Critical — near limit";
  if (pct >= 60) return "High utilization";
  if (pct >= 30) return "Watch your usage";
  return "Good standing";
}
function cardsFormatDate(str: string): string {
  if (!str) return "—";
  try {
    return new Date(str + "T00:00:00").toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  } catch { return str; }
}

// ── Main Component ────────────────────────────────────────────────
export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [transactions, setTransactions] = useState<Tx[]>([]);
  const [activeTab, setActiveTab] = useState<DashTab>("overview");

  // Filters
  const [personFilter, setPersonFilter]     = useState("all");
  const [accountFilter, setAccountFilter]   = useState("all");
  const [docFilter, setDocFilter]           = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [subcatFilter, setSubcatFilter]     = useState("all");
  const [typeFilter, setTypeFilter]         = useState("all");
  const [dateFrom, setDateFrom]             = useState("");
  const [dateTo, setDateTo]                 = useState("");
  const [datePreset, setDatePreset]         = useState("all");
  const [search, setSearch]                 = useState("");
  const [openFilter, setOpenFilter] = useState<
    "account" | "people" | "category" | "date" | "more" | null
  >(null);
  const [editingDueDate, setEditingDueDate] = useState<Record<string, string>>({});
  const [savingDueDate, setSavingDueDate]   = useState<Record<string, boolean>>({});

  const { accounts } = useAccounts(householdId || undefined);
  const { studentBalance: debtAnswersStudentBalance, hasStudentLoans } = useDebtAnswers(user?.uid);
  const members      = useMembers(householdId || undefined);
  const documents    = useDocuments(householdId || undefined);
  const { loans: householdLoans, memberDebtAnswers: _memberDebtAnswers } = useHouseholdDebt(householdId || undefined, members);
  const { loans, loading: _loansLoading } = useLoans(householdId || undefined);

  // Loan editing state (households/{id}/loans collection)
  const [editingLoanId, setEditingLoanId]   = useState<string | null>(null);
  const [loanDraft, setLoanDraft]           = useState<Partial<LoanDraft>>({});
  const [savingLoan, setSavingLoan]         = useState(false);
  const [showAddLoan, setShowAddLoan]       = useState(false);
  const [loanSortMode, setLoanSortMode]     = useState<"snowball" | "avalanche" | "type">("snowball");
  const [selectedDebtItem, setSelectedDebtItem] = useState<{ type: "credit" | "loan"; id: string } | null>(null);
  const [topSpendingSelectedCategory, setTopSpendingSelectedCategory] = useState<string | null>(null);

  const subcatOptions = useMemo(
    () => ({
      transactions: transactions.map((t) => ({ category: t.category, subcat: t.subcat })),
      customLoanNames: householdLoans.map((l) => l.name?.trim()).filter(Boolean) as string[],
    }),
    [transactions, householdLoans],
  );
  const { subcatsByParent } = useSubcategories(householdId || undefined, subcatOptions);

  // Debt subcategories for loan Type dropdown (defaults + custom)
  const debtSubcatNames = useMemo(
    () => (subcatsByParent["Debt"] ?? []).map((s) => s.name),
    [subcatsByParent],
  );
  const customDebtSubcats = useMemo(
    () =>
      (subcatsByParent["Debt"] ?? []).filter(
        (s) => !DEFAULT_DEBT_SUBCATS.includes(s.name),
      ),
    [subcatsByParent],
  );
  const debtLoanTypeOptions = useMemo(
    () =>
      customDebtSubcats.length > 0
        ? {
            standard: Object.entries(LOAN_TYPE_LABELS).map(([val, lbl]) => ({
              value: val,
              label: lbl,
            })),
            custom: customDebtSubcats.map((s) => ({
              value: `custom:${s.name}`,
              label: s.name,
            })),
          }
        : null,
    [customDebtSubcats],
  );

  // Load household
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const hid = snap.data()?.householdId;
      if (hid) setHouseholdId(hid);
    });
  }, [authLoading, user, router]);

  // Live transactions
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
          month:         String(x.month ?? ""),
          desc:          String(x.desc ?? ""),
          merchantName:  String(x.merchantName ?? x.desc ?? ""),
          amount:        Math.abs(Number(x.amount ?? 0)),
          direction:     x.direction === "debit" || x.direction === "credit" ? x.direction : "",
          type:          (x.type as Tx["type"]) ?? "expense",
          category:      String(x.category ?? ""),
          subcat:        String(x.subcat ?? ""),
          isSubscription: Boolean(x.isSubscription),
          accountId:     String(x.accountId ?? ""),
          assignedTo:    String(x.assignedTo ?? ""),
          assignedToName: String(x.assignedToName ?? ""),
          sourceDocId:   String(x.sourceDocId ?? ""),
          transferPairId: String(x.transferPairId ?? ""),
          reviewed:      Boolean(x.reviewed),
          flagged:       Boolean(x.flagged),
          addedManually: Boolean(x.addedManually),
        } satisfies Tx;
      }));
    });
  }, [householdId]);

  // Date preset
  function applyPreset(preset: string) {
    setDatePreset(preset);
    const now = new Date();
    if (preset === "all")    { setDateFrom(""); setDateTo(""); return; }
    if (preset === "month")  {
      setDateFrom(toYmd(new Date(now.getFullYear(), now.getMonth(), 1)));
      setDateTo(toYmd(now)); return;
    }
    if (preset === "last")   {
      setDateFrom(toYmd(new Date(now.getFullYear(), now.getMonth()-1, 1)));
      setDateTo(toYmd(new Date(now.getFullYear(), now.getMonth(), 0))); return;
    }
    if (preset === "3m")     {
      const f = new Date(now); f.setMonth(now.getMonth()-3);
      setDateFrom(toYmd(f)); setDateTo(toYmd(now)); return;
    }
    if (preset === "6m")     {
      const f = new Date(now); f.setMonth(now.getMonth()-6);
      setDateFrom(toYmd(f)); setDateTo(toYmd(now)); return;
    }
  }

  // Account lookup
  const accountById = useMemo(() => {
    const m = new Map<string, typeof accounts[number]>();
    accounts.forEach(a => m.set(a.id, a));
    return m;
  }, [accounts]);

  // ── FILTERED TRANSACTIONS ──────────────────────────────────────
  const filtered = useMemo(() => {
    return transactions.filter(tx => {
      if (personFilter !== "all" && tx.assignedTo !== personFilter) return false;
      if (accountFilter !== "all" && tx.accountId !== accountFilter) return false;
      if (docFilter !== "all" && tx.sourceDocId !== docFilter) return false;
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
      if (subcatFilter !== "all" && tx.subcat !== subcatFilter) return false;
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo   && tx.date > dateTo)   return false;
      if (search.trim() && !tx.merchantName.toLowerCase().includes(search.toLowerCase())
          && !tx.desc.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [transactions, personFilter, accountFilter, docFilter, categoryFilter,
      subcatFilter, typeFilter, dateFrom, dateTo, search]);

  // ── KPIs ───────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const income   = filtered.filter(t => t.type === "income" || t.type === "refund")
                             .reduce((s, t) => s + t.amount, 0);
    const expenses = filtered.filter(t => t.type === "expense")
                             .reduce((s, t) => s + t.amount, 0);
    const moved    = filtered.filter(t => t.type === "transfer" && t.direction === "debit")
                             .reduce((s, t) => s + t.amount, 0);
    const net      = income - expenses;
    const rate     = income > 0 ? Math.round((net / income) * 100) : 0;
    return { income, expenses, moved, net, rate };
  }, [filtered]);

  // Detect when a credit card is the active filter
  const filteredAccount = accountFilter !== "all"
    ? accounts.find(a => a.id === accountFilter)
    : null;
  const isCreditCardView = filteredAccount?.type === "credit";

  // ── CATEGORY BREAKDOWN ────────────────────────────────────────
  const categoryData = useMemo(() => {
    const map: Record<string, number> = {};
    filtered.filter(t => t.type === "expense").forEach(t => {
      map[t.category] = (map[t.category] || 0) + t.amount;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({
        name,
        value,
        color: CATEGORY_COLORS[name] || "#9AA5B4",
        emoji: getCategoryEmoji(name),
      }));
  }, [filtered]);

  // ── MONTHLY TREND ─────────────────────────────────────────────
  const trendData = useMemo(() => {
    const months: Record<string, { month: string; income: number; expenses: number }> = {};
    filtered.forEach(t => {
      if (!t.month) return;
      if (!months[t.month]) months[t.month] = { month: t.month, income: 0, expenses: 0 };
      if (t.type === "income" || t.type === "refund") months[t.month].income += t.amount;
      if (t.type === "expense") months[t.month].expenses += t.amount;
    });
    return Object.values(months).sort((a, b) => a.month.localeCompare(b.month));
  }, [filtered]);

  // ── CASH FLOW STATS (syncs with filters + date preset) ──────────
  const cashFlowStats = useMemo(() => {
    let periodMonths = 1;
    let periodLabel = "";
    let isAverage = false;

    if (datePreset === "month") {
      const now = new Date();
      periodLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      periodMonths = 1;
      isAverage = false;
    } else if (datePreset === "last") {
      const prev = new Date();
      prev.setMonth(prev.getMonth() - 1);
      periodLabel = prev.toLocaleDateString("en-US", { month: "long", year: "numeric" });
      periodMonths = 1;
      isAverage = false;
    } else if (datePreset === "3m") {
      periodLabel = "last 3 months";
      periodMonths = 3;
      isAverage = true;
    } else if (datePreset === "6m") {
      periodLabel = "last 6 months";
      periodMonths = 6;
      isAverage = true;
    } else if (datePreset === "all" || (!dateFrom && !dateTo)) {
      const months = new Set(filtered.map(t => t.month || t.date?.slice(0, 7) || ""));
      months.delete("");
      periodMonths = Math.max(1, months.size);
      periodLabel = "all imported data";
      isAverage = true;
    } else {
      const from = dateFrom ? new Date(dateFrom) : null;
      const to = dateTo ? new Date(dateTo) : null;
      if (from && to) {
        const diffMs = to.getTime() - from.getTime();
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        if (diffDays <= 35) {
          periodMonths = 1;
          periodLabel = `${dateFrom} → ${dateTo}`;
          isAverage = false;
        } else {
          periodMonths = Math.max(1, Math.round(diffDays / 30));
          periodLabel = `${dateFrom} → ${dateTo}`;
          isAverage = true;
        }
      } else {
        periodMonths = 1;
        periodLabel = dateFrom || dateTo || "selected period";
        isAverage = false;
      }
    }

    const totalIncome = filtered
      .filter(t => t.type === "income" || t.type === "refund")
      .reduce((s, t) => s + t.amount, 0);

    const totalExpenses = filtered
      .filter(t => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);

    const monthlyIncome = totalIncome / periodMonths;
    const monthlyExpenses = totalExpenses / periodMonths;
    const monthlyNet = monthlyIncome - monthlyExpenses;
    const savingsRate =
      monthlyIncome > 0 ? Math.round((monthlyNet / monthlyIncome) * 100) : 0;

    const byPerson = members.map(m => {
      const mTxns = filtered.filter(t => t.assignedTo === m.uid);
      const inc =
        mTxns
          .filter(t => t.type === "income" || t.type === "refund")
          .reduce((s, t) => s + t.amount, 0) / periodMonths;
      const exp =
        mTxns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0) /
        periodMonths;
      return {
        uid: m.uid,
        name: m.firstName || m.displayName || "Member",
        income: inc,
        expenses: exp,
        net: inc - exp,
      };
    });

    const jointTxns = filtered.filter(t => t.assignedTo === "joint");
    const jointInc =
      jointTxns
        .filter(t => t.type === "income" || t.type === "refund")
        .reduce((s, t) => s + t.amount, 0) / periodMonths;
    const jointExp =
      jointTxns.filter(t => t.type === "expense").reduce((s, t) => s + t.amount, 0) /
      periodMonths;
    if (jointInc > 0 || jointExp > 0) {
      byPerson.push({
        uid: "joint",
        name: "Joint",
        income: jointInc,
        expenses: jointExp,
        net: jointInc - jointExp,
      });
    }

    return {
      monthlyIncome,
      monthlyExpenses,
      monthlyNet,
      savingsRate,
      periodLabel,
      periodMonths,
      isAverage,
      byPerson,
    };
  }, [filtered, datePreset, dateFrom, dateTo, members]);

  // ── SUBCATS for selected category ────────────────────────────
  const availableSubcats = categoryFilter !== "all"
    ? (subcatsByParent[categoryFilter] ?? [])
    : [];

  // ── CREDIT CARDS ────────────────────────────────────────────
  const creditCards = useMemo(
    () => accounts.filter(a => a.type === "credit"),
    [accounts],
  );
  const otherAccounts = useMemo(
    () => accounts.filter(a => a.type !== "credit"),
    [accounts],
  );
  const docsByAccountId = useMemo(() => {
    const map: Record<string, typeof documents> = {};
    for (const d of documents) {
      const key = d.accountDocId || "";
      if (!key) continue;
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) =>
        (b.statementEnd || "").localeCompare(a.statementEnd || "")
      );
    }
    return map;
  }, [documents]);
  const cardStats = useMemo(() => {
    return creditCards.map(card => {
      const cardTxns = transactions.filter(t => t.accountId === card.id);
      const cardDocs = docsByAccountId[card.id] ?? [];
      const latestDoc = cardDocs[0] ?? null;

      const stmtStart   = latestDoc?.statementStart ?? "";
      const stmtEnd     = latestDoc?.statementEnd   ?? "";
      const stmtOpening = Number(latestDoc?.openingBalance ?? 0);
      const stmtClosing = Number(latestDoc?.closingBalance ?? 0);

      // ── SOURCE A: Statement accounting (always reconciles) ────────
      const stmtTxns = stmtStart && stmtEnd
        ? cardTxns.filter(t => t.date >= stmtStart && t.date <= stmtEnd)
        : cardTxns;

      const stmtPaid     = stmtTxns
        .filter(t => t.direction === "credit" && t.type === "transfer")
        .reduce((s, t) => s + t.amount, 0);
      const stmtRefunded = stmtTxns
        .filter(t => t.direction === "credit" && t.type === "refund")
        .reduce((s, t) => s + t.amount, 0);

      // Derive charged from accounting identity — always matches statement
      // closing = opening + charged - paid - refunded
      // → charged = closing - opening + paid + refunded
      const stmtCharged = stmtClosing > 0 || stmtOpening > 0
        ? Math.max(0, stmtClosing - stmtOpening + stmtPaid + stmtRefunded)
        : stmtTxns
            .filter(t => t.direction === "debit" && t.type === "expense")
            .reduce((s, t) => s + t.amount, 0);

      // Genuinely new transactions after statement close
      const newTxns = stmtEnd
        ? cardTxns.filter(t => t.date > stmtEnd)
        : [];
      const newCharged  = newTxns
        .filter(t => t.type === "expense")
        .reduce((s, t) => s + t.amount, 0);
      const newPaid     = newTxns
        .filter(t => t.direction === "credit" && t.type === "transfer")
        .reduce((s, t) => s + t.amount, 0);
      const newRefunded = newTxns
        .filter(t => t.direction === "credit" && t.type === "refund")
        .reduce((s, t) => s + t.amount, 0);

      // Manually-added transactions within the statement period
      const manualStmtTxns = stmtStart && stmtEnd
        ? cardTxns.filter(t =>
            t.addedManually &&
            t.date >= stmtStart &&
            t.date <= stmtEnd
          )
        : [];
      const manualCharged = manualStmtTxns
        .filter(t => t.type === "expense")
        .reduce((s, t) => s + t.amount, 0);
      const manualPaid    = manualStmtTxns
        .filter(t => t.direction === "credit" && t.type === "transfer")
        .reduce((s, t) => s + t.amount, 0);

      // Estimated current balance:
      //   statement closing (authoritative)
      //   + manual entries user tracked within the period
      //   + genuinely new charges after statement close
      const estimatedBalance = Math.max(
        0,
        stmtClosing + manualCharged - manualPaid + newCharged - newPaid - newRefunded,
      );

      // What to display as "Charged" — statement + manual entries
      const displayCharged = stmtCharged + manualCharged;

      const creditLimit  = Number(card.creditLimit ?? 0);
      const available    = Math.max(0, creditLimit - estimatedBalance);
      const utilization  = creditLimit > 0
        ? Math.round((estimatedBalance / creditLimit) * 100)
        : 0;

      const paidInFull = stmtOpening > 0
        ? stmtPaid >= stmtOpening
        : stmtPaid >= stmtClosing && stmtPaid > 0;

      const dueDate      = String((card as Record<string, unknown>).dueDate ?? "");
      const daysUntilDue = daysUntil(dueDate);
      const recent       = [...cardTxns].slice(0, 6);

      return {
        card,
        latestDoc,
        stmtStart, stmtEnd,
        stmtOpening, stmtClosing,
        stmtCharged, stmtPaid, stmtRefunded,
        newTxns, newCharged, newPaid, newRefunded,
        displayCharged, manualCharged,
        estimatedBalance, creditLimit, available, utilization,
        paidInFull, dueDate, daysUntilDue,
        recent,
      };
    });
  }, [creditCards, transactions, docsByAccountId]);

  // Effective credit stats: when accountFilter is a credit card, show that card only
  const effectiveCardStats = useMemo(() => {
    if (accountFilter === "all") return cardStats;
    const isCredit = creditCards.some(c => c.id === accountFilter);
    if (!isCredit) return [];
    return cardStats.filter(s => s.card.id === accountFilter);
  }, [cardStats, accountFilter, creditCards]);

  // Credit-card-specific KPIs (only used when isCreditCardView is true)
  const creditKpis = useMemo(() => {
    if (!isCreditCardView) return null;

    // expenses are always debits on a credit card — treat missing direction as debit
    const charges  = filtered
      .filter(t => t.type === "expense")
      .reduce((s, t) => s + t.amount, 0);

    const payments = filtered
      .filter(t => t.type === "transfer" && t.direction === "credit")
      .reduce((s, t) => s + t.amount, 0);

    const refunds  = filtered
      .filter(t => t.type === "refund" && t.direction === "credit")
      .reduce((s, t) => s + t.amount, 0);

    const netChange = charges - payments - refunds;

    const stats       = cardStats.find(c => c.card.id === accountFilter);
    const utilization = stats?.utilization ?? 0;
    const available   = stats?.available   ?? 0;
    const creditLimit = stats?.creditLimit ?? 0;

    const stmtBalance = stats?.stmtClosing ?? 0;
    const stmtCharged = stats?.stmtCharged ?? 0;
    const stmtPaid    = stats?.stmtPaid    ?? 0;

    return {
      charges, payments, refunds, netChange,
      utilization, available, creditLimit,
      stmtBalance, stmtCharged, stmtPaid,
    };
  }, [isCreditCardView, filtered, cardStats, accountFilter]);

  const totalOwed = effectiveCardStats.reduce((s, c) => s + c.estimatedBalance, 0);
  const totalLimit = effectiveCardStats.reduce((s, c) => s + c.creditLimit, 0);
  const overallUtil = totalLimit > 0 ? Math.round((totalOwed / totalLimit) * 100) : 0;

  // ── DEBT SUMMARY (when viewing all accounts) ────────────────────
  const debtSummary = useMemo(() => {
    if (accountFilter !== "all") return null;
    const creditCardBalances = cardStats.map(s => ({
      id: s.card.id,
      nickname: s.card.nickname,
      balance: s.estimatedBalance,
      creditLimit: s.creditLimit,
      color: s.card.color ?? "#9AA5B4",
    }));
    const creditCardTotal = creditCardBalances.reduce((s, c) => s + c.balance, 0);
    const totalCreditLimit = creditCardBalances.reduce((s, c) => s + c.creditLimit, 0);
    const studentLoanBalance = hasStudentLoans ? debtAnswersStudentBalance : 0;
    const otherLoansBalance = 0;
    const totalDebt = creditCardTotal + studentLoanBalance + otherLoansBalance;

    let priorStmtTotal = 0;
    for (const card of creditCards) {
      const docs = docsByAccountId[card.id] ?? [];
      const priorDoc = docs[1];
      if (priorDoc?.closingBalance != null) {
        priorStmtTotal += Number(priorDoc.closingBalance);
      }
    }
    const debtChange = priorStmtTotal > 0 ? totalDebt - priorStmtTotal : null;

    return {
      creditCardBalances,
      creditCardTotal,
      totalCreditLimit,
      studentLoanBalance,
      otherLoansBalance,
      totalDebt,
      debtChange,
      priorStmtTotal,
    };
  }, [accountFilter, cardStats, creditCards, docsByAccountId, hasStudentLoans, debtAnswersStudentBalance]);

  // ── ACCOUNT BALANCE CARD ───────────────────────────────────────
  // Shows when a single non-credit account is filtered
  const isNonCreditAccountView = Boolean(
    filteredAccount && filteredAccount.type !== "credit"
  );

  const accountBalanceStats = useMemo(() => {
    if (!filteredAccount || filteredAccount.type === "credit") return null;

    const accTxns = transactions.filter(t => t.accountId === filteredAccount.id);

    const totalCredits = accTxns
      .filter(t => t.direction === "credit")
      .reduce((s, t) => s + t.amount, 0);

    const totalDebits = accTxns
      .filter(t => t.direction === "debit")
      .reduce((s, t) => s + t.amount, 0);

    const runningBalance = totalCredits - totalDebits;

    const sorted = [...accTxns].sort((a, b) =>
      b.date.localeCompare(a.date)
    );
    const lastTx = sorted[0] ?? null;

    const accDocs = (docsByAccountId[filteredAccount.id] ?? [])
      .slice()
      .sort((a, b) =>
        (b.statementEnd || "").localeCompare(a.statementEnd || "")
      );
    const latestDoc = accDocs[0] ?? null;

    const filteredCredits = filtered
      .filter(t => t.direction === "credit")
      .reduce((s, t) => s + t.amount, 0);
    const filteredDebits = filtered
      .filter(t => t.direction === "debit")
      .reduce((s, t) => s + t.amount, 0);

    return {
      account: filteredAccount,
      runningBalance,
      totalCredits,
      totalDebits,
      txCount: accTxns.length,
      lastTx,
      latestDoc,
      filteredCredits,
      filteredDebits,
    };
  }, [filteredAccount, transactions, filtered, docsByAccountId]);

  // ── LIQUID SAVINGS (for BS1 & Emergency fund) ─────────────────────
  // Savings accounts only — balance = money remaining after expenses
  // Primary: statement closingBalance; fallback: derive from transactions (credits − debits)
  const savingsAccounts = accounts.filter(a => a.type === "savings");
  const liquidSavingsByAccount = useMemo(() => {
    return savingsAccounts.map(a => {
      const docs = docsByAccountId[a.id] ?? [];
      const latest = docs[0];
      let balance: number;
      if (latest?.closingBalance != null) {
        balance = Number(latest.closingBalance);
      } else {
        // Fallback when no statement: compute from transactions (money in − money out)
        const acctTxns = transactions.filter(t => t.accountId === a.id);
        const credits = acctTxns.filter(t => t.direction === "credit").reduce((s, t) => s + t.amount, 0);
        const debits = acctTxns.filter(t => t.direction === "debit").reduce((s, t) => s + t.amount, 0);
        balance = credits - debits;
      }
      return { id: a.id, nickname: a.nickname, balance };
    });
  }, [savingsAccounts, docsByAccountId, transactions]);
  const totalLiquidSavings = liquidSavingsByAccount.reduce((s, a) => s + a.balance, 0);

  const [dueDateError, setDueDateError] = useState<string | null>(null);

  async function saveDueDate(cardId: string, dateStr: string) {
    if (!householdId) return;
    setDueDateError(null);
    setSavingDueDate(p => ({ ...p, [cardId]: true }));
    try {
      await updateDoc(
        doc(db, "households", householdId, "accounts", cardId),
        { dueDate: dateStr },
      );
      setEditingDueDate(p => { const n = { ...p }; delete n[cardId]; return n; });
    } catch (err) {
      setDueDateError(err instanceof Error ? err.message : "Failed to save due date");
    } finally {
      setSavingDueDate(p => ({ ...p, [cardId]: false }));
    }
  }

  // Close filter dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      const bar = document.getElementById("filter-bar-root");
      if (bar && !bar.contains(e.target as Node)) {
        setOpenFilter(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // ── LOANS (households/{id}/loans) ─────────────────────────────────
  const sortedLoans = [...loans].sort((a, b) => {
    if (loanSortMode === "snowball") return a.balance - b.balance;
    if (loanSortMode === "avalanche") return b.rate - a.rate;
    return a.type.localeCompare(b.type);
  });
  const _totalDebt = loans.reduce((s, l) => s + l.balance, 0);
  const totalMinPayment = loans.reduce((s, l) => s + l.minimumPayment, 0);
  const debtByType = loans.reduce((acc, l) => {
    acc[l.type] = (acc[l.type] || 0) + l.balance;
    return acc;
  }, {} as Record<string, number>);

  async function saveLoan(loanId: string | null, data: Partial<LoanDraft>) {
    if (!householdId) return;
    setSavingLoan(true);
    try {
      const { addDoc, updateDoc, doc: fsDoc, collection: fsCol, serverTimestamp } = await import("firebase/firestore");
      const payload = {
        ...data,
        balance:        Number(data.balance ?? 0),
        rate:           Number(data.rate ?? 0),
        minimumPayment: Number(data.minimumPayment ?? 0),
        active:         true,
        householdId,
        updatedAt:      serverTimestamp(),
      };
      if (loanId) {
        await updateDoc(fsDoc(db, "households", householdId, "loans", loanId), payload);
      } else {
        await addDoc(fsCol(db, "households", householdId, "loans"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setEditingLoanId(null);
      setLoanDraft({});
      setShowAddLoan(false);
    } finally {
      setSavingLoan(false);
    }
  }

  async function deleteLoan(loanId: string) {
    if (!householdId) return;
    if (!window.confirm("Delete this loan?")) return;
    const { deleteDoc, doc: fsDoc } = await import("firebase/firestore");
    await deleteDoc(fsDoc(db, "households", householdId, "loans", loanId));
  }

  // Debt Tracker: payments by loan (transactions with matching Debt subcat)
  const loanPaymentsByLoanId = useMemo(() => {
    const map: Record<string, Tx[]> = {};
    for (const loan of loans) {
      const subcat = getSubcatForLoan(loan, debtSubcatNames);
      map[loan.id] = filtered.filter(
        (t) =>
          t.category === "Debt" &&
          t.subcat === subcat &&
          (t.type === "expense" || t.type === "transfer") &&
          t.direction === "debit" &&
          t.amount > 0,
      );
    }
    return map;
  }, [loans, filtered, debtSubcatNames]);

  const _availableLoanPayments = useMemo(() => {
    const associated = new Set(
      Object.values(loanPaymentsByLoanId).flatMap((p) => p.map((t) => t.id)),
    );
    return filtered
      .filter((t) => {
        if (associated.has(t.id)) return false;
        if (t.category !== "Debt") return false;
        if (t.type !== "expense" && t.type !== "transfer") return false;
        if (t.direction !== "debit") return false;
        if (t.amount === 0) return false;
        return true;
      })
      .slice(0, 30);
  }, [filtered, loanPaymentsByLoanId]);

  const [dragOverLoanId, setDragOverLoanId] = useState<string | null>(null);
  const [expandedLoanIds, setExpandedLoanIds] = useState<Set<string>>(new Set());
  const hasAutoExpandedLoans = useRef(false);

  // Expand all loans when they first load
  useEffect(() => {
    if (loans.length > 0 && !hasAutoExpandedLoans.current) {
      hasAutoExpandedLoans.current = true;
      setExpandedLoanIds(new Set(loans.map((l) => l.id)));
    }
  }, [loans]);

  const toggleLoanExpanded = (loanId: string) => {
    setExpandedLoanIds((prev) => {
      const next = new Set(prev);
      if (next.has(loanId)) next.delete(loanId);
      else next.add(loanId);
      return next;
    });
  };

  // Consolidated household debt = credit cards (owed) + loans (remaining to pay)
  const consolidatedHouseholdDebt = useMemo(() => {
    // Credit cards: current balance owed (what's missing to be paid)
    const creditCardsOwed = debtSummary?.creditCardTotal ?? 0;

    // Loans: remaining to pay = balance minus associated payments
    const loansRemaining = loans.reduce((s, l) => {
      const payments = loanPaymentsByLoanId[l.id] ?? [];
      const paid = payments.reduce((p, t) => p + t.amount, 0);
      return s + Math.max(0, l.balance - paid);
    }, 0);

    const total = creditCardsOwed + loansRemaining;
    console.log("[Household Debt breakdown — what's missing to be paid]", {
      creditCardsOwed,
      loansRemaining,
      consolidated: total,
    });
    return total;
  }, [loans, loanPaymentsByLoanId, debtSummary]);

  // Pastel colors for debt pie (soften hex)
  const pastelize = (hex: string, mix = 0.65) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const R = Math.round(r + (255 - r) * mix);
    const G = Math.round(g + (255 - g) * mix);
    const B = Math.round(b + (255 - b) * mix);
    return `#${R.toString(16).padStart(2, "0")}${G.toString(16).padStart(2, "0")}${B.toString(16).padStart(2, "0")}`;
  };

  // Debt pie data: credit cards + loans (for wheel chart)
  const debtPieData = useMemo(() => {
    if (accountFilter !== "all") return [];
    const segments: { name: string; value: number; color: string; type: "credit" | "loan"; id: string; rate?: number; sortType?: string }[] = [];
    // Credit cards with balance > 0
    debtSummary?.creditCardBalances?.forEach((c) => {
      if (c.balance > 0) {
        segments.push({
          name: c.nickname,
          value: c.balance,
          color: pastelize(c.color ?? "#9AA5B4", 0.5),
          type: "credit",
          id: c.id,
          rate: 22, // default APR for avalanche sort
          sortType: "credit",
        });
      }
    });
    // Loans with remaining balance > 0
    loans.forEach((loan) => {
      const payments = loanPaymentsByLoanId[loan.id] ?? [];
      const paid = payments.reduce((p, t) => p + t.amount, 0);
      const remaining = Math.max(0, loan.balance - paid);
      if (remaining > 0) {
        const color = LOAN_TYPE_COLORS[loan.type] || "#9AA5B4";
        segments.push({
          name: loan.name,
          value: remaining,
          color: pastelize(color, 0.5),
          type: "loan",
          id: loan.id,
          rate: loan.rate ?? 0,
          sortType: loan.type,
        });
      }
    });
    return segments;
  }, [accountFilter, debtSummary, loans, loanPaymentsByLoanId]);

  // Order of payment (Snowball / Avalanche / Type) — for display when no segment selected
  const paymentOrder = useMemo(() => {
    const items = [...debtPieData];
    if (loanSortMode === "snowball") {
      return items.sort((a, b) => a.value - b.value);
    }
    if (loanSortMode === "avalanche") {
      return items.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
    }
    // Type: credit first, then loans by type
    return items.sort((a, b) => {
      if (a.type === "credit" && b.type !== "credit") return -1;
      if (a.type !== "credit" && b.type === "credit") return 1;
      return (a.sortType ?? "").localeCompare(b.sortType ?? "");
    });
  }, [debtPieData, loanSortMode]);

  async function handleAssociatePaymentWithLoan(txId: string, loanId: string) {
    const loan = loans.find((l) => l.id === loanId);
    if (!loan || !householdId) return;
    await updateDoc(doc(db, "households", householdId, "transactions", txId), {
      category: "Debt",
      subcat: getSubcatForLoan(loan, debtSubcatNames),
    });
  }

  async function handleDisassociatePaymentFromLoan(txId: string) {
    if (!householdId) return;
    await updateDoc(doc(db, "households", householdId, "transactions", txId), {
      subcat: "",
    });
  }

  if (authLoading) return (
    <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col overflow-hidden">

        {/* ── KPI STRIP ─────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[#E8ECF0] bg-white px-6 py-5">
          

          {/* ── FILTER BAR ──────────────────────────────────────── */}
          <div id="filter-bar-root" className="sticky top-14 z-30 border-[#E4E8F0] bg-white">
            {/* Pill row — always visible */}
            <div className="mx-auto flex max-w-7xl items-center justify-center gap-2 px-10 py-2.5">
              {/* Active filter count badge */}
              {(() => {
                const count = [
                  accountFilter !== "all",
                  personFilter !== "all",
                  categoryFilter !== "all",
                  typeFilter !== "all",
                  docFilter !== "all",
                  Boolean(search),
                  datePreset !== "month" || Boolean(dateFrom) || Boolean(dateTo),
                ].filter(Boolean).length;
                return count > 0 ? (
                  <span className="shrink-0 rounded-full bg-[#C9A84C] px-2.5 py-1 text-[11px] font-bold text-[#1B2A4A]">
                    {count}
                  </span>
                ) : null;
              })()}

              {/* Account pill */}
              {(() => {
                const acc = accounts.find(a => a.id === accountFilter);
                const label = acc ? acc.nickname : "Account";
                const isActive = accountFilter !== "all";
                return (
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "account" ? null : "account")}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      isActive || openFilter === "account"
                        ? {
                            backgroundColor: acc?.color ?? "#1B2A4A",
                            borderColor: acc?.color ?? "#1B2A4A",
                            color: "#fff",
                          }
                        : {
                            backgroundColor: "var(--color-background-secondary, #F4F6FA)",
                            borderColor: "#E4E8F0",
                            color: "#1B2A4A",
                          }
                    }
                  >
                    {isActive && acc && (
                      <span className="h-2 w-2 rounded-full bg-white/40" />
                    )}
                    {label}
                    <span className="text-[10px] opacity-60">▾</span>
                  </button>
                );
              })()}

              {/* People pill */}
              {(() => {
                const m = members.find(x => x.uid === personFilter);
                const label = m ? m.firstName || m.displayName || "Member" : "People";
                const isActive = personFilter !== "all";
                return (
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "people" ? null : "people")}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      isActive || openFilter === "people"
                        ? {
                            backgroundColor: "#1B2A4A",
                            borderColor: "#1B2A4A",
                            color: "#fff",
                          }
                        : {
                            backgroundColor: "var(--color-background-secondary, #F4F6FA)",
                            borderColor: "#E4E8F0",
                            color: "#1B2A4A",
                          }
                    }
                  >
                    {label}
                    <span className="text-[10px] opacity-60">▾</span>
                  </button>
                );
              })()}

              {/* Category pill */}
              {(() => {
                const label =
                  categoryFilter !== "all"
                    ? subcatFilter !== "all"
                      ? `${categoryFilter} › ${subcatFilter}`
                      : categoryFilter
                    : "Category";
                const isActive = categoryFilter !== "all";
                return (
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "category" ? null : "category")}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      isActive || openFilter === "category"
                        ? {
                            backgroundColor: "#C9A84C",
                            borderColor: "#C9A84C",
                            color: "#1B2A4A",
                          }
                        : {
                            backgroundColor: "var(--color-background-secondary, #F4F6FA)",
                            borderColor: "#E4E8F0",
                            color: "#1B2A4A",
                          }
                    }
                  >
                    {label}
                    <span className="text-[10px] opacity-60">▾</span>
                  </button>
                );
              })()}

              {/* Date pill */}
              {(() => {
                const label =
                  dateFrom || dateTo
                    ? `${dateFrom || "?"} — ${dateTo || "?"}`
                    : datePreset === "month"
                      ? "This month"
                      : datePreset === "last"
                        ? "Last month"
                        : datePreset === "3m"
                          ? "3 months"
                          : datePreset === "6m"
                            ? "6 months"
                            : datePreset === "all"
                              ? "All time"
                              : "Date";
                const isActive =
                  datePreset !== "month" || Boolean(dateFrom) || Boolean(dateTo);
                return (
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "date" ? null : "date")}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      isActive || openFilter === "date"
                        ? {
                            backgroundColor: "#1B2A4A",
                            borderColor: "#1B2A4A",
                            color: "#fff",
                          }
                        : {
                            backgroundColor: "var(--color-background-secondary, #F4F6FA)",
                            borderColor: "#E4E8F0",
                            color: "#1B2A4A",
                          }
                    }
                  >
                    {label}
                    <span className="text-[10px] opacity-60">▾</span>
                  </button>
                );
              })()}

              {/* More pill (statement + type) */}
              {(() => {
                const isActive = typeFilter !== "all" || docFilter !== "all";
                const label = isActive
                  ? [typeFilter !== "all" && typeFilter, docFilter !== "all" && "stmt"]
                      .filter(Boolean)
                      .join(", ")
                  : "More";
                return (
                  <button
                    type="button"
                    onClick={() => setOpenFilter(openFilter === "more" ? null : "more")}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                    style={
                      isActive || openFilter === "more"
                        ? {
                            backgroundColor: "#1B2A4A",
                            borderColor: "#1B2A4A",
                            color: "#fff",
                          }
                        : {
                            backgroundColor: "var(--color-background-secondary, #F4F6FA)",
                            borderColor: "#E4E8F0",
                            color: "#1B2A4A",
                          }
                    }
                  >
                    {label}
                    <span className="text-[10px] opacity-60">▾</span>
                  </button>
                );
              })()}

              {/* Search */}
              <div className="relative min-w-0 max-w-xs flex-1">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">
                  ⌕
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search transactions..."
                  className="h-8 w-full rounded-full border border-[#E4E8F0] bg-[#F9FAFC] pl-7 pr-3 text-xs focus:border-[#C9A84C] focus:outline-none"
                />
              </div>

              {/* Clear all */}
              {(accountFilter !== "all" ||
                personFilter !== "all" ||
                categoryFilter !== "all" ||
                subcatFilter !== "all" ||
                typeFilter !== "all" ||
                docFilter !== "all" ||
                datePreset !== "month" ||
                dateFrom ||
                dateTo ||
                search) && (
                <button
                  type="button"
                  onClick={() => {
                    setAccountFilter("all");
                    setPersonFilter("all");
                    setCategoryFilter("all");
                    setSubcatFilter("all");
                    setTypeFilter("all");
                    setDocFilter("all");
                    setDateFrom("");
                    setDateTo("");
                    setSearch("");
                    applyPreset("month");
                    setOpenFilter(null);
                  }}
                  className="shrink-0 rounded-full border border-red-100 bg-red-50 px-3 py-1.5 text-[11px] font-semibold text-red-500 hover:bg-red-100"
                >
                  ✕ Clear
                </button>
              )}
            </div>

            {/* Expanded panel — slides open below pill row */}
            {openFilter && (
              <div className="border-t border-[#F4F6FA] bg-white px-4 pb-3 pt-2.5">
                <div className="mx-auto max-w-7xl">
                  {/* ACCOUNT panel */}
                  {openFilter === "account" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-[#9AA5B4]">
                          Credit cards
                        </span>
                        {accounts.filter(a => a.type === "credit").map(acc => (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => {
                              setAccountFilter(acc.id);
                              setOpenFilter(null);
                            }}
                            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                            style={
                              accountFilter === acc.id
                                ? {
                                    backgroundColor: acc.color,
                                    borderColor: acc.color,
                                    color: "#fff",
                                  }
                                : {
                                    borderColor: "#E4E8F0",
                                    backgroundColor: "#F9FAFC",
                                    color: "#1B2A4A",
                                  }
                            }
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: acc.color }}
                            />
                            {acc.nickname}
                          </button>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="mr-1 text-[10px] font-bold uppercase tracking-wide text-[#9AA5B4]">
                          Accounts
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setAccountFilter("all");
                            setOpenFilter(null);
                          }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            accountFilter === "all"
                              ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                              : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                          }`}
                        >
                          All
                        </button>
                        {accounts.filter(a => a.type !== "credit").map(acc => (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => {
                              setAccountFilter(acc.id);
                              setOpenFilter(null);
                            }}
                            className="flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition"
                            style={
                              accountFilter === acc.id
                                ? {
                                    backgroundColor: acc.color,
                                    borderColor: acc.color,
                                    color: "#fff",
                                  }
                                : {
                                    borderColor: "#E4E8F0",
                                    backgroundColor: "#F9FAFC",
                                    color: "#1B2A4A",
                                  }
                            }
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: acc.color }}
                            />
                            {acc.nickname}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* PEOPLE panel */}
                  {openFilter === "people" && (
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setPersonFilter("all");
                          setOpenFilter(null);
                        }}
                        className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          personFilter === "all"
                            ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                            : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                        }`}
                      >
                        Everyone
                      </button>
                      {members.map(m => (
                        <button
                          key={m.uid}
                          type="button"
                          onClick={() => {
                            setPersonFilter(m.uid);
                            setOpenFilter(null);
                          }}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            personFilter === m.uid
                              ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                              : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                          }`}
                        >
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C9A84C] text-[9px] font-bold text-[#1B2A4A]">
                            {(m.firstName || m.displayName || "?").charAt(0)}
                          </span>
                          {m.firstName || m.displayName}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* CATEGORY panel */}
                  {openFilter === "category" && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setCategoryFilter("all");
                            setSubcatFilter("all");
                            setOpenFilter(null);
                          }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            categoryFilter === "all"
                              ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                              : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                          }`}
                        >
                          All
                        </button>
                        {CATEGORIES.map(cat => (
                          <button
                            key={cat.name}
                            type="button"
                            onClick={() => {
                              setCategoryFilter(
                                categoryFilter === cat.name ? "all" : cat.name,
                              );
                              setSubcatFilter("all");
                            }}
                            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                              categoryFilter === cat.name
                                ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                                : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                            }`}
                          >
                            {cat.emoji} {cat.name}
                          </button>
                        ))}
                      </div>
                      {categoryFilter !== "all" &&
                        (subcatsByParent[categoryFilter] ?? []).length > 0 && (
                          <div className="flex flex-wrap gap-1.5 border-l-2 border-[#C9A84C]/30 pl-2">
                            <button
                              type="button"
                              onClick={() => {
                                setSubcatFilter("all");
                                setOpenFilter(null);
                              }}
                              className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                                subcatFilter === "all"
                                  ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                                  : "border-[#E4E8F0] bg-[#F9FAFC] text-[#9AA5B4]"
                              }`}
                            >
                              All
                            </button>
                            {(subcatsByParent[categoryFilter] ?? []).map(sub => (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() => {
                                  setSubcatFilter(sub.name);
                                  setOpenFilter(null);
                                }}
                                className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold transition ${
                                  subcatFilter === sub.name
                                    ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                                    : "border-[#E4E8F0] bg-[#F9FAFC] text-[#9AA5B4]"
                                }`}
                              >
                                {sub.name}
                              </button>
                            ))}
                          </div>
                        )}
                    </div>
                  )}

                  {/* DATE panel */}
                  {openFilter === "date" && (
                    <div className="flex flex-wrap items-center gap-2">
                      {(["month", "last", "3m", "6m", "all"] as const).map(preset => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => {
                            applyPreset(preset);
                            setOpenFilter(null);
                          }}
                          className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                            datePreset === preset && !dateFrom && !dateTo
                              ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                              : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                          }`}
                        >
                          {preset === "month"
                            ? "This month"
                            : preset === "last"
                              ? "Last month"
                              : preset === "3m"
                                ? "3 months"
                                : preset === "6m"
                                  ? "6 months"
                                  : "All time"}
                        </button>
                      ))}
                      <span className="text-xs text-[#9AA5B4]">or</span>
                      <input
                        type="date"
                        value={dateFrom}
                        onChange={e => {
                          setDateFrom(e.target.value);
                          setDatePreset("");
                        }}
                        className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                      />
                      <span className="text-xs text-[#9AA5B4]">—</span>
                      <input
                        type="date"
                        value={dateTo}
                        onChange={e => {
                          setDateTo(e.target.value);
                          setDatePreset("");
                        }}
                        className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                      />
                    </div>
                  )}

                  {/* MORE panel (statement + type) */}
                  {openFilter === "more" && (
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[#9AA5B4]">
                          Statement
                        </span>
                        <select
                          value={docFilter}
                          onChange={e => setDocFilter(e.target.value)}
                          className="h-8 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                        >
                          <option value="all">All statements</option>
                          {documents
                            .slice()
                            .sort((a, b) =>
                              (b.statementEnd || "").localeCompare(a.statementEnd || ""),
                            )
                            .map(d => (
                              <option key={d.id} value={d.id}>
                                {(d.fileName ?? d.id)
                                  .replace("-parsed.json", "")
                                  .replace(".json", "")}
                              </option>
                            ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[#9AA5B4]">
                          Type
                        </span>
                        <div className="flex gap-1">
                          {(
                            [
                              "all",
                              "income",
                              "expense",
                              "transfer",
                              "refund",
                            ] as const
                          ).map(t => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setTypeFilter(t)}
                              className={`rounded-full border px-3 py-1.5 text-xs font-semibold capitalize ${
                                typeFilter === t
                                  ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                                  : "border-[#E4E8F0] bg-[#F9FAFC] text-[#1B2A4A]"
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── TABS ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[#E8ECF0] bg-white px-6">
          <div className="flex justify-center gap-6">
            {([
              ["overview",      "Overview"],
              ["categories",    "Categories"],
              ["transactions",  "Transactions"],
              ["trends",        "Trends"],
            ] as [DashTab, string][]).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`border-b-2 pb-3 pt-3 text-sm font-semibold transition ${
                  activeTab === tab
                    ? "border-[#C9A84C] text-[#1B2A4A]"
                    : "border-transparent text-[#9AA5B4] hover:text-[#1B2A4A]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── TAB CONTENT ──────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8">

          {/* ── OVERVIEW TAB ──────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-8">

              {/* ── CASH FLOW: Are we living within our means? ─────────────── */}
              {accountFilter === "all" && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-sm">
                  <h3 className="mb-4 text-sm font-bold text-[#1B2A4A]">
                    Cash Flow — &ldquo;Are we living within our means?&rdquo;
                  </h3>
                  <p className="mb-4 text-xs text-[#9AA5B4]">
                    {cashFlowStats.isAverage
                      ? `Monthly average · ${cashFlowStats.periodLabel}${
                          cashFlowStats.periodMonths > 1
                            ? ` (${cashFlowStats.periodMonths} months)`
                            : ""
                        }`
                      : cashFlowStats.periodLabel}
                    {personFilter !== "all" && (
                      <span className="ml-2 font-semibold text-[#C9A84C]">
                        ·{" "}
                        {members.find(m => m.uid === personFilter)?.firstName ?? "filtered"}
                      </span>
                    )}
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-green-100 bg-green-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">
                        Combined income
                      </p>
                      <p className="mt-1 text-2xl font-bold text-green-700">
                        {fmtFull(cashFlowStats.monthlyIncome)}
                        {cashFlowStats.isAverage && (
                          <span className="ml-1 text-base font-normal opacity-60">/mo</span>
                        )}
                      </p>
                      <p className="mt-1 text-[10px] text-[#9AA5B4]">
                        {[
                          ...cashFlowStats.byPerson
                            .filter(p => p.income > 0)
                            .map(p => `${p.name} ${fmtFull(p.income)}`),
                        ].filter(Boolean).join(" + ") || "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                        Expenses
                      </p>
                      <p className="mt-1 text-2xl font-bold text-red-700">
                        {fmtFull(cashFlowStats.monthlyExpenses)}
                        {cashFlowStats.isAverage && (
                          <span className="ml-1 text-base font-normal opacity-60">/mo</span>
                        )}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border p-4 ${
                        cashFlowStats.monthlyNet >= 0
                          ? "border-green-100 bg-green-50"
                          : "border-red-100 bg-red-50"
                      }`}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Net
                      </p>
                      <p
                        className="mt-1 text-2xl font-bold"
                        style={{
                          color:
                            cashFlowStats.monthlyNet >= 0 ? "#16A34A" : "#DC2626",
                        }}
                      >
                        {cashFlowStats.monthlyNet >= 0 ? "+" : "−"}
                        {fmtFull(Math.abs(cashFlowStats.monthlyNet))}
                        {cashFlowStats.isAverage && (
                          <span className="ml-1 text-base font-normal opacity-60">
                            /mo
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-xs text-[#9AA5B4]">
                        {fmt(cashFlowStats.monthlyIncome)} in ·{" "}
                        {fmt(cashFlowStats.monthlyExpenses)} out
                      </p>
                      <p
                        className="mt-1 text-[10px]"
                        style={{
                          color:
                            cashFlowStats.monthlyNet >= 0 ? "#16A34A" : "#DC2626",
                        }}
                      >
                        {cashFlowStats.isAverage
                          ? `avg · ${cashFlowStats.periodLabel}`
                          : cashFlowStats.periodLabel}
                      </p>
                    </div>
                    <div
                      className={`rounded-xl border p-4 ${
                        cashFlowStats.savingsRate >= 15
                          ? "border-green-100 bg-green-50"
                          : cashFlowStats.savingsRate >= 5
                            ? "border-amber-100 bg-amber-50"
                            : "border-red-100 bg-red-50"
                      }`}
                    >
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Savings rate
                      </p>
                      <p
                        className="mt-1 text-2xl font-bold"
                        style={{
                          color:
                            cashFlowStats.savingsRate >= 15
                              ? "#16A34A"
                              : cashFlowStats.savingsRate >= 5
                                ? "#D97706"
                                : "#DC2626",
                        }}
                      >
                        {cashFlowStats.savingsRate}%
                      </p>
                      <p className="mt-1 text-xs text-[#9AA5B4]">
                        {cashFlowStats.savingsRate >= 15
                          ? "✅ On track (target 15%)"
                          : cashFlowStats.savingsRate >= 5
                            ? "⚠️ Below target (15%)"
                            : "🔴 Well below target"}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── ACCOUNT BALANCE CARD ──────────────────────────── */}
              {accountBalanceStats && (() => {
                const {
                  account, runningBalance, totalCredits, totalDebits,
                  txCount, lastTx, latestDoc,
                  filteredCredits, filteredDebits,
                } = accountBalanceStats;

                const isPositive = runningBalance >= 0;
                const typeIcon =
                  account.type === "savings" ? "🐷"
                  : account.type === "checking" ? "🏦"
                  : "🏧";

                const typeLabel =
                  account.type === "savings"  ? "Savings Account"
                  : account.type === "checking" ? "Checking Account"
                  : account.type === "debit"    ? "Debit Account"
                  : "Account";

                return (
                  <div
                    className="overflow-hidden rounded-2xl border bg-white shadow-sm"
                    style={{ borderColor: account.color || "#E4E8F0" }}
                  >
                    {/* Color bar */}
                    <div
                      className="h-1.5 w-full"
                      style={{ backgroundColor: account.color || "#C9A84C" }}
                    />

                    <div className="p-5">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div
                            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-xl"
                            style={{ backgroundColor: `${account.color || "#C9A84C"}18` }}
                          >
                            {typeIcon}
                          </div>
                          <div>
                            <p className="text-base font-bold text-[#1B2A4A]">
                              {account.nickname}
                            </p>
                            <p className="text-xs text-[#9AA5B4]">
                              {account.bankName} · ••{account.last4} · {account.ownerName}
                            </p>
                            <span
                              className="mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white"
                              style={{ backgroundColor: account.color || "#9AA5B4" }}
                            >
                              {typeLabel}
                            </span>
                          </div>
                        </div>

                        {/* Running balance */}
                        <div className="text-right">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                            Running Balance
                          </p>
                          <p
                            className="text-3xl font-bold"
                            style={{ color: isPositive ? "#16A34A" : "#DC2626" }}
                          >
                            {isPositive ? "" : "−"}{fmt(Math.abs(runningBalance))}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            from {txCount} transaction{txCount !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>

                      {/* Credits / Debits breakdown */}
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <div className="rounded-xl bg-green-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-green-600">
                            ↓ Money In
                          </p>
                          <p className="mt-0.5 text-lg font-bold text-[#1B2A4A]">
                            {fmt(totalCredits)}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            income + transfers received
                          </p>
                        </div>

                        <div className="rounded-xl bg-red-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-red-500">
                            ↑ Money Out
                          </p>
                          <p className="mt-0.5 text-lg font-bold text-[#1B2A4A]">
                            {fmt(totalDebits)}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            expenses + transfers sent
                          </p>
                        </div>

                        <div
                          className="rounded-xl p-3"
                          style={{
                            backgroundColor: isPositive
                              ? "rgba(22,163,74,0.06)"
                              : "rgba(220,38,38,0.06)",
                          }}
                        >
                          <p
                            className="text-[10px] font-bold uppercase tracking-wide"
                            style={{ color: isPositive ? "#16A34A" : "#DC2626" }}
                          >
                            = Net
                          </p>
                          <p className="mt-0.5 text-lg font-bold text-[#1B2A4A]">
                            {isPositive ? "+" : "−"}{fmt(Math.abs(runningBalance))}
                          </p>
                          <p className="text-[10px] text-[#9AA5B4]">
                            all-time balance
                          </p>
                        </div>
                      </div>

                      {/* This period (respects date filter) */}
                      {(filteredCredits > 0 || filteredDebits > 0) &&
                        filtered.length !== transactions.filter(t => t.accountId === account.id).length && (
                          <div className="mt-3 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-4 py-3">
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                              This Period (filtered)
                            </p>
                            <div className="flex items-center gap-6 text-sm">
                              <span className="font-semibold text-green-600">
                                +{fmt(filteredCredits)} in
                              </span>
                              <span className="font-semibold text-red-500">
                                −{fmt(filteredDebits)} out
                              </span>
                              <span
                                className="font-bold"
                                style={{
                                  color: filteredCredits - filteredDebits >= 0
                                    ? "#16A34A" : "#DC2626",
                                }}
                              >
                                {filteredCredits - filteredDebits >= 0 ? "+" : "−"}
                                {fmt(Math.abs(filteredCredits - filteredDebits))} net
                              </span>
                            </div>
                          </div>
                        )}

                      {/* Statement reference + last transaction */}
                      <div className="mt-3 flex items-center justify-between text-[11px] text-[#9AA5B4]">
                        {latestDoc ? (
                          <span>
                            📄 Statement closed{" "}
                            <span className="font-semibold text-[#1B2A4A]">
                              {fmt(Number(latestDoc.closingBalance))}
                            </span>{" "}
                            on {latestDoc.statementEnd?.slice(5) ?? "?"}
                          </span>
                        ) : (
                          <span>No statement imported</span>
                        )}

                        {lastTx && (
                          <span>
                            Last: {lastTx.date}{" "}
                            <span className="font-semibold text-[#1B2A4A]">
                              {lastTx.merchantName || lastTx.desc?.slice(0, 25)}
                            </span>{" "}
                            <span
                              style={{
                                color: lastTx.direction === "credit" ? "#16A34A" : "#DC2626",
                              }}
                            >
                              {lastTx.direction === "credit" ? "+" : "−"}
                              {fmt(Math.abs(lastTx.amount))}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ── HOUSEHOLD DEBT (consolidated: credit cards + loans) ───── */}
              {accountFilter === "all" && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-[#1B2A4A]">Household Debt: Is the hole getting smaller?</h3>
                      <p className="mt-0.5 text-[10px] text-[#9AA5B4]">
                        {fmt(consolidatedHouseholdDebt)} total
                        {loans.length > 0 && ` · ${fmt(totalMinPayment)}/mo minimum (loans)`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg border border-[#E4E8F0] p-0.5">
                        {([
                          ["snowball", "Snowball"],
                          ["avalanche", "Avalanche"],
                          ["type", "Type"],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() => setLoanSortMode(mode)}
                            className={`rounded-md px-2 py-1 text-[10px] font-semibold transition ${
                              loanSortMode === mode
                                ? "bg-[#1B2A4A] text-white"
                                : "text-[#9AA5B4] hover:text-[#1B2A4A]"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const uid = user?.uid ?? "";
                          const m = members.find(x => x.uid === uid);
                          setShowAddLoan(true);
                          setLoanDraft({
                            type: "other",
                            active: true,
                            assignedTo: uid,
                            assignedToName: m?.firstName || m?.displayName || "Member",
                          });
                        }}
                        className="rounded-lg bg-[#C9A84C] px-3 py-1.5 text-[10px] font-bold text-[#1B2A4A]"
                      >
                        + Add Loan
                      </button>
                    </div>
                  </div>

                  {/* Debt wheel chart (pastel pie) — click segment to drill into bar + card */}
                  {debtPieData.length > 0 && (
                    <div className="mb-4 flex flex-wrap items-start gap-6 rounded-xl border border-[#E4E8F0] bg-[#FDFCFA] p-4">
                      <div className="flex items-center gap-4">
                        <div className="flex flex-col items-center shrink-0">
                          <div className="h-44 w-44">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={debtPieData}
                                  dataKey="value"
                                  nameKey="name"
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={48}
                                  outerRadius={78}
                                  paddingAngle={2}
                                  onClick={(data) => {
                                    const entry = data as { type?: "credit" | "loan"; id?: string };
                                    if (entry?.type && entry?.id) setSelectedDebtItem({ type: entry.type, id: entry.id });
                                  }}
                                  cursor="pointer"
                                >
                                  {debtPieData.map((entry, i) => (
                                    <Cell
                                      key={`${entry.type}-${entry.id}`}
                                      fill={entry.color}
                                      stroke={selectedDebtItem?.type === entry.type && selectedDebtItem?.id === entry.id ? "#1B2A4A" : "#fff"}
                                      strokeWidth={selectedDebtItem?.type === entry.type && selectedDebtItem?.id === entry.id ? 2 : 0}
                                    />
                                  ))}
                                </Pie>
                                <Tooltip
                                  formatter={(v) => [fmtFull(Number(v ?? 0)), ""]}
                                  contentStyle={{ fontSize: 11, borderRadius: 8 }}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="mt-2 text-center">
                            <p className="text-sm font-bold text-[#1B2A4A]">{fmt(consolidatedHouseholdDebt)}</p>
                            <p className="text-[9px] font-medium text-[#9AA5B4]">total debt</p>
                            {debtSummary?.debtChange != null && (
                              <p className={`mt-0.5 text-[9px] font-semibold ${debtSummary.debtChange < 0 ? "text-green-600" : "text-red-600"}`}>
                                {debtSummary.debtChange < 0 ? "↓" : "↑"} {fmt(Math.abs(debtSummary.debtChange))} vs prior stmt
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9AA5B4]">
                            {loanSortMode === "snowball" && "Pay in this order (snowball)"}
                            {loanSortMode === "avalanche" && "Pay in this order (avalanche)"}
                            {loanSortMode === "type" && "Debt breakdown (by type)"}
                          </p>
                          {paymentOrder.map((entry, idx) => (
                            <button
                              key={`${entry.type}-${entry.id}`}
                              type="button"
                              onClick={() => setSelectedDebtItem({ type: entry.type, id: entry.id })}
                              className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] transition ${
                                selectedDebtItem?.type === entry.type && selectedDebtItem?.id === entry.id
                                  ? "bg-[#1B2A4A]/10 ring-1 ring-[#1B2A4A]/20"
                                  : "hover:bg-[#E8ECF0]/60"
                              }`}
                            >
                              {(loanSortMode === "snowball" || loanSortMode === "avalanche") && (
                                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1B2A4A] text-[9px] font-bold text-white">
                                  {idx + 1}
                                </span>
                              )}
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: entry.color }}
                              />
                              <span className="min-w-0 flex-1 truncate font-medium text-[#1B2A4A]">{entry.name}</span>
                              <span className="shrink-0 text-[#9AA5B4]">{fmt(entry.value)}</span>
                            </button>
                          ))}
                          {selectedDebtItem && (
                            <button
                              type="button"
                              onClick={() => setSelectedDebtItem(null)}
                              className="mt-2 rounded-md px-2 py-1 text-[10px] font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
                            >
                              ← Show all
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Right panel: debt card when segment selected, or add/edit loan form */}
                      {(selectedDebtItem || showAddLoan || editingLoanId) && (
                      <div className="min-w-0 flex-1 border-l border-[#E4E8F0] pl-6">
                        {showAddLoan || editingLoanId ? (
                          /* Add / Edit loan form */
                          (() => {
                            const loan = editingLoanId ? loans.find((l) => l.id === editingLoanId) : null;
                            const draft = loan
                              ? { name: loan.name, type: loan.type, subtype: loan.subtype ?? "", balance: loan.balance, rate: loan.rate ?? 0, minimumPayment: loan.minimumPayment ?? 0, assignedTo: loan.assignedTo ?? "", assignedToName: loan.assignedToName ?? "", notes: loan.notes ?? "", active: loan.active ?? true }
                              : loanDraft;
                            const LOAN_TYPES: { value: Loan["type"]; label: string }[] = [
                              { value: "student", label: "Student Loan" },
                              { value: "car", label: "Car Loan" },
                              { value: "medical", label: "Medical Debt" },
                              { value: "personal", label: "Personal Loan" },
                              { value: "other", label: "Other" },
                            ];
                            return (
                              <div className="rounded-xl border border-[#E8ECF0] bg-[#FAFBFC] p-4">
                                <p className="mb-3 text-xs font-bold text-[#1B2A4A]">
                                  {editingLoanId ? "Edit loan" : "Add loan"}
                                </p>
                                <div className="space-y-3">
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Type</label>
                                    <select
                                      value={draft.type ?? "other"}
                                      onChange={(e) => setLoanDraft(f => ({ ...f, type: e.target.value as Loan["type"] }))}
                                      className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                    >
                                      {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Name</label>
                                    <input
                                      value={draft.name ?? ""}
                                      onChange={(e) => setLoanDraft(f => ({ ...f, name: e.target.value }))}
                                      placeholder="e.g. My Car Loan"
                                      className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                    />
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Balance</label>
                                    <input
                                      type="number"
                                      min={0}
                                      value={draft.balance !== undefined && draft.balance !== null ? String(draft.balance) : ""}
                                      onChange={(e) => setLoanDraft(f => ({ ...f, balance: parseFloat(e.target.value) || 0 }))}
                                      className="h-8 w-24 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                    />
                                  </div>
                                  <div className="flex gap-2">
                                    <div>
                                      <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Rate %</label>
                                      <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={draft.rate !== undefined && draft.rate !== null ? String(draft.rate) : ""}
                                        onChange={(e) => setLoanDraft(f => ({ ...f, rate: parseFloat(e.target.value) || 0 }))}
                                        placeholder="5.5"
                                        className="h-8 w-20 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Min pmt</label>
                                      <input
                                        type="number"
                                        min={0}
                                        value={draft.minimumPayment !== undefined && draft.minimumPayment !== null ? String(draft.minimumPayment) : ""}
                                        onChange={(e) => setLoanDraft(f => ({ ...f, minimumPayment: parseFloat(e.target.value) || 0 }))}
                                        placeholder="0"
                                        className="h-8 w-20 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                      />
                                    </div>
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Person</label>
                                    <select
                                      value={draft.assignedTo ?? ""}
                                      onChange={(e) => {
                                        const uid = e.target.value;
                                        const m = members.find(x => x.uid === uid);
                                        setLoanDraft(f => ({ ...f, assignedTo: uid, assignedToName: m?.firstName || m?.displayName || "Member" }));
                                      }}
                                      className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"
                                    >
                                      <option value="">Select</option>
                                      {members.map(m => (
                                        <option key={m.uid} value={m.uid}>{m.firstName || m.displayName || "Member"}</option>
                                      ))}
                                    </select>
                                  </div>
                                  <div>
                                    <label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Notes</label>
                                    <textarea
                                      value={draft.notes ?? ""}
                                      onChange={(e) => setLoanDraft(f => ({ ...f, notes: e.target.value }))}
                                      placeholder="Servicer, due date..."
                                      rows={2}
                                      className="w-full rounded-lg border border-[#E4E8F0] bg-white px-2 py-1.5 text-xs text-[#1B2A4A]"
                                    />
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button
                                      type="button"
                                      disabled={savingLoan || !(draft.name ?? "").trim()}
                                      onClick={() => void saveLoan(editingLoanId, draft)}
                                      className="rounded-lg bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#1B2A4A] disabled:opacity-50"
                                    >
                                      {savingLoan ? "Saving…" : editingLoanId ? "Update" : "Add"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setShowAddLoan(false);
                                        setEditingLoanId(null);
                                        setLoanDraft({});
                                      }}
                                      className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs text-[#9AA5B4] hover:text-[#1B2A4A]"
                                    >
                                      Cancel
                                    </button>
                                    {editingLoanId && (
                                      <button
                                        type="button"
                                        onClick={() => void deleteLoan(editingLoanId)}
                                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
                                      >
                                        Delete
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()
                        ) : selectedDebtItem?.type === "credit" ? (
                            (() => {
                              const stats = cardStats.find((s) => s.card.id === selectedDebtItem.id);
                              if (!stats) return null;
                              const { card, utilization, estimatedBalance, available, creditLimit, recent } = stats;
                              const uColor = utilizationColor(utilization);
                              const uLabel = utilizationLabel(utilization);
                              return (
                                <div className="overflow-hidden rounded-xl border border-[#E8ECF0] bg-white">
                                  <div className="h-1 w-full" style={{ backgroundColor: card.color }} />
                                  <div className="p-4">
                                    <div className="flex items-center justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-bold text-[#1B2A4A]">{card.nickname}</p>
                                        <p className="text-[10px] text-[#9AA5B4]">{card.bankName} · ••{card.last4}</p>
                                      </div>
                                      <p className="text-xl font-bold text-[#1B2A4A]">{fmt(estimatedBalance)}</p>
                                    </div>
                                    <div className="mt-3">
                                      <div className="mb-1 flex items-center justify-between text-[10px]">
                                        <span className="font-semibold" style={{ color: uColor }}>{utilization}% utilized — {uLabel}</span>
                                        <span className="text-[#9AA5B4]">{fmt(available)} available of {fmt(creditLimit)}</span>
                                      </div>
                                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
                                        <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, utilization)}%`, backgroundColor: uColor }} />
                                      </div>
                                    </div>
                                    {recent.length > 0 && (
                                      <div className="mt-4">
                                        <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Recent Transactions</p>
                                        <div className="divide-y divide-[#F4F6FA]">
                                          {recent.map((tx) => {
                                            const isPayment = tx.direction === "credit";
                                            return (
                                              <div key={tx.id} className="flex items-center gap-3 py-2">
                                                <span className="w-20 shrink-0 text-[10px] text-[#9AA5B4]">{tx.date}</span>
                                                <span className="flex-1 truncate text-xs font-semibold text-[#1B2A4A]">{tx.merchantName || tx.desc}</span>
                                                {tx.category && (
                                                  <span className="rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[10px] text-[#9AA5B4]">{getCategoryEmoji(tx.category)} {tx.category}</span>
                                                )}
                                                <span className={`shrink-0 text-[11px] font-bold ${isPayment ? "text-green-600" : "text-red-600"}`}>
                                                  {tx.direction === "debit" ? "−" : "+"}{fmt(tx.amount)}
                                                  {isPayment && <span className="ml-1 text-[9px] font-bold text-green-500">PMT</span>}
                                                </span>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })()
                          ) : (
                            (() => {
                              if (!selectedDebtItem) return null;
                              const loan = sortedLoans.find((l) => l.id === selectedDebtItem.id);
                              if (!loan) return null;
                              const payments = loanPaymentsByLoanId[loan.id] ?? [];
                              const totalPaid = payments.reduce((s, t) => s + t.amount, 0);
                              const remainingBalance = Math.max(0, loan.balance - totalPaid);
                              const paidPct = loan.balance > 0 ? Math.min(100, (totalPaid / loan.balance) * 100) : 100;
                              const isCustomType = loan.type === "other" && loan.subtype && debtSubcatNames.includes(loan.subtype);
                              const color = isCustomType ? "#9AA5B4" : (LOAN_TYPE_COLORS[loan.type] || "#9AA5B4");
                              const label = isCustomType ? loan.subtype! : (LOAN_TYPE_LABELS[loan.type] || "Other");
                              return (
                                <div className="overflow-hidden rounded-xl border border-[#E4E8F0]" style={{ borderLeftWidth: 3, borderLeftColor: color }}>
                                  <div className="px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-bold text-[#1B2A4A]">{loan.name}</p>
                                        <span className="inline-block mt-0.5 rounded-full px-2 py-0.5 text-[9px] font-semibold text-white" style={{ backgroundColor: color }}>{label}</span>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        <div className="text-right">
                                          <p className={`text-lg font-bold ${remainingBalance === 0 ? "text-green-600" : "text-[#1B2A4A]"}`}>
                                            {fmt(remainingBalance)}
                                            {remainingBalance === 0 && totalPaid > 0 && " ✓"}
                                          </p>
                                          <p className="text-[10px] text-[#9AA5B4]">
                                            {totalPaid > 0 && `${fmt(totalPaid)} paid · `}
                                            {remainingBalance > 0 ? `${fmt(remainingBalance)} left` : "Paid off"}
                                          </p>
                                        </div>
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setSelectedDebtItem(null);
                                            setEditingLoanId(loan.id);
                                            setLoanDraft({
                                              name: loan.name, type: loan.type, subtype: loan.subtype,
                                              balance: loan.balance, rate: loan.rate, minimumPayment: loan.minimumPayment,
                                              assignedTo: loan.assignedTo, assignedToName: loan.assignedToName,
                                              notes: loan.notes, active: loan.active,
                                            });
                                          }}
                                          className="rounded-lg border border-[#E4E8F0] px-2 py-1 text-[10px] text-[#9AA5B4] hover:text-[#1B2A4A]"
                                        >
                                          Edit
                                        </button>
                                      </div>
                                    </div>
                                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[#E8ECF0]">
                                      <div className="h-2 rounded-full bg-green-500 transition-all" style={{ width: `${paidPct}%` }} />
                                    </div>
                                    {(loan.rate > 0 || loan.minimumPayment > 0) && (
                                      <p className="mt-1 text-[10px] text-[#9AA5B4]">
                                        {loan.rate > 0 ? `${loan.rate}% APR` : "0% APR"}
                                        {loan.minimumPayment > 0 && ` · ${fmt(loan.minimumPayment)}/mo min`}
                                      </p>
                                    )}
                                    {/* Associated payments */}
                                    <div
                                      className={`mt-3 rounded-lg border-2 border-dashed p-3 text-xs transition ${
                                        dragOverLoanId === loan.id ? "border-[#C9A84C] bg-[#FFFDF5]" : "border-[#E8ECF0] bg-[#F9FAFC]"
                                      }`}
                                      onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = "move";
                                        setDragOverLoanId(loan.id);
                                      }}
                                      onDragLeave={() => setDragOverLoanId(null)}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        setDragOverLoanId(null);
                                        const txId = e.dataTransfer.getData("text/plain");
                                        if (txId) void handleAssociatePaymentWithLoan(txId, loan.id);
                                      }}
                                    >
                                      <p className="mb-2 text-[10px] font-semibold text-[#9AA5B4]">Associated payments — drag here to mark as paid</p>
                                      {payments.length === 0 ? (
                                        <p className="text-[10px] text-[#9AA5B4]">No payments yet. Drag from Transactions or another loan.</p>
                                      ) : (
                                        <div className="space-y-1.5">
                                          {payments.map((tx) => (
                                            <div
                                              key={tx.id}
                                              draggable
                                              onDragStart={(e) => {
                                                e.dataTransfer.setData("text/plain", tx.id);
                                                e.dataTransfer.effectAllowed = "move";
                                              }}
                                              className="flex cursor-grab items-center justify-between gap-2 rounded border border-[#E4E8F0] bg-white px-2 py-1.5 text-[10px] hover:border-[#C9A84C] active:cursor-grabbing"
                                            >
                                              <span className="min-w-0 flex-1 truncate font-medium text-[#1B2A4A]">{tx.merchantName || tx.desc}</span>
                                              <span className="shrink-0 text-red-600">−{fmt(tx.amount)}</span>
                                              <span className="shrink-0 text-[#9AA5B4]">{tx.date}</span>
                                              <button
                                                type="button"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  void handleDisassociatePaymentFromLoan(tx.id);
                                                }}
                                                className="ml-1 shrink-0 rounded p-0.5 text-[#9AA5B4] hover:bg-red-50 hover:text-red-500"
                                                title="Remove from this loan"
                                              >
                                                ×
                                              </button>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              );
                            })()
                          )}
                        </div>
                      )}

                      </div>
                    )}
                  </div>
                )}

                  {/* When no debt data but add/edit open — show form in right panel */}
                  {(showAddLoan || editingLoanId) && debtPieData.length === 0 && (
                    <div className="mb-4 flex items-start gap-6 rounded-xl border border-[#E4E8F0] bg-[#FDFCFA] p-4">
                      <div className="text-sm text-[#9AA5B4]">No debt yet — add your first loan</div>
                      <div className="min-w-[280px] flex-1">
                        {(() => {
                          const loan = editingLoanId ? loans.find((l) => l.id === editingLoanId) : null;
                          const draft = loan
                            ? { name: loan.name, type: loan.type, subtype: loan.subtype ?? "", balance: loan.balance, rate: loan.rate ?? 0, minimumPayment: loan.minimumPayment ?? 0, assignedTo: loan.assignedTo ?? "", assignedToName: loan.assignedToName ?? "", notes: loan.notes ?? "", active: loan.active ?? true }
                            : loanDraft;
                          const LOAN_TYPES_EXTRA: { value: Loan["type"]; label: string }[] = [
                            { value: "student", label: "Student Loan" },
                            { value: "car", label: "Car Loan" },
                            { value: "medical", label: "Medical Debt" },
                            { value: "personal", label: "Personal Loan" },
                            { value: "other", label: "Other" },
                          ];
                          return (
                            <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
                              <p className="mb-3 text-xs font-bold text-[#1B2A4A]">{editingLoanId ? "Edit loan" : "Add loan"}</p>
                              <div className="space-y-3">
                                <div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Type</label>
                                <select value={draft.type ?? "other"} onChange={(e) => setLoanDraft(f => ({ ...f, type: e.target.value as Loan["type"] }))} className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]">
                                  {LOAN_TYPES_EXTRA.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                </select></div>
                                <div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Name</label>
                                <input value={draft.name ?? ""} onChange={(e) => setLoanDraft(f => ({ ...f, name: e.target.value }))} placeholder="e.g. My Car Loan" className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]" /></div>
                                <div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Balance</label>
                                <input type="number" min={0} value={draft.balance !== undefined && draft.balance !== null ? String(draft.balance) : ""} onChange={(e) => setLoanDraft(f => ({ ...f, balance: parseFloat(e.target.value) || 0 }))} className="h-8 w-24 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]" /></div>
                                <div className="flex gap-2"><div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Rate %</label><input type="number" min={0} step={0.1} value={draft.rate !== undefined && draft.rate !== null ? String(draft.rate) : ""} onChange={(e) => setLoanDraft(f => ({ ...f, rate: parseFloat(e.target.value) || 0 }))} placeholder="5.5" className="h-8 w-20 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]" /></div><div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Min pmt</label><input type="number" min={0} value={draft.minimumPayment !== undefined && draft.minimumPayment !== null ? String(draft.minimumPayment) : ""} onChange={(e) => setLoanDraft(f => ({ ...f, minimumPayment: parseFloat(e.target.value) || 0 }))} placeholder="0" className="h-8 w-20 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]" /></div></div>
                                <div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Person</label><select value={draft.assignedTo ?? ""} onChange={(e) => { const uid = e.target.value; const m = members.find(x => x.uid === uid); setLoanDraft(f => ({ ...f, assignedTo: uid, assignedToName: m?.firstName || m?.displayName || "Member" })); }} className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs text-[#1B2A4A]"><option value="">Select</option>{members.map(m => <option key={m.uid} value={m.uid}>{m.firstName || m.displayName || "Member"}</option>)}</select></div>
                                <div><label className="mb-0.5 block text-[10px] font-medium text-[#9AA5B4]">Notes</label><textarea value={draft.notes ?? ""} onChange={(e) => setLoanDraft(f => ({ ...f, notes: e.target.value }))} placeholder="Servicer, due date..." rows={2} className="w-full rounded-lg border border-[#E4E8F0] bg-white px-2 py-1.5 text-xs text-[#1B2A4A]" /></div>
                                <div className="flex gap-2 pt-1">
                                  <button type="button" disabled={savingLoan || !(draft.name ?? "").trim()} onClick={() => void saveLoan(editingLoanId, draft)} className="rounded-lg bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#1B2A4A] disabled:opacity-50">{savingLoan ? "Saving…" : editingLoanId ? "Update" : "Add"}</button>
                                  <button type="button" onClick={() => { setShowAddLoan(false); setEditingLoanId(null); setLoanDraft({}); }} className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs text-[#9AA5B4] hover:text-[#1B2A4A]">Cancel</button>
                                  {editingLoanId && <button type="button" onClick={() => void deleteLoan(editingLoanId)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>}
                                </div>
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  )}

              {/* ── CREDIT CARD DETAIL CARD (when credit card selected in filter) ─ */}
              {isCreditCardView && filteredAccount && (() => {
                const stats = effectiveCardStats[0];
                if (!stats) return null;
                const recentTxns = [...filtered]
                  .filter(t => t.type === "expense")
                  .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                  .slice(0, 3);
                const utilColor = utilizationColor(stats.utilization);
                return (
                  <div className="overflow-hidden rounded-2xl border border-[#E8ECF0] bg-white shadow-sm">
                    {/* Accent bar */}
                    <div className="h-1.5 w-full" style={{ backgroundColor: filteredAccount.color || "#C9A84C" }} />
                    <div className="p-6">
                      {/* Card header */}
                      <div className="mb-5 flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-xl font-bold text-[#1B2A4A]">
                            {filteredAccount.nickname}
                          </h3>
                          <p className="mt-0.5 text-sm text-[#9AA5B4]">
                            {filteredAccount.bankName ?? "Bank"} · ••••{filteredAccount.last4 ?? "****"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-2xl font-bold text-[#1B2A4A]">
                            {fmt(stats.estimatedBalance)}
                          </p>
                          <p className="mt-0.5 text-xs text-[#9AA5B4]">
                            {fmt(stats.available)} available of {fmt(stats.creditLimit)}
                          </p>
                        </div>
                      </div>
                      {/* Utilization */}
                      <div className="mb-6">
                        <p className="mb-2 text-sm font-medium" style={{ color: utilColor }}>
                          {stats.utilization}% utilized — {utilizationLabel(stats.utilization)}
                        </p>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[#E8ECF0]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min(100, stats.utilization)}%`,
                              backgroundColor: utilColor,
                            }}
                          />
                        </div>
                      </div>
                      {/* Recent transactions */}
                      <div className="border-t border-[#E8ECF0] pt-4">
                        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                          Recent transactions
                        </p>
                        {recentTxns.length === 0 ? (
                          <p className="text-sm text-[#9AA5B4]">No transactions in this period.</p>
                        ) : (
                          <div className="space-y-2.5">
                            {recentTxns.map((tx) => (
                              <div
                                key={tx.id}
                                className="flex items-center justify-between gap-3 py-1.5"
                              >
                                <span className="text-xs text-[#9AA5B4] shrink-0">{tx.date}</span>
                                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#1B2A4A]">
                                  {tx.merchantName || tx.desc || "—"}
                                </span>
                                <span
                                  className="shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold"
                                  style={{
                                    backgroundColor: `${getCategoryColor(tx.category)}20`,
                                    color: getCategoryColor(tx.category),
                                  }}
                                >
                                  {getCategoryEmoji(tx.category)} {tx.category}
                                </span>
                                <span className="shrink-0 text-sm font-bold text-red-600">
                                  −{fmtFull(tx.amount)}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Top spending categories — in-card drill-down */}
              <div className="rounded-2xl border border-[#E8ECF0] bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold text-[#1B2A4A]">Top spending</h3>
                {categoryData.length === 0 ? (
                  <p className="text-sm text-[#9AA5B4]">No expense data in this period.</p>
                ) : topSpendingSelectedCategory ? (
                  (() => {
                    const cat = categoryData.find(c => c.name === topSpendingSelectedCategory);
                    if (!cat) return null;
                    const catTxns = filtered.filter(t => t.type === "expense" && t.category === topSpendingSelectedCategory);
                    const subcatMap: Record<string, { amount: number; txns: Tx[] }> = {};
                    catTxns.forEach(t => {
                      const sub = t.subcat?.trim() || "Other";
                      if (!subcatMap[sub]) subcatMap[sub] = { amount: 0, txns: [] };
                      subcatMap[sub].amount += t.amount;
                      subcatMap[sub].txns.push(t);
                    });
                    const subcats = Object.entries(subcatMap).sort((a, b) => b[1].amount - a[1].amount);
                    return (
                      <div>
                        <button
                          type="button"
                          onClick={() => setTopSpendingSelectedCategory(null)}
                          className="mb-3 flex items-center gap-1.5 text-[10px] font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
                        >
                          ← All categories
                        </button>
                        <div className="mb-4 flex items-center justify-between border-b border-[#E4E8F0] pb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{cat.emoji}</span>
                            <span className="font-bold text-[#1B2A4A]">{cat.name}</span>
                          </div>
                          <span className="font-bold text-[#1B2A4A]">{fmt(cat.value)}</span>
                        </div>
                        <div className="space-y-3 max-h-80 overflow-y-auto">
                          {subcats.map(([subName, { amount, txns }]) => (
                            <details key={subName} className="rounded-lg border border-[#E8ECF0] overflow-hidden">
                              <summary className="flex cursor-pointer items-center justify-between bg-[#F9FAFC] px-3 py-2 text-[11px] font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]">
                                <span>{subName}</span>
                                <span>{fmt(amount)}</span>
                              </summary>
                              <div className="divide-y divide-[#F4F6FA] bg-white">
                                {txns.map(t => (
                                  <div key={t.id} className="flex items-center justify-between px-3 py-2 text-[10px]">
                                    <span className="min-w-0 flex-1 truncate text-[#1B2A4A]">{t.merchantName || t.desc}</span>
                                    <span className="ml-2 shrink-0 text-[#9AA5B4]">{t.date}</span>
                                    <span className="ml-2 shrink-0 font-semibold text-red-600">−{fmtFull(t.amount)}</span>
                                  </div>
                                ))}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    );
                  })()
                ) : (
                  <div className="space-y-2.5">
                    {categoryData.slice(0, 6).map(cat => {
                      const pct = Math.round((cat.value / kpis.expenses) * 100);
                      return (
                        <button
                          key={cat.name}
                          type="button"
                          onClick={() => setTopSpendingSelectedCategory(cat.name)}
                          className="flex w-full items-center gap-3 text-left group"
                        >
                          <span className="w-6 text-base">{cat.emoji}</span>
                          <span className="w-28 shrink-0 text-sm font-semibold text-[#1B2A4A] group-hover:text-[#C9A84C]">
                            {cat.name}
                          </span>
                          <div className="flex-1 h-2 rounded-full bg-[#F4F6FA] overflow-hidden">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{ width: `${pct}%`, backgroundColor: cat.color }}
                            />
                          </div>
                          <span className="w-16 shrink-0 text-right text-xs font-semibold text-[#1B2A4A]">
                            {fmt(cat.value)}
                          </span>
                          <span className="w-8 shrink-0 text-right text-[10px] text-[#9AA5B4]">
                            {pct}%
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── EMERGENCY FUND: Are we protected? ─────────────────────── */}
              {accountFilter === "all" && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-sm">
                  <h3 className="mb-1 text-sm font-bold text-[#1B2A4A]">
                    Emergency fund — &ldquo;Are we protected?&rdquo;
                  </h3>
                  <p className="mb-4 text-[11px] text-[#9AA5B4]">
                    This is the most emotionally motivating metric for couples because progress is visible.
                  </p>

                  <div className="mb-4">
                    <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                      Liquid savings
                    </p>
                    {liquidSavingsByAccount.length > 0 ? (
                      <div className="space-y-1.5">
                        {liquidSavingsByAccount.map((a) => (
                          <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-[#1B2A4A]">{a.nickname}</span>
                            <span className="shrink-0 font-semibold text-[#1B2A4A]">{fmtFull(a.balance)}</span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-[#E4E8F0] pt-2 text-sm font-bold">
                          <span className="text-[#1B2A4A]">Total:</span>
                          <span className="text-[#1B2A4A]">{fmtFull(totalLiquidSavings)}</span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-[#9AA5B4]">
                        No savings accounts linked yet.{" "}
                        <Link href="/settings/accounts" className="font-semibold text-[#C9A84C] underline underline-offset-1 hover:text-[#1B2A4A]">
                          Set account types →
                        </Link>
                      </p>
                    )}
                  </div>

                  {(() => {
                    const avgMonthlyExpenses = cashFlowStats.monthlyExpenses;
                    const monthsOfCoverage = avgMonthlyExpenses > 0
                      ? totalLiquidSavings / avgMonthlyExpenses
                      : 0;
                    const targetMonths = 6;
                    const progressPct = Math.min(100, (monthsOfCoverage / targetMonths) * 100);
                  return (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                        <div>
                          <p className="text-[10px] font-semibold text-[#9AA5B4]">Avg monthly expenses</p>
                          <p className="font-bold text-[#1B2A4A]">~{fmtFull(avgMonthlyExpenses)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-[#9AA5B4]">Months of coverage</p>
                          <p className="font-bold text-[#1B2A4A]">{monthsOfCoverage.toFixed(1)} months</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold text-[#9AA5B4]">Target</p>
                          <p className="font-bold text-[#1B2A4A]">3–6 months</p>
                        </div>
                      </div>
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-[#9AA5B4]">Progress</span>
                          <span className="font-bold text-[#1B2A4A]">{Math.round(progressPct)}%</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E8ECF0]">
                          <div
                            className="h-full rounded-full bg-green-500 transition-all"
                            style={{ width: `${progressPct}%` }}
                          />
                        </div>
                      </div>
                      <p className="text-[10px] italic text-[#9AA5B4]">
                        Watching &ldquo;months of runway&rdquo; grow gives couples a concrete shared goal.
                      </p>
                      <Link
                        href="/settings/accounts"
                        className="mt-2 block text-[10px] font-semibold text-[#C9A84C] underline underline-offset-1 hover:text-[#1B2A4A]"
                      >
                        Manage accounts / set savings vs checking →
                      </Link>
                    </div>
                  );
                  })()}
                </div>
              )}

              {/* ── CREDIT HEALTH: Can we borrow if we need to? ───────────────── */}
              {accountFilter === "all" && creditCards.length > 0 && (() => {
                const totalUsed = debtSummary?.creditCardTotal ?? 0;
                const totalLimit = debtSummary?.totalCreditLimit ?? 0;
                const utilizationPct = totalLimit > 0 ? Math.round((totalUsed / totalLimit) * 100) : 0;
                const barColor = utilizationPct >= 60 ? "#DC2626" : utilizationPct >= 30 ? "#D97706" : "#16A34A";
                const dueDates = cardStats
                  .filter(s => s.dueDate)
                  .map(s => ({ dateStr: s.dueDate, card: s.card, days: s.daysUntilDue }))
                  .sort((a, b) => a.dateStr.localeCompare(b.dateStr));
                const now = new Date();
                const calYear = now.getFullYear();
                const calMonth = now.getMonth();
                const firstDay = new Date(calYear, calMonth, 1);
                const lastDay = new Date(calYear, calMonth + 1, 0);
                const startPad = firstDay.getDay();
                const numDays = lastDay.getDate();
                const dueByDay: Record<number, typeof dueDates> = {};
                dueDates.forEach(d => {
                  const dDate = new Date(d.dateStr + "T00:00:00");
                  if (dDate.getMonth() === calMonth && dDate.getFullYear() === calYear) {
                    const day = dDate.getDate();
                    if (!dueByDay[day]) dueByDay[day] = [];
                    dueByDay[day].push(d);
                  }
                });
                return (
                  <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-sm">
                    <h3 className="mb-4 text-sm font-bold text-[#1B2A4A]">
                      Credit health — &ldquo;Can we borrow if we need to?&rdquo;
                    </h3>
                    <div className="grid gap-6 md:grid-cols-2">
                      {/* Left: Credit usage bar (same design as Emergency fund) */}
                      <div>
                        <div className="mb-2 flex items-center justify-between text-[10px]">
                          <span className="font-semibold text-[#9AA5B4]">Credit utilization</span>
                          <span className="font-bold text-[#1B2A4A]">{utilizationPct}% used</span>
                        </div>
                        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#E8ECF0]">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${Math.min(100, utilizationPct)}%`, backgroundColor: barColor }}
                          />
                        </div>
                        <div className="mt-2 flex justify-between text-[11px]">
                          <span className="text-[#9AA5B4]">Used: {fmtFull(totalUsed)}</span>
                          <span className="font-semibold text-[#1B2A4A]">Available: {fmtFull(Math.max(0, totalLimit - totalUsed))}</span>
                        </div>
                        <p className="mt-2 text-[10px] text-[#9AA5B4]">Target: under 30%</p>
                        <div className="mt-3 space-y-1.5">
                          {cardStats.map((s) => (
                            <button
                              key={s.card.id}
                              type="button"
                              onClick={() => { setAccountFilter(s.card.id); setActiveTab("categories"); }}
                              className="flex w-full items-center justify-between rounded-lg border border-[#E4E8F0] px-3 py-2 text-left text-xs transition hover:border-[#C9A84C] hover:bg-[#FFF8E8]"
                            >
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                                style={{ backgroundColor: s.card.color ?? "#9AA5B4" }}
                              >
                                {s.card.nickname}
                              </span>
                              <span className="font-semibold text-[#1B2A4A]">
                                {fmtFull(s.estimatedBalance)} / {fmtFull(s.creditLimit)} ({s.utilization}%)
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      {/* Right: Calendar with due dates */}
                      <div>
                        <p className="mb-2 text-[10px] font-semibold text-[#9AA5B4]">Payment due dates</p>
                        <div className="rounded-xl border border-[#E4E8F0] bg-[#FAFBFC] p-3">
                          <p className="mb-2 text-center text-xs font-bold text-[#1B2A4A]">
                            {now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
                          </p>
                          <div className="grid grid-cols-7 gap-0.5 text-center">
                            {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                              <span key={i} className="text-[9px] font-semibold text-[#9AA5B4]">{d}</span>
                            ))}
                            {Array.from({ length: startPad }, (_, i) => (
                              <div key={`pad-${i}`} className="h-7" />
                            ))}
                            {Array.from({ length: numDays }, (_, i) => {
                              const day = i + 1;
                              const dues = dueByDay[day] ?? [];
                              const isToday = day === now.getDate();
                              return (
                                <div
                                  key={day}
                                  className={`flex h-7 flex-col items-center justify-center rounded text-[10px] ${
                                    isToday ? "bg-[#C9A84C]/20 font-bold text-[#1B2A4A]" : ""
                                  }`}
                                >
                                  <span className={isToday ? "text-[#1B2A4A]" : "text-[#9AA5B4]"}>{day}</span>
                                  {dues.length > 0 && (
                                    <div className="mt-0.5 flex flex-wrap justify-center gap-0.5">
                                      {dues.slice(0, 2).map((d) => (
                                        <span
                                          key={d.card.id}
                                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                                          style={{ backgroundColor: d.card.color ?? "#9AA5B4" }}
                                          title={`${d.card.nickname} due`}
                                        />
                                      ))}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 border-t border-[#E4E8F0] pt-3">
                            {dueDates.map((d) => (
                              <div key={d.card.id} className="flex items-center gap-1.5 text-[10px]">
                                <span
                                  className="h-2 w-2 shrink-0 rounded-full"
                                  style={{ backgroundColor: d.card.color ?? "#9AA5B4" }}
                                />
                                <span className="text-[#1B2A4A]">
                                  {new Date(d.dateStr + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </span>
                                <span className="text-[#9AA5B4]">— {d.card.nickname}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                    <p className="mt-4 text-[10px] text-[#9AA5B4]">
                      Click a card to see categories, subcategories & transactions →
                    </p>
                  </div>
                );
              })()}

              {/* ── INCOME FAIRNESS: wheel by avg monthly income & expenses per person ───── */}
              {accountFilter === "all" && members.length > 0 && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-sm">
                  <h3 className="mb-1 text-sm font-bold text-[#1B2A4A]">
                    Cash Flow by Person
                    <span className="ml-2 text-[10px] font-normal text-[#9AA5B4]">
                      {cashFlowStats.isAverage
                        ? `avg/mo · ${cashFlowStats.periodLabel}`
                        : cashFlowStats.periodLabel}
                    </span>
                  </h3>
                  <p className="mb-4 text-[10px] text-[#9AA5B4]">
                    Who&apos;s bringing in what, and does the expense split reflect it?
                  </p>
                  <div className="flex flex-wrap items-start justify-center gap-6">
                    {/* Income wheel */}
                    <div className="flex flex-col items-center">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-green-600">
                        Income share
                      </p>
                      <div className="h-40 w-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={(() => {
                                const d = cashFlowStats.byPerson
                                  .filter(p => p.income > 0)
                                  .map((p, i) => ({
                                    name: p.name,
                                    value: p.income,
                                    color: ["#22C55E", "#3B82F6", "#8B5CF6", "#EC4899"][i % 4],
                                  }));
                                return d.length > 0 ? d : [{ name: "No income", value: 1, color: "#E8ECF0" }];
                              })()}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={64}
                              paddingAngle={2}
                            >
                              {(() => {
                                const d = cashFlowStats.byPerson
                                  .filter(p => p.income > 0)
                                  .map((p, i) => ({
                                    name: p.name,
                                    value: p.income,
                                    color: ["#22C55E", "#3B82F6", "#8B5CF6", "#EC4899"][i % 4],
                                  }));
                                const data = d.length > 0 ? d : [{ name: "No income", value: 1, color: "#E8ECF0" }];
                                return data.map((entry, i) => <Cell key={i} fill={entry.color} />);
                              })()}
                            </Pie>
                            <Tooltip
                              formatter={(v) => [fmtFull(Number(v ?? 0)), ""]}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 space-y-1 text-center">
                        {cashFlowStats.byPerson
                          .filter(p => p.income > 0)
                          .map((p, i) => {
                            const pct =
                              cashFlowStats.monthlyIncome > 0
                                ? Math.round((p.income / cashFlowStats.monthlyIncome) * 100)
                                : 0;
                            const colors = ["#22C55E", "#3B82F6", "#8B5CF6", "#EC4899"];
                            return (
                              <p
                                key={p.uid}
                                className="text-[11px] font-medium text-[#1B2A4A]"
                              >
                                <span
                                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: colors[i % colors.length] }}
                                />
                                {p.name}: {fmtFull(p.income)}
                                {cashFlowStats.isAverage ? "/mo" : ""} ({pct}%)
                              </p>
                            );
                          })}
                      </div>
                    </div>
                    {/* Expense wheel */}
                    <div className="flex flex-col items-center">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-red-600">
                        Expense share
                      </p>
                      <div className="h-40 w-40">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={(() => {
                                const d = cashFlowStats.byPerson
                                  .filter(p => p.expenses > 0)
                                  .map((p, i) => ({
                                    name: p.name,
                                    value: p.expenses,
                                    color: ["#EF4444", "#F97316", "#E879F9", "#F43F5E"][i % 4],
                                  }));
                                return d.length > 0 ? d : [{ name: "No expenses", value: 1, color: "#E8ECF0" }];
                              })()}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={36}
                              outerRadius={64}
                              paddingAngle={2}
                            >
                              {(() => {
                                const d = cashFlowStats.byPerson
                                  .filter(p => p.expenses > 0)
                                  .map((p, i) => ({
                                    color: ["#EF4444", "#F97316", "#E879F9", "#F43F5E"][i % 4],
                                  }));
                                const data = d.length > 0 ? d : [{ color: "#E8ECF0" }];
                                return data.map((entry, i) => <Cell key={i} fill={entry.color} />);
                              })()}
                            </Pie>
                            <Tooltip
                              formatter={(v) => [fmtFull(Number(v ?? 0)), ""]}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="mt-2 space-y-1 text-center">
                        {cashFlowStats.byPerson
                          .filter(p => p.expenses > 0)
                          .map((p, i) => {
                            const pct =
                              cashFlowStats.monthlyExpenses > 0
                                ? Math.round(
                                    (p.expenses / cashFlowStats.monthlyExpenses) * 100,
                                  )
                                : 0;
                            const colors = ["#EF4444", "#F97316", "#E879F9", "#F43F5E"];
                            return (
                              <p
                                key={p.uid}
                                className="text-[11px] font-medium text-[#1B2A4A]"
                              >
                                <span
                                  className="mr-1.5 inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: colors[i % colors.length] }}
                                />
                                {p.name}: {fmtFull(p.expenses)}
                                {cashFlowStats.isAverage ? "/mo" : ""} ({pct}%)
                              </p>
                            );
                          })}
                      </div>
                    </div>
                  </div>
                  {/* Combined total row */}
                  <div className="mt-4 flex flex-wrap gap-4 border-t border-[#E4E8F0] pt-4 text-xs">
                    <span className="font-semibold text-green-600">
                      {fmt(cashFlowStats.monthlyIncome)} in
                    </span>
                    <span className="font-semibold text-red-600">
                      {fmt(cashFlowStats.monthlyExpenses)} out
                    </span>
                    <span
                      className={`font-bold ${
                        cashFlowStats.monthlyNet >= 0
                          ? "text-green-700"
                          : "text-red-600"
                      }`}
                    >
                      {cashFlowStats.monthlyNet >= 0 ? "+" : "−"}
                      {fmt(Math.abs(cashFlowStats.monthlyNet))} net
                      {cashFlowStats.isAverage && "/mo"}
                    </span>
                  </div>
                </div>
              )}


            </div>
          )}

          {/* ── CATEGORIES TAB ───────────────────────────────── */}
          {activeTab === "categories" && (
            <div className="space-y-6">
              {categoryData.length === 0 ? (
                <div className="rounded-2xl border border-[#E8ECF0] bg-white p-12 text-center shadow-sm">
                  <p className="text-[#9AA5B4]">No expense data in this period.</p>
                </div>
              ) : (
                <>
                  {/* Donut chart */}
                  <div className="rounded-2xl border border-[#E8ECF0] bg-white p-6 shadow-sm">
                    <h3 className="mb-4 text-sm font-semibold text-[#1B2A4A]">Expense breakdown</h3>
                    <div className="flex items-center gap-6">
                      <div className="h-48 w-48 shrink-0">
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={categoryData}
                              dataKey="value"
                              nameKey="name"
                              cx="50%"
                              cy="50%"
                              innerRadius={50}
                              outerRadius={80}
                              paddingAngle={2}
                            >
                              {categoryData.map(entry => (
                                <Cell key={entry.name} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              formatter={(v) => [fmtFull(Number(v ?? 0)), ""]}
                              contentStyle={{ fontSize: 11, borderRadius: 8 }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="flex-1 space-y-2">
                        {categoryData.map(cat => {
                          const pct = Math.round((cat.value / kpis.expenses) * 100);
                          return (
                            <div key={cat.name} className="flex items-center gap-2">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: cat.color }} />
                              <span className="flex-1 text-xs font-semibold text-[#1B2A4A]">
                                {cat.emoji} {cat.name}
                              </span>
                              <span className="text-xs text-[#9AA5B4]">{pct}%</span>
                              <span className="w-20 text-right text-xs font-bold text-[#1B2A4A]">
                                {fmt(cat.value)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Category detail cards */}
                  <div className="grid grid-cols-2 gap-3">
                    {categoryData.map(cat => {
                      const catTxns = filtered.filter(t => t.type === "expense" && t.category === cat.name);
                      const subcatMap: Record<string, number> = {};
                      catTxns.forEach(t => {
                        if (t.subcat) subcatMap[t.subcat] = (subcatMap[t.subcat] || 0) + t.amount;
                      });
                      const subcats = Object.entries(subcatMap).sort((a, b) => b[1] - a[1]);
                      return (
                        <div
                          key={cat.name}
                          className="rounded-2xl border border-[#E8ECF0] bg-white p-5 shadow-sm"
                          style={{ borderTopWidth: 3, borderTopColor: cat.color }}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div>
                              <p className="text-lg">{cat.emoji}</p>
                              <p className="font-bold text-[#1B2A4A]">{cat.name}</p>
                              <p className="text-[10px] text-[#9AA5B4]">{catTxns.length} transactions</p>
                            </div>
                            <p className="text-xl font-bold text-[#1B2A4A]">{fmt(cat.value)}</p>
                          </div>
                          {subcats.length > 0 && (
                            <div className="space-y-1">
                              {subcats.slice(0, 4).map(([sub, val]) => (
                                <div key={sub} className="flex items-center justify-between text-xs">
                                  <span className="text-[#1B2A4A]/70">{sub}</span>
                                  <span className="font-semibold text-[#1B2A4A]">{fmtFull(val)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {catTxns.slice(0,2).map(t => (
                            <div key={t.id} className="mt-1 flex items-center justify-between border-t border-[#F4F6FA] pt-1 text-[10px]">
                              <span className="truncate text-[#9AA5B4]">{t.merchantName || t.desc}</span>
                              <span className="ml-2 shrink-0 text-[#9AA5B4]">{fmtFull(t.amount)}</span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── TRANSACTIONS TAB ─────────────────────────────── */}
          {activeTab === "transactions" && (
            <div className="rounded-2xl border border-[#E8ECF0] bg-white overflow-hidden">
              <div className="flex items-center justify-between border-b border-[#E8ECF0] px-5 py-3">
                <p className="text-sm font-bold text-[#1B2A4A]">
                  {filtered.length} transactions
                </p>
                <div className="flex items-center gap-2 text-[10px] text-[#9AA5B4]">
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-green-400" /> Income
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-red-400" /> Expense
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-blue-400" /> Transfer
                  </span>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#F4F6FA] text-left text-[10px] font-bold uppercase tracking-wider text-[#9AA5B4]">
                      <th className="px-5 py-3">Date</th>
                      <th className="px-3 py-3">Merchant</th>
                      <th className="px-3 py-3">Category</th>
                      <th className="px-3 py-3">Account</th>
                      <th className="px-3 py-3">Person</th>
                      <th className="px-3 py-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.slice(0, 200).map((tx, i) => {
                      const acc = tx.accountId ? accountById.get(tx.accountId) : undefined;
                      const isCredit = tx.direction === "credit" || tx.type === "income" || tx.type === "refund";
                      return (
                        <tr
                          key={tx.id}
                          className={`border-b border-[#F4F6FA] transition hover:bg-[#F9FAFC] ${
                            i % 2 === 0 ? "bg-white" : "bg-[#FAFBFC]"
                          }`}
                        >
                          <td className="px-5 py-2.5 text-xs text-[#9AA5B4]">{tx.date}</td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                  tx.type === "income" || tx.type === "refund" ? "bg-green-400"
                                  : tx.type === "transfer" ? "bg-blue-400"
                                  : "bg-red-400"
                                }`}
                              />
                              <div>
                                <p className="max-w-[200px] truncate font-semibold text-[#1B2A4A]">
                                  {tx.merchantName || tx.desc}
                                </p>
                                {tx.isSubscription && (
                                  <span className="text-[10px] text-blue-400">🔄 subscription</span>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5">
                            {tx.category ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[10px] font-semibold text-[#1B2A4A]">
                                {getCategoryEmoji(tx.category)} {tx.category}
                                {tx.subcat && <span className="opacity-60">· {tx.subcat}</span>}
                              </span>
                            ) : (
                              <span className="text-[10px] text-[#9AA5B4]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            {acc ? (
                              <span
                                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white"
                                style={{ backgroundColor: acc.color }}
                              >
                                ••{acc.last4}
                              </span>
                            ) : <span className="text-[10px] text-[#9AA5B4]">—</span>}
                          </td>
                          <td className="px-3 py-2.5 text-xs text-[#9AA5B4]">{tx.assignedToName}</td>
                          <td className={`px-3 py-2.5 text-right text-sm font-bold ${
                            isCredit ? "text-green-600" : "text-[#1B2A4A]"
                          }`}>
                            {isCredit ? "+" : "−"}{fmtFull(tx.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filtered.length > 200 && (
                  <p className="border-t border-[#F4F6FA] px-5 py-3 text-xs text-[#9AA5B4]">
                    Showing first 200 of {filtered.length} — use filters to narrow down.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ── TRENDS TAB ───────────────────────────────────── */}
          {activeTab === "trends" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[#E8ECF0] bg-white p-5">
                <h3 className="mb-4 text-sm font-bold text-[#1B2A4A]">
                  Income vs Expenses by Month
                </h3>
                {trendData.length === 0 ? (
                  <p className="text-sm text-[#9AA5B4]">No data in this period.</p>
                ) : (
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={trendData} barGap={4}>
                        <XAxis
                          dataKey="month"
                          tick={{ fontSize: 11, fill: "#9AA5B4" }}
                          tickFormatter={v => v.slice(5)}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 11, fill: "#9AA5B4" }}
                          tickFormatter={v => `$${(v/1000).toFixed(0)}k`}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          formatter={(v) => [fmtFull(Number(v ?? 0)), ""]}
                          contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #E4E8F0" }}
                        />
                        <Bar dataKey="income"   name="Income"   fill="#C9A84C" radius={[4,4,0,0]} />
                        <Bar dataKey="expenses" name="Expenses" fill="#1B2A4A" radius={[4,4,0,0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>

              {/* Month table */}
              <div className="rounded-2xl border border-[#E8ECF0] bg-white overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#F4F6FA] text-left text-[10px] font-bold uppercase tracking-wider text-[#9AA5B4]">
                      <th className="px-5 py-3">Month</th>
                      <th className="px-3 py-3 text-right">Income</th>
                      <th className="px-3 py-3 text-right">Expenses</th>
                      <th className="px-3 py-3 text-right">Net</th>
                      <th className="px-3 py-3 text-right">Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trendData.map((row, i) => {
                      const net  = row.income - row.expenses;
                      const rate = row.income > 0 ? Math.round((net / row.income) * 100) : 0;
                      return (
                        <tr key={row.month} className={`border-b border-[#F4F6FA] ${i%2===0?"bg-white":"bg-[#FAFBFC]"}`}>
                          <td className="px-5 py-3 font-semibold text-[#1B2A4A]">{row.month}</td>
                          <td className="px-3 py-3 text-right font-semibold text-green-600">{fmt(row.income)}</td>
                          <td className="px-3 py-3 text-right font-semibold text-red-600">{fmt(row.expenses)}</td>
                          <td className={`px-3 py-3 text-right font-bold ${net>=0?"text-green-700":"text-red-700"}`}>
                            {net >= 0 ? "+" : "−"}{fmt(Math.abs(net))}
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              rate >= 20 ? "bg-green-100 text-green-700"
                              : rate >= 0 ? "bg-amber-100 text-amber-700"
                              : "bg-red-100 text-red-700"
                            }`}>
                              {rate}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        

        </div>
    </div>
  );
}
