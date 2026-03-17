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
import { CATEGORIES, getCategoryEmoji } from "@/app/lib/categories";
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
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
  const [editingDueDate, setEditingDueDate] = useState<Record<string, string>>({});
  const [savingDueDate, setSavingDueDate]   = useState<Record<string, boolean>>({});
  const [sidebarSections, setSidebarSections] = useState({
    date: true, people: true, categories: true, advanced: false,
  });

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

  // ── CASH FLOW (trailing 3‑month) ────────────────────────────────
  // Household baseline: all transactions, trailing 3-month average
  const cashFlowTrailing3 = useMemo(() => {
    const now = new Date();
    const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const cutoff = toYmd(threeMonthsAgo);
    const recent = transactions.filter(t => t.date >= cutoff && t.month);
    const byMonth: Record<string, { incomeByPerson: Record<string, number>; income: number; expenses: number }> = {};
    recent.forEach(t => {
      if (!byMonth[t.month]) {
        byMonth[t.month] = { incomeByPerson: {}, income: 0, expenses: 0 };
      }
      const m = byMonth[t.month];
      if (t.type === "income" || t.type === "refund") {
        m.income += t.amount;
        m.incomeByPerson[t.assignedTo] = (m.incomeByPerson[t.assignedTo] || 0) + t.amount;
      }
      if (t.type === "expense") m.expenses += t.amount;
    });
    const months = Object.values(byMonth);
    if (months.length === 0) return null;
    const avgIncome = months.reduce((s, m) => s + m.income, 0) / months.length;
    const avgExpenses = months.reduce((s, m) => s + m.expenses, 0) / months.length;
    const avgNet = avgIncome - avgExpenses;
    const savingsRate = avgIncome > 0 ? Math.round((avgNet / avgIncome) * 100) : 0;
    const incomeByPerson: Record<string, number> = {};
    months.forEach(m => {
      Object.entries(m.incomeByPerson).forEach(([uid, amt]) => {
        incomeByPerson[uid] = (incomeByPerson[uid] || 0) + amt;
      });
    });
    const numMonths = months.length;
    Object.keys(incomeByPerson).forEach(uid => {
      incomeByPerson[uid] = Math.round((incomeByPerson[uid] / numMonths) * 100) / 100;
    });
    return { avgIncome, avgExpenses, avgNet, savingsRate, incomeByPerson };
  }, [transactions]);

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

  // ── LIQUID SAVINGS (for BS1) ────────────────────────────────────
  const savingsAccounts = accounts.filter(a => a.type === "savings");
  const totalLiquidSavings = savingsAccounts.reduce((s, a) => {
    const docs = docsByAccountId[a.id] ?? [];
    const latest = docs[0];
    return s + Number(latest?.closingBalance ?? 0);
  }, 0);

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

  // Active filter count
  const activeFilters = [
    personFilter !== "all", accountFilter !== "all", docFilter !== "all",
    categoryFilter !== "all", subcatFilter !== "all", typeFilter !== "all",
    dateFrom || dateTo, search.trim(),
  ].filter(Boolean).length;

  function clearAll() {
    setPersonFilter("all"); setAccountFilter("all"); setDocFilter("all");
    setCategoryFilter("all"); setSubcatFilter("all"); setTypeFilter("all");
    setDateFrom(""); setDateTo(""); setDatePreset("all"); setSearch("");
  }

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
    <div className="flex h-screen overflow-hidden bg-[#F4F6FA] text-[#1B2A4A]">

      {/* ── SIDEBAR ─────────────────────────────────────────────── */}
      <aside className={`flex flex-col border-r border-[#E8ECF0] bg-white transition-all duration-300 ${
        sidebarOpen ? "w-64" : "w-14"
      } shrink-0`}>

        {/* Sidebar header */}
        <div className="flex items-center justify-between border-b border-[#E8ECF0] px-4 py-4">
          {sidebarOpen && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#C9A84C]">
                Kingdom Wealth
              </p>
              <p className="text-base font-bold text-[#1B2A4A]">Dashboard</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setSidebarOpen(p => !p)}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#E8ECF0] text-[#9AA5B4] hover:text-[#1B2A4A]"
          >
            {sidebarOpen ? "←" : "→"}
          </button>
        </div>

        {sidebarOpen && (
          <div className="flex-1 overflow-y-auto px-3 py-4 space-y-3">

            {activeFilters > 0 && (
              <button
                type="button"
                onClick={clearAll}
                className="flex w-full items-center justify-between rounded-xl border border-[#C9A84C]/20 bg-[#FFF8E8] px-3 py-2 text-xs font-medium text-[#C9A84C]"
              >
                <span>{activeFilters} filter{activeFilters > 1 ? "s" : ""} active</span>
                <span>Clear all</span>
              </button>
            )}

            {/* People */}
            <div className="rounded-xl border border-[#E8ECF0] bg-[#FAFBFC]">
              <button type="button" onClick={() => setSidebarSections(s => ({ ...s, people: !s.people }))}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-[#1B2A4A]">
                People
                <span className="text-[#9AA5B4]">{sidebarSections.people ? "−" : "+"}</span>
              </button>
              {sidebarSections.people && (
                <div className="space-y-3 border-t border-[#E8ECF0] px-3 pb-3 pt-2">
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-[#9AA5B4]">Person</p>
              <div className="space-y-1">
                {[{ uid: "all", name: "Everyone" }, ...members.map(m => ({
                  uid: m.uid,
                  name: m.firstName || m.displayName || "Member",
                }))].map(p => (
                  <button
                    key={p.uid}
                    type="button"
                    onClick={() => setPersonFilter(p.uid)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      personFilter === p.uid
                        ? "bg-[#1B2A4A] text-white"
                        : "text-[#1B2A4A] hover:bg-[#F4F6FA]"
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                      personFilter === p.uid ? "bg-white/20 text-white" : "bg-[#C9A84C]/20 text-[#C9A84C]"
                    }`}>
                      {p.uid === "all" ? "★" : p.name.charAt(0).toUpperCase()}
                    </span>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
                </div>
              )}
            </div>

            {/* Categories */}
            <div className="rounded-xl border border-[#E8ECF0] bg-[#FAFBFC]">
              <button type="button" onClick={() => setSidebarSections(s => ({ ...s, categories: !s.categories }))}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-[#1B2A4A]">
                Categories
                <span className="text-[#9AA5B4]">{sidebarSections.categories ? "−" : "+"}</span>
              </button>
              {sidebarSections.categories && (
                <div className="space-y-3 border-t border-[#E8ECF0] px-3 pb-3 pt-2">
            <div>
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => { setCategoryFilter("all"); setSubcatFilter("all"); }}
                  className={`flex w-full rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                    categoryFilter === "all" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A] hover:bg-[#F4F6FA]"
                  }`}
                >
                  All Categories
                </button>
                {CATEGORIES.map(cat => (
                  <button
                    key={cat.name}
                    type="button"
                    onClick={() => { setCategoryFilter(cat.name); setSubcatFilter("all"); }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      categoryFilter === cat.name
                        ? "bg-[#C9A84C]/15 text-[#1B2A4A] ring-1 ring-[#C9A84C]"
                        : "text-[#1B2A4A] hover:bg-[#F4F6FA]"
                    }`}
                  >
                    <span>{cat.emoji}</span>
                    <span className="truncate">{cat.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {categoryFilter !== "all" && availableSubcats.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-medium text-[#9AA5B4]">Subcategory</p>
                <div className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSubcatFilter("all")}
                    className={`flex w-full rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                      subcatFilter === "all" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A] hover:bg-[#F4F6FA]"
                    }`}
                  >
                    All Subcategories
                  </button>
                  {availableSubcats.map(sub => (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() => setSubcatFilter(sub.name)}
                      className={`flex w-full rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                        subcatFilter === sub.name
                          ? "bg-[#C9A84C]/15 text-[#1B2A4A] ring-1 ring-[#C9A84C]"
                          : "text-[#1B2A4A] hover:bg-[#F4F6FA]"
                      }`}
                    >
                      {sub.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
                </div>
              )}
            </div>

            {/* Advanced: Statement + Type */}
            <div className="rounded-xl border border-[#E8ECF0] bg-[#FAFBFC]">
              <button type="button" onClick={() => setSidebarSections(s => ({ ...s, advanced: !s.advanced }))}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left text-xs font-semibold text-[#1B2A4A]">
                More filters
                <span className="text-[#9AA5B4]">{sidebarSections.advanced ? "−" : "+"}</span>
              </button>
              {sidebarSections.advanced && (
                <div className="space-y-3 border-t border-[#E8ECF0] px-3 pb-3 pt-2">
            <div>
              <p className="mb-1.5 text-[10px] font-medium text-[#9AA5B4]">Statement</p>
              <select
                value={docFilter}
                onChange={e => setDocFilter(e.target.value)}
                className="h-9 w-full rounded-lg border border-[#E8ECF0] bg-[#F9FAFC] px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
              >
                <option value="all">All Statements</option>
                {documents
                  .slice()
                  .sort((a, b) => (b.statementEnd || "").localeCompare(a.statementEnd || ""))
                  .map(d => (
                    <option key={d.id} value={d.id}>
                      {(d.fileName || d.id).replace("-parsed.json", "")}
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <p className="mb-1.5 text-[10px] font-medium text-[#9AA5B4]">Type</p>
              <div className="grid grid-cols-2 gap-1">
                {[
                  ["all",      "All"],
                  ["income",   "Income"],
                  ["expense",  "Expense"],
                  ["transfer", "Transfer"],
                  ["refund",   "Refund"],
                ].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setTypeFilter(val)}
                    className={`rounded-lg border px-2 py-1.5 text-[11px] font-medium transition ${
                      typeFilter === val ? "border-[#1B2A4A] bg-[#1B2A4A] text-white" : "border-[#E8ECF0] bg-white text-[#1B2A4A]"
                    } ${val === "all" ? "col-span-2" : ""}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
                </div>
              )}
            </div>

            <div className="border-t border-[#E8ECF0] pt-4 space-y-1">
              <Link
                href="/onboarding/review"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold text-[#9AA5B4] hover:bg-[#F4F6FA] hover:text-[#1B2A4A]"
              >
                ← Back to Review
              </Link>
            </div>
          </div>
        )}

        {/* Collapsed sidebar icons */}
        {!sidebarOpen && (
          <div className="flex flex-1 flex-col items-center gap-3 py-4">
            {activeFilters > 0 && (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#C9A84C] text-[9px] font-bold text-white">
                {activeFilters}
              </span>
            )}
          </div>
        )}
      </aside>

      {/* ── MAIN CONTENT ────────────────────────────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden">

        {/* ── KPI STRIP ─────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[#E8ECF0] bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex gap-3 flex-wrap">
              {isCreditCardView && creditKpis ? (
                // ── CREDIT CARD KPI MODE ───────────────────────────────────
                <>
                  {[
                    {
                      label: "Charges",
                      value: fmt(creditKpis.charges),
                      color: "#DC2626",
                      bg:    "rgba(220,38,38,0.07)",
                      icon:  "💳",
                      sub:   `${filtered.filter(t => t.type === "expense").length} purchases`,
                    },
                    {
                      label: "Payments",
                      value: fmt(creditKpis.payments),
                      color: "#16A34A",
                      bg:    "rgba(22,163,74,0.07)",
                      icon:  "✓",
                      sub:   creditKpis.payments >= creditKpis.charges
                        ? "Paid in full"
                        : `${fmt(creditKpis.charges - creditKpis.payments)} remaining`,
                    },
                    ...(creditKpis.refunds > 0 ? [{
                      label: "Refunds",
                      value: fmt(creditKpis.refunds),
                      color: "#2563EB",
                      bg:    "rgba(37,99,235,0.07)",
                      icon:  "↩",
                      sub:   "credited back",
                    }] : []),
                    {
                      label: "Balance Change",
                      value: `${creditKpis.netChange >= 0 ? "+" : "−"}${fmt(Math.abs(creditKpis.netChange))}`,
                      color: creditKpis.netChange <= 0 ? "#16A34A" : "#DC2626",
                      bg:    creditKpis.netChange <= 0
                        ? "rgba(22,163,74,0.07)"
                        : "rgba(220,38,38,0.07)",
                      icon:  creditKpis.netChange <= 0 ? "↓" : "↑",
                      sub:   creditKpis.netChange <= 0
                        ? "Balance decreased ✓"
                        : "Balance increased",
                    },
                    {
                      label: "Utilization",
                      value: `${creditKpis.utilization}%`,
                      color: utilizationColor(creditKpis.utilization),
                      bg:    `${utilizationColor(creditKpis.utilization)}12`,
                      icon:  "📊",
                      sub:   `${fmt(creditKpis.available)} available`,
                    },
                  ].map(kpi => (
                    <div
                      key={kpi.label}
                      className="min-w-[110px] rounded-xl px-4 py-3"
                      style={{ backgroundColor: kpi.bg }}
                    >
                      <p
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: kpi.color }}
                      >
                        {kpi.icon} {kpi.label}
                      </p>
                      <p className="mt-0.5 text-xl font-bold text-[#1B2A4A]">{kpi.value}</p>
                      <p className="text-[10px] text-[#9AA5B4]">{kpi.sub}</p>
                    </div>
                  ))}

                  {/* Credit card mode badge */}
                  <div className="ml-auto flex items-center self-center rounded-full border border-[#E4E8F0] bg-[#F9FAFC] px-3 py-1.5">
                    <span className="text-[10px] font-semibold text-[#9AA5B4]">
                      💳 Credit card view · {filteredAccount?.nickname}
                    </span>
                  </div>
                </>
              ) : (
                // ── STANDARD KPI MODE (checking / savings / all accounts) ─
                <>
                  {[
                    {
                      label: "Income",
                      value: fmt(kpis.income),
                      color: "#16A34A",
                      bg:    "rgba(22,163,74,0.07)",
                      icon:  "↑",
                      sub:   `${filtered.length} transactions`,
                    },
                    {
                      label: "Expenses",
                      value: fmt(kpis.expenses),
                      color: "#DC2626",
                      bg:    "rgba(220,38,38,0.07)",
                      icon:  "↓",
                      sub:   `${filtered.length} transactions`,
                    },
                    {
                      label: "Credit Used",
                      value: effectiveCardStats.length > 0 ? fmt(totalOwed) : "—",
                      color: effectiveCardStats.length > 0 ? utilizationColor(overallUtil) : "#9AA5B4",
                      bg:    effectiveCardStats.length > 0 ? `${utilizationColor(overallUtil)}12` : "rgba(154,165,180,0.08)",
                      icon:  "💳",
                      sub:   effectiveCardStats.length > 0 ? `${overallUtil}% of ${fmt(totalLimit)}` : "—",
                    },
                    {
                      label: "Net",
                      value: fmt(kpis.net),
                      color: kpis.net >= 0 ? "#16A34A" : "#DC2626",
                      bg:    kpis.net >= 0
                        ? "rgba(22,163,74,0.07)"
                        : "rgba(220,38,38,0.07)",
                      icon:  "=",
                      sub:   `${filtered.length} transactions`,
                    },
                    {
                      label: "Savings Rate",
                      value: `${kpis.rate}%`,
                      color: "#C9A84C",
                      bg:    "rgba(201,168,76,0.07)",
                      icon:  "%",
                      sub:   `${filtered.length} transactions`,
                    },
                    {
                      label: "Moved",
                      value: fmt(kpis.moved),
                      color: "#2563EB",
                      bg:    "rgba(37,99,235,0.07)",
                      icon:  "↔",
                      sub:   `${filtered.length} transactions`,
                    },
                  ].map(kpi => (
                    <div
                      key={kpi.label}
                      className="min-w-[110px] rounded-xl px-4 py-3"
                      style={{ backgroundColor: kpi.bg }}
                    >
                      <p
                        className="text-[10px] font-bold uppercase tracking-widest"
                        style={{ color: kpi.color }}
                      >
                        {kpi.icon} {kpi.label}
                      </p>
                      <p className="mt-0.5 text-xl font-bold text-[#1B2A4A]">{kpi.value}</p>
                      <p className="text-[10px] text-[#9AA5B4]">{kpi.sub}</p>
                    </div>
                  ))}
                </>
              )}
            </div>

            {!isCreditCardView && (
              <div className="shrink-0 relative flex h-14 w-14 items-center justify-center">
                <svg viewBox="0 0 36 36" className="h-14 w-14 -rotate-90">
                  <circle cx="18" cy="18" r="15.9" fill="none" stroke="#F4F6FA" strokeWidth="3" />
                  <circle
                    cx="18" cy="18" r="15.9" fill="none"
                    stroke={kpis.rate >= 20 ? "#C9A84C" : kpis.rate >= 0 ? "#F59E0B" : "#EF4444"}
                    strokeWidth="3"
                    strokeDasharray={`${Math.max(0, Math.min(100, kpis.rate))} 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute text-center">
                  <p className="text-[10px] font-semibold text-[#1B2A4A]">{kpis.rate}%</p>
                  <p className="text-[8px] text-[#9AA5B4]">saved</p>
                </div>
              </div>
            )}
          </div>

          {/* Unified credit card selector */}
          {creditCards.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#E8ECF0] pt-4">
              <span className="text-[10px] font-medium text-[#9AA5B4]">Credit Cards:</span>
              <button
                type="button"
                onClick={() => setAccountFilter("all")}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${accountFilter === "all" ? "bg-[#1B2A4A] text-white" : "bg-[#F4F6FA] text-[#1B2A4A] hover:bg-[#E8ECF0]"}`}
              >
                All
              </button>
              {creditCards.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setAccountFilter(c.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${accountFilter === c.id ? "text-white" : "bg-[#F4F6FA] text-[#1B2A4A] hover:bg-[#E8ECF0]"}`}
                  style={accountFilter === c.id ? { backgroundColor: c.color } : undefined}
                >
                  {c.nickname}
                </button>
              ))}
            </div>
          )}

          {/* Other accounts (checking, savings, etc.) */}
          {otherAccounts.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-medium text-[#9AA5B4]">Accounts:</span>
              {otherAccounts.map(acc => (
                <button
                  key={acc.id}
                  type="button"
                  onClick={() => setAccountFilter(acc.id)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${accountFilter === acc.id ? "text-white" : "bg-[#F4F6FA] text-[#1B2A4A] hover:bg-[#E8ECF0]"}`}
                  style={accountFilter === acc.id ? { backgroundColor: acc.color } : undefined}
                >
                  {acc.nickname}
                </button>
              ))}
            </div>
          )}

          {/* Date & search */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[#E8ECF0] pt-4">
            <span className="text-[10px] font-medium text-[#9AA5B4]">Date & search:</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search merchant..."
              className="h-8 min-w-[120px] max-w-[180px] rounded-lg border border-[#E8ECF0] bg-white px-2.5 text-[11px] text-[#1B2A4A] placeholder:text-[#9AA5B4] focus:border-[#C9A84C] focus:outline-none"
            />
            {[["month","Month"],["last","Last"],["3m","3m"],["6m","6m"],["all","All"]].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => applyPreset(val)}
                className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition ${datePreset === val ? "bg-[#1B2A4A] text-white" : "bg-[#F4F6FA] text-[#1B2A4A] hover:bg-[#E8ECF0]"}`}
              >
                {label}
              </button>
            ))}
            <input
              type="date"
              value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setDatePreset(""); }}
              className="h-8 rounded-lg border border-[#E8ECF0] bg-white px-2 text-[11px] text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none"
            />
            <input
              type="date"
              value={dateTo}
              onChange={e => { setDateTo(e.target.value); setDatePreset(""); }}
              className="h-8 rounded-lg border border-[#E8ECF0] bg-white px-2 text-[11px] text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none"
            />
          </div>
        </div>

        {/* ── TABS ─────────────────────────────────────────────── */}
        <div className="shrink-0 border-b border-[#E8ECF0] bg-white px-6">
          <div className="flex gap-6">
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
              {accountFilter === "all" && cashFlowTrailing3 && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-sm">
                  <h3 className="mb-4 text-sm font-bold text-[#1B2A4A]">
                    Cash Flow — &ldquo;Are we living within our means?&rdquo;
                  </h3>
                  <p className="mb-4 text-[11px] text-[#9AA5B4]">
                    Trailing 3‑month average · Victoria&apos;s income varies, so this is more honest than any single month
                  </p>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-green-100 bg-green-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">
                        Combined income
                      </p>
                      <p className="mt-1 text-2xl font-bold text-green-700">
                        {fmtFull(cashFlowTrailing3.avgIncome)}/mo
                      </p>
                      <p className="mt-1 text-[10px] text-[#9AA5B4]">
                        {[
                          ...members.map(m => {
                            const amt = cashFlowTrailing3.incomeByPerson[m.uid] ?? 0;
                            if (amt === 0) return null;
                            const name = m.firstName || m.displayName || "Member";
                            return `${name} ${fmtFull(amt)}`;
                          }),
                          ...(cashFlowTrailing3.incomeByPerson["joint"] ? [`Joint ${fmtFull(cashFlowTrailing3.incomeByPerson["joint"])}`] : []),
                        ].filter(Boolean).join(" + ") || "—"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-red-100 bg-red-50 p-4">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-red-600">
                        Expenses
                      </p>
                      <p className="mt-1 text-2xl font-bold text-red-700">
                        {fmtFull(cashFlowTrailing3.avgExpenses)}/mo
                      </p>
                    </div>
                    <div className={`rounded-xl border p-4 ${
                      cashFlowTrailing3.avgNet >= 0
                        ? "border-green-100 bg-green-50"
                        : "border-red-100 bg-red-50"
                    }`}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Net
                      </p>
                      <p className={`mt-1 text-2xl font-bold ${
                        cashFlowTrailing3.avgNet >= 0 ? "text-green-700" : "text-red-700"
                      }`}>
                        {cashFlowTrailing3.avgNet >= 0 ? "+" : "−"}
                        {fmtFull(Math.abs(cashFlowTrailing3.avgNet))}
                      </p>
                      <p className="mt-1 text-[10px] text-[#9AA5B4]">
                        ← the number that matters most
                      </p>
                    </div>
                    <div className={`rounded-xl border p-4 ${
                      cashFlowTrailing3.savingsRate >= 15
                        ? "border-green-100 bg-green-50"
                        : cashFlowTrailing3.savingsRate >= 5
                          ? "border-amber-100 bg-amber-50"
                          : "border-red-100 bg-red-50"
                    }`}>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Savings rate
                      </p>
                      <p className={`mt-1 text-2xl font-bold ${
                        cashFlowTrailing3.savingsRate >= 15 ? "text-green-700"
                        : cashFlowTrailing3.savingsRate >= 5 ? "text-amber-700"
                        : "text-red-700"
                      }`}>
                        {cashFlowTrailing3.savingsRate}%
                      </p>
                      <p className="mt-1 text-[10px] text-[#9AA5B4]">
                        Dave Ramsey target: 15%+
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* ── HOUSEHOLD DEBT (consolidated: credit cards + loans) ───── */}
              {accountFilter === "all" && (
                <div className="rounded-2xl border border-[#E4E8F0] bg-white p-5">
                  <div className="mb-4 flex items-start justify-between">
                    <div>
                      <h3 className="text-sm font-bold text-[#1B2A4A]">💸 Household Debt: Is the hole getting smaller?</h3>
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
                          setShowAddLoan(true);
                          setLoanDraft({ type: "other", active: true, assignedTo: user?.uid ?? "" });
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
                          <p className="text-[10px] font-semibold uppercase tracking-widest text-[#9AA5B4]">Debt breakdown</p>
                          {debtPieData.map((entry) => (
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

                      {/* Payment order (when no segment selected) or full card (when segment selected) */}
                      <div className="min-w-0 flex-1 border-l border-[#E4E8F0] pl-6">
                        {selectedDebtItem ? (
                          selectedDebtItem.type === "credit" ? (
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
                          )
                        ) : (
                            <div className="rounded-xl border border-[#E8ECF0] bg-white p-4">
                              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                                Order of payment
                                {loanSortMode === "snowball" && " · Snowball (smallest first)"}
                                {loanSortMode === "avalanche" && " · Avalanche (highest rate first)"}
                                {loanSortMode === "type" && " · By type"}
                              </p>
                              <div className="space-y-2">
                                {paymentOrder.map((entry, idx) => (
                                  <button
                                    key={`${entry.type}-${entry.id}`}
                                    type="button"
                                    onClick={() => setSelectedDebtItem({ type: entry.type, id: entry.id })}
                                    className="flex w-full items-center gap-3 rounded-lg border border-[#E4E8F0] px-3 py-2 text-left text-[11px] transition hover:bg-[#F9FAFC]"
                                  >
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#1B2A4A] text-[9px] font-bold text-white">
                                      {idx + 1}
                                    </span>
                                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                                    <span className="min-w-0 flex-1 truncate font-medium text-[#1B2A4A]">{entry.name}</span>
                                    <span className="shrink-0 text-[#9AA5B4]">{fmt(entry.value)}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                    </div>
                  )}

                </div>
              )}

              {/* Top spending categories */}
              <div className="rounded-2xl border border-[#E8ECF0] bg-white p-6 shadow-sm">
                <h3 className="mb-4 text-sm font-semibold text-[#1B2A4A]">Top spending</h3>
                {categoryData.length === 0 ? (
                  <p className="text-sm text-[#9AA5B4]">No expense data in this period.</p>
                ) : (
                  <div className="space-y-2.5">
                    {categoryData.slice(0, 6).map(cat => {
                      const pct = Math.round((cat.value / kpis.expenses) * 100);
                      return (
                        <button
                          key={cat.name}
                          type="button"
                          onClick={() => { setCategoryFilter(cat.name); setActiveTab("categories"); }}
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

              {/* Per person breakdown */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {members.map(m => {
                  const mTxns = filtered.filter(t => t.assignedTo === m.uid);
                  const mIncome   = mTxns.filter(t => t.type === "income" || t.type === "refund").reduce((s,t) => s+t.amount, 0);
                  const mExpenses = mTxns.filter(t => t.type === "expense").reduce((s,t) => s+t.amount, 0);
                  const name = m.firstName || m.displayName || "Member";
                  return (
                    <div key={m.uid} className="rounded-2xl border border-[#E8ECF0] bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1B2A4A] text-sm font-bold text-white">
                          {name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-bold text-[#1B2A4A]">{name}</p>
                          <p className="text-[10px] text-[#9AA5B4]">{mTxns.length} transactions</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl bg-green-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-green-600">Income</p>
                          <p className="text-lg font-bold text-[#1B2A4A]">{fmt(mIncome)}</p>
                        </div>
                        <div className="rounded-xl bg-red-50 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-wide text-red-600">Expenses</p>
                          <p className="text-lg font-bold text-[#1B2A4A]">{fmt(mExpenses)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
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
      </main>
    </div>
  );
}
