/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/ban-ts-comment */
// @ts-nocheck
"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { useAuth } from "@/app/hooks/useAuth";
import { CATEGORIES, getCategoryColor, getCategoryEmoji } from "@/app/lib/categories";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import { useTransactions } from "@/app/hooks/useTransactions";
import { db } from "@/app/lib/firebase";

type Risk = {
  title: string;
  description: string;
  severity: "high" | "medium" | "low";
};

type CategoryRow = {
  category: string;
  amount: number;
  recommendedBudget: number;
  status: "over" | "under" | "on-track";
  insight: string;
};

type DebtRow = {
  name: string;
  balance: number;
  rate: number;
  monthlyPayment: number;
  payoffMonths: number;
};

type ReportData = {
  id: string;
  status: "partial" | "complete";
  missingMembers: string[];
  generatedAt?: { seconds?: number };
  household?: { name?: string };
  healthScore: number;
  healthGrade: "A" | "B" | "C" | "D" | "F";
  summary: string;
  strengths: string[];
  income: { combined: number; byMember: Array<{ name: string; amount: number }> };
  topRisks: Risk[];
  categoryBreakdown: CategoryRow[];
  debtSummary: DebtRow[];
  recommendedBudget: { totalIncome: number; categories: Record<string, number> };
  keyInsights: string[];
  quickWins: string[];
  encouragement: string;
  transactionCount?: number;
  monthlyReports?: Array<{
    month: string;
    monthName: string;
    income: number;
    expenses: number;
    net: number;
    savingsRate: number;
    transactionCount: number;
    vsAveragePercent: number;
    categoryBreakdown: Array<{
      category: string;
      emoji: string;
      total: number;
      subcategories: Array<{ name: string; amount: number }>;
      topMerchants: Array<{ name: string; amount: number }>;
    }>;
    topExpenses: Array<{
      merchant: string;
      amount: number;
      category: string;
      subcat: string | null;
      date: string;
    }>;
    summary: string;
    topWin: string;
    topConcern: string;
    subcategoryInsight?: string;
    merchantInsight?: string;
    commentInsights?: string | null;
    trend: "improving" | "declining" | "stable";
    healthScore: number;
    healthGrade: "A" | "B" | "C" | "D" | "F";
  }>;
};

type Tx = {
  id: string;
  date: string;
  desc: string;
  amount: number;
  type: "income" | "expense" | "transfer" | "refund";
  category: string;
  subcat: string;
  account: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}

function formatMonth(month: string) {
  if (month === "all") return "All Time";
  const [year, monthNum] = month.split("-");
  const date = new Date(Number(year), Number(monthNum) - 1, 1);
  return date.toLocaleString("en-US", { month: "short", year: "numeric" });
}

function scoreColor(score: number) {
  if (score >= 80) return "#16A34A";
  if (score >= 60) return "#D4A53A";
  if (score >= 40) return "#F97316";
  return "#DC2626";
}

function severityStyles(severity: Risk["severity"]) {
  if (severity === "high") return "border-red-400 bg-red-50 text-red-700";
  if (severity === "medium") return "border-yellow-400 bg-yellow-50 text-yellow-700";
  return "border-blue-400 bg-blue-50 text-blue-700";
}

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportId = searchParams.get("reportId");
  const { user, loading: authLoading } = useAuth();

  const [householdId, setHouseholdId] = useState("");
  const [report, setReport] = useState<ReportData | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState("");
  const [selectedMonth, setSelectedMonth] = useState("all");
  const [expandedCategory, setExpandedCategory] = useState("");
  const [chartCategory, setChartCategory] = useState("");
  const [chartSubcategory, setChartSubcategory] = useState("");
  const [selectedTxId, setSelectedTxId] = useState("");
  const [editingTxId, setEditingTxId] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editSubcat, setEditSubcat] = useState("");
  const [expandedMonth, setExpandedMonth] = useState("");

  const { transactions, loading: loadingTransactions } = useTransactions(householdId || undefined);
  const subcatOptions = useMemo(
    () => ({
      transactions: transactions.map((t) => ({ category: t.category, subcat: t.subcat })),
    }),
    [transactions],
  );
  const { subcatsByParent } = useSubcategories(householdId || undefined, subcatOptions);

  useEffect(() => {
    const loadReport = async () => {
      if (!user || !reportId) return;

      setLoadingContext(true);
      setError("");
      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data() ?? {};
        const hid = typeof userData.householdId === "string" ? userData.householdId : "";
        if (!hid) throw new Error("No household found for your account.");
        setHouseholdId(hid);

        const reportRef = doc(db, "households", hid, "reports", reportId);
        const reportSnap = await getDoc(reportRef);
        if (!reportSnap.exists()) throw new Error("Report not found.");
        const reportData = reportSnap.data() as Omit<ReportData, "id">;
        setReport({ ...reportData, id: reportSnap.id });

        await updateDoc(userRef, { onboardingStep: "complete" });
      } catch (loadError) {
        const message = loadError instanceof Error ? loadError.message : "Could not load report.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };

    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!authLoading && user && reportId) {
      void loadReport();
    }
  }, [authLoading, user, reportId, router]);

  const monthOptions = useMemo(() => {
    const months = Array.from(
      new Set(
        transactions
          .map((tx) => (tx.date ? tx.date.slice(0, 7) : ""))
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return ["all", ...months];
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    if (selectedMonth === "all") return transactions;
    return transactions.filter((tx) => tx.date.startsWith(selectedMonth));
  }, [transactions, selectedMonth]);

  const totals = useMemo(() => {
    const income = filteredTransactions.reduce(
      (sum, tx) => (tx.type === "income" || tx.type === "refund" ? sum + tx.amount : sum),
      0,
    );
    const expenses = filteredTransactions.reduce(
      (sum, tx) => (tx.type === "expense" || tx.type === "transfer" ? sum + tx.amount : sum),
      0,
    );
    return { income, expenses, net: income - expenses };
  }, [filteredTransactions]);

  const liveCategoryBreakdown = useMemo(() => {
    const map = new Map<string, { amount: number; transactions: Tx[]; subcats: Record<string, number> }>();
    for (const tx of filteredTransactions) {
      const entry = map.get(tx.category) ?? { amount: 0, transactions: [], subcats: {} };
      entry.amount += tx.amount;
      entry.transactions.push(tx);
      const subcat = tx.subcat?.trim() || "Uncategorized";
      entry.subcats[subcat] = (entry.subcats[subcat] || 0) + tx.amount;
      map.set(tx.category, entry);
    }
    return Array.from(map.entries())
      .map(([category, data]) => ({
        category,
        amount: data.amount,
        transactions: data.transactions.sort((a, b) => b.amount - a.amount),
        subcats: Object.entries(data.subcats)
          .map(([name, amount]) => ({ name, amount }))
          .sort((a, b) => b.amount - a.amount),
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [filteredTransactions]);

  const chartData = useMemo(
    () =>
      liveCategoryBreakdown.map((row) => ({
        name: row.category,
        value: row.amount,
      })),
    [liveCategoryBreakdown],
  );

  const chartSubcategoryData = useMemo(() => {
    if (!chartCategory) return [];
    const match = liveCategoryBreakdown.find((row) => row.category === chartCategory);
    return (match?.subcats ?? []).map((s) => ({ name: s.name, value: s.amount }));
  }, [chartCategory, liveCategoryBreakdown]);

  const monthlyTrend = useMemo(() => {
    const map = new Map<string, { income: number; expenses: number }>();
    for (const tx of transactions) {
      const month = tx.date ? tx.date.slice(0, 7) : "unknown";
      const row = map.get(month) ?? { income: 0, expenses: 0 };
      if (tx.type === "income" || tx.type === "refund") row.income += tx.amount;
      if (tx.type === "expense" || tx.type === "transfer") row.expenses += tx.amount;
      map.set(month, row);
    }
    return Array.from(map.entries())
      .map(([month, row]) => ({ month, income: row.income, expenses: row.expenses }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [transactions]);

  const chartTransactions = useMemo(() => {
    if (!chartCategory) return [];
    const inCategory = filteredTransactions.filter((tx) => tx.category === chartCategory);
    if (!chartSubcategory) return inCategory.sort((a, b) => b.amount - a.amount);
    return inCategory
      .filter((tx) => (tx.subcat?.trim() || "Uncategorized") === chartSubcategory)
      .sort((a, b) => b.amount - a.amount);
  }, [chartCategory, chartSubcategory, filteredTransactions]);

  const selectedTransaction = useMemo(
    () => filteredTransactions.find((tx) => tx.id === selectedTxId) ?? null,
    [filteredTransactions, selectedTxId],
  );

  const regenerateReport = async () => {
    if (!householdId) return;
    try {
      setRegenerating(true);
      setError("");
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ householdId }),
      });
      const data = (await response.json()) as { success: boolean; reportId?: string; error?: string };
      if (!response.ok || !data.success || !data.reportId) {
        throw new Error(data.error || "Could not regenerate report.");
      }
      router.replace(`/onboarding/report?reportId=${data.reportId}`);
    } catch (regenError) {
      const message =
        regenError instanceof Error ? regenError.message : "Could not regenerate report.";
      setError(message);
    } finally {
      setRegenerating(false);
    }
  };

  const saveTransactionCategory = async () => {
    if (!householdId || !editingTxId || !editCategory) return;
    try {
      await updateDoc(doc(db, "households", householdId, "transactions", editingTxId), {
        category: editCategory,
        subcat: editSubcat,
      });
      setEditingTxId("");
      setSelectedTxId(editingTxId);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not update transaction category.";
      setError(message);
    }
  };

  if (authLoading || loadingContext || loadingTransactions) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-4xl space-y-4">
          <div className="h-24 animate-pulse rounded-2xl bg-[#F4F6FA]" />
          <div className="h-80 animate-pulse rounded-2xl bg-[#F4F6FA]" />
          <div className="h-64 animate-pulse rounded-2xl bg-[#F4F6FA]" />
        </div>
      </div>
    );
  }

  if (!user || !report) return null;

  const generatedDate = report.generatedAt?.seconds
    ? new Date(report.generatedAt.seconds * 1000).toLocaleString()
    : "—";
  const membersWithDataNames = report.income?.byMember?.map((m) => m.name).join(", ") || "your household";

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl space-y-5">
        {report.status === "partial" ? (
          <section className="rounded-2xl border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-900">
            <p>
              ⚠️ This report only includes data from {membersWithDataNames}. Invite{" "}
              {report.missingMembers?.join(", ") || "your spouse"} to join and regenerate for your
              complete household picture.
            </p>
            <button
              type="button"
              onClick={() => void regenerateReport()}
              disabled={regenerating}
              className="mt-3 inline-flex h-10 items-center justify-center rounded-lg border border-yellow-500 px-3 text-sm font-semibold text-yellow-900"
            >
              {regenerating ? "Regenerating..." : "Regenerate Report"}
            </button>
          </section>
        ) : null}

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-[#1B2A4A]">Filter by month</p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {monthOptions.map((month) => (
              <button
                key={month}
                type="button"
                onClick={() => setSelectedMonth(month)}
                className={`shrink-0 rounded-full px-3 py-2 text-sm font-medium ${
                  selectedMonth === month
                    ? "bg-[#C9A84C] text-[#1B2A4A]"
                    : "bg-[#F4F6FA] text-[#1B2A4A]/80"
                }`}
              >
                {formatMonth(month)}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-bold">Your Financial Health Report</h1>
          <p className="mt-2 text-sm text-[#1B2A4A]/75">Generated: {generatedDate}</p>
          <p className="text-sm text-[#1B2A4A]/75">Household: {report.household?.name || "Your Household"}</p>
          <span className="mt-3 inline-flex rounded-full bg-[#F4F6FA] px-3 py-1 text-xs font-semibold">
            {report.status === "partial" ? "Partial Report" : "Complete Report"}
          </span>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Financial Health Score</h2>
          <div className="grid gap-5 md:grid-cols-2 md:items-center">
            <div className="mx-auto flex h-48 w-48 items-center justify-center rounded-full border-8"
              style={{ borderColor: scoreColor(report.healthScore) }}>
              <div className="text-center">
                <p className="text-5xl font-bold">{report.healthScore}</p>
                <p className="text-lg font-semibold">{report.healthGrade}</p>
              </div>
            </div>
            <div className="space-y-3">
              <p className="text-sm text-[#1B2A4A]/85">{report.summary}</p>
              <ul className="space-y-1 text-sm">
                {(report.strengths ?? []).map((s, i) => (
                  <li key={i}>✅ {s}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Income Breakdown</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl bg-[#F9FAFC] p-4">
              <p className="text-sm text-[#1B2A4A]/70">
                {selectedMonth === "all" ? "All-Time Income" : `${formatMonth(selectedMonth)} Income`}
              </p>
              <p className="mt-1 text-2xl font-bold text-green-700">{formatMoney(totals.income)}</p>
              <ul className="mt-3 space-y-1 text-sm">
                {(report.income?.byMember ?? []).map((m) => (
                  <li key={m.name} className="flex justify-between">
                    <span>{m.name}</span>
                    <span>{formatMoney(m.amount || 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-xl bg-[#F9FAFC] p-4">
              <p className="text-sm text-[#1B2A4A]/70">Income vs Expenses</p>
              <p className="mt-1 text-sm text-green-700">Income: {formatMoney(totals.income)}</p>
              <p className="text-sm text-red-600">Expenses: {formatMoney(totals.expenses)}</p>
              <p
                className={`mt-2 text-lg font-semibold ${
                  totals.net >= 0 ? "text-green-700" : "text-red-600"
                }`}
              >
                Net: {formatMoney(totals.net)}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Monthly Trend</h2>
          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v: number) => formatMoney(v)} />
                <Legend />
                <Bar
                  dataKey="income"
                  fill="#C9A84C"
                  onClick={(state) => {
                    const month = state?.month as string | undefined;
                    if (month) setSelectedMonth(month);
                  }}
                />
                <Bar
                  dataKey="expenses"
                  fill="#1B2A4A"
                  onClick={(state) => {
                    const month = state?.month as string | undefined;
                    if (month) setSelectedMonth(month);
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Month-by-Month Health</h2>
          <div className="space-y-3">
            {(report.monthlyReports ?? []).map((monthReport) => {
              const isOpen = expandedMonth === monthReport.month;
              return (
                <article key={monthReport.month} className="rounded-xl bg-[#F9FAFC] p-4">
                  <button
                    type="button"
                    onClick={() => setExpandedMonth(isOpen ? "" : monthReport.month)}
                    className="flex w-full items-center justify-between text-left"
                  >
                    <div>
                      <p className="font-semibold">{monthReport.monthName}</p>
                      <p className="text-sm text-[#1B2A4A]/70">
                        Score {monthReport.healthScore} ({monthReport.healthGrade}) •{" "}
                        {monthReport.trend}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#1B2A4A]/80">
                      {isOpen ? "▲ Hide" : "▼ View"}
                    </span>
                  </button>

                  <div
                    className={`grid transition-all duration-300 ${
                      isOpen ? "mt-4 grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      {isOpen ? (
                        <div className="space-y-3 text-sm">
                          <p>{monthReport.summary}</p>
                          <p>✅ {monthReport.topWin}</p>
                          <p>⚠️ {monthReport.topConcern}</p>
                          <p>🔍 {monthReport.subcategoryInsight || "No subcategory insight."}</p>
                          <p>🏪 {monthReport.merchantInsight || "No merchant insight."}</p>
                          {monthReport.commentInsights ? <p>💬 {monthReport.commentInsights}</p> : null}
                          <span className="inline-flex rounded-full bg-[#F4F6FA] px-2 py-1 text-xs font-semibold">
                            Trend: {monthReport.trend}
                          </span>

                          <div className="rounded-lg bg-white p-3">
                            <p className="mb-2 font-semibold">Top 5 expenses</p>
                            <ul className="space-y-1">
                              {(monthReport.topExpenses ?? []).map((tx, idx) => (
                                <li key={`${tx.merchant}-${idx}`} className="flex justify-between">
                                  <span>
                                    {tx.merchant} | {tx.category}
                                  </span>
                                  <span>{formatMoney(tx.amount)}</span>
                                </li>
                              ))}
                            </ul>
                          </div>

                          <div className="rounded-lg bg-white p-3">
                            <p className="mb-2 font-semibold">Category + subcategory breakdown</p>
                            <div className="space-y-2">
                              {(monthReport.categoryBreakdown ?? []).map((cat) => (
                                <div key={cat.category} className="rounded-md bg-[#F9FAFC] p-2">
                                  <p className="font-medium">
                                    {cat.emoji} {cat.category} — {formatMoney(cat.total)}
                                  </p>
                                  <ul className="mt-1 text-xs text-[#1B2A4A]/80">
                                    {(cat.subcategories ?? []).map((sub, i) => (
                                      <li key={`${sub.name}-${i}`} className="flex justify-between">
                                        <span>{sub.name}</span>
                                        <span>{formatMoney(sub.amount)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
            {(report.monthlyReports ?? []).length === 0 ? (
              <p className="text-sm text-[#1B2A4A]/70">No monthly analysis available yet.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Spending Breakdown</h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {chartCategory ? (
                    <BarChart data={chartSubcategoryData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" />
                      <YAxis />
                      <Tooltip formatter={(v: number) => formatMoney(v)} />
                      <Bar
                        dataKey="value"
                        fill={getCategoryColor(chartCategory)}
                        onClick={(state) => {
                          const subcat = state?.name as string | undefined;
                          if (subcat) setChartSubcategory(subcat);
                        }}
                      />
                    </BarChart>
                  ) : (
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={95}
                        labelLine={false}
                        onClick={(slice) => {
                          const category = slice?.name as string | undefined;
                          if (category) {
                            setChartCategory(category);
                            setChartSubcategory("");
                          }
                        }}
                      >
                        {chartData.map((entry) => (
                          <Cell key={entry.name} fill={getCategoryColor(entry.name)} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value: number) => formatMoney(value)} />
                      <Legend />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
              {chartCategory ? (
                <button
                  type="button"
                  onClick={() => {
                    setChartCategory("");
                    setChartSubcategory("");
                  }}
                  className="text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
                >
                  ← Back to categories
                </button>
              ) : null}
            </div>

            <div className="space-y-2 text-sm">
              {chartCategory ? (
                <div className="rounded-xl bg-[#F9FAFC] p-3">
                  <p className="font-semibold">
                    {getCategoryEmoji(chartCategory)} {chartCategory}
                  </p>
                  <ul className="mt-2 space-y-1">
                    {chartSubcategoryData.map((s) => {
                      const total = chartSubcategoryData.reduce((sum, row) => sum + row.value, 0) || 1;
                      const percent = ((s.value / total) * 100).toFixed(1);
                      return (
                        <li key={s.name} className="flex justify-between">
                          <span>{s.name}</span>
                          <span>
                            {formatMoney(s.value)} ({percent}%)
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                liveCategoryBreakdown.map((c) => (
                  <div key={c.category} className="flex items-center justify-between rounded-xl bg-[#F9FAFC] p-3">
                    <span>
                      {getCategoryEmoji(c.category)} {c.category}
                    </span>
                    <span>{formatMoney(c.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </div>

          {chartCategory ? (
            <div className="mt-5 rounded-xl bg-[#F9FAFC] p-4">
              <h3 className="mb-2 text-sm font-semibold">Transactions</h3>
              <div className="space-y-2 text-sm">
                {chartTransactions.map((tx) => (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => setSelectedTxId(tx.id)}
                    className="flex w-full items-center justify-between rounded-lg bg-white p-3 text-left"
                  >
                    <span>
                      {tx.date} | {tx.desc}
                    </span>
                    <span>{formatMoney(tx.amount)}</span>
                  </button>
                ))}
                {chartTransactions.length === 0 ? (
                  <p className="text-[#1B2A4A]/70">No transactions for this selection.</p>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Category Cards</h2>
          <div className="space-y-3">
            {liveCategoryBreakdown.map((row) => {
              const recommended =
                report.recommendedBudget?.categories?.[row.category] ??
                report.categoryBreakdown?.find((c) => c.category === row.category)?.recommendedBudget ??
                0;
              const progress = recommended > 0 ? Math.min(100, (row.amount / recommended) * 100) : 0;
              const isExpanded = expandedCategory === row.category;
              return (
                <article key={row.category} className="rounded-xl bg-[#F9FAFC] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        {getCategoryEmoji(row.category)} {row.category}
                      </p>
                      <p className="text-sm">{formatMoney(row.amount)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setExpandedCategory(isExpanded ? "" : row.category)}
                      className="text-sm font-semibold text-[#1B2A4A] underline underline-offset-2"
                    >
                      {isExpanded ? "▲ Hide transactions" : "▼ See transactions"}
                    </button>
                  </div>
                  <div className="mt-3 h-2 w-full rounded-full bg-white">
                    <div className="h-2 rounded-full bg-[#C9A84C]" style={{ width: `${progress}%` }} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {row.subcats.map((s) => (
                      <span key={s.name} className="rounded-full bg-white px-2 py-1 text-xs">
                        {s.name}: {formatMoney(s.amount)}
                      </span>
                    ))}
                  </div>
                  <div
                    className={`grid transition-all duration-300 ${
                      isExpanded ? "mt-3 grid-rows-[1fr]" : "grid-rows-[0fr]"
                    }`}
                  >
                    <div className="overflow-hidden">
                      {isExpanded ? (
                        <div className="space-y-2">
                          {row.transactions.map((tx) => (
                            <button
                              key={tx.id}
                              type="button"
                              onClick={() => setSelectedTxId(tx.id)}
                              className="flex w-full items-center justify-between rounded-lg bg-white p-3 text-left text-sm"
                            >
                              <span>
                                {tx.date} | {tx.desc} | {tx.subcat || "Uncategorized"}
                              </span>
                              <span>{formatMoney(tx.amount)}</span>
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {selectedTransaction ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Transaction Detail</h2>
            <div className="space-y-2 rounded-xl bg-[#F9FAFC] p-4 text-sm">
              <p>
                <span className="font-semibold">Merchant:</span> {selectedTransaction.desc}
              </p>
              <p>
                <span className="font-semibold">Date:</span> {selectedTransaction.date}
              </p>
              <p>
                <span className="font-semibold">Amount:</span> {formatMoney(selectedTransaction.amount)}
              </p>
              <p>
                <span className="font-semibold">Category:</span> {selectedTransaction.category}
              </p>
              <p>
                <span className="font-semibold">Subcategory:</span>{" "}
                {selectedTransaction.subcat || "Uncategorized"}
              </p>
              <p>
                <span className="font-semibold">Account:</span> {selectedTransaction.account || "Unknown"}
              </p>
              {editingTxId === selectedTransaction.id ? (
                <div className="mt-3 space-y-2 rounded-lg bg-white p-3">
                  <select
                    value={editCategory}
                    onChange={(event) => {
                      setEditCategory(event.target.value);
                      setEditSubcat("");
                    }}
                    className="h-10 w-full rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category.name} value={category.name}>
                        {category.emoji} {category.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={editSubcat}
                    onChange={(event) => setEditSubcat(event.target.value)}
                    className="h-10 w-full rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
                  >
                    <option value="">No subcategory</option>
                    {(subcatsByParent[editCategory] ?? []).map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void saveTransactionCategory()}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-[#C9A84C] px-3 text-sm font-semibold text-[#1B2A4A]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingTxId("")}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-[#1B2A4A]/20 px-3 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingTxId(selectedTransaction.id);
                    setEditCategory(selectedTransaction.category);
                    setEditSubcat(selectedTransaction.subcat || "");
                  }}
                  className="mt-2 inline-flex h-10 items-center justify-center rounded-lg border border-[#C9A84C] px-3 text-sm font-semibold text-[#1B2A4A]"
                >
                  Edit category
                </button>
              )}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Top Risks</h2>
          <div className="space-y-3">
            {(report.topRisks ?? []).slice(0, 3).map((risk, idx) => (
              <article key={`${risk.title}-${idx}`} className={`rounded-xl border-l-4 p-4 ${severityStyles(risk.severity)}`}>
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{risk.title}</h3>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-semibold">
                    {risk.severity}
                  </span>
                </div>
                <p className="mt-1 text-sm">{risk.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Debt Snapshot</h2>
          {(report.debtSummary ?? []).length === 0 ? (
            <p className="rounded-xl bg-[#F9FAFC] p-4 text-sm">🎉 Your household has no significant debt!</p>
          ) : (
            <div className="space-y-3">
              {report.debtSummary.map((d, idx) => {
                const originalEstimate = d.balance > 0 ? d.balance * 1.25 : 1;
                const progress = Math.max(0, Math.min(100, ((originalEstimate - d.balance) / originalEstimate) * 100));
                return (
                  <article key={`${d.name}-${idx}`} className="rounded-xl bg-[#F9FAFC] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{d.name}</h3>
                      <span className="rounded-full bg-[#F4F6FA] px-2 py-0.5 text-xs font-semibold">
                        {d.rate}% APR
                      </span>
                    </div>
                    <p className="mt-1 text-sm">Balance: {formatMoney(d.balance)}</p>
                    <p className="text-sm">Monthly payment: {formatMoney(d.monthlyPayment)}</p>
                    <p className="text-sm">Payoff in {d.payoffMonths} months</p>
                    <div className="mt-2 h-2 w-full rounded-full bg-white">
                      <div className="h-2 rounded-full bg-[#C9A84C]" style={{ width: `${progress}%` }} />
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Key Insights</h2>
          <ul className="space-y-2">
            {(report.keyInsights ?? []).map((item, idx) => (
              <li key={idx} className="rounded-xl border-l-4 border-[#C9A84C] bg-[#F9FAFC] p-3 text-sm">
                💡 {item}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Quick Wins</h2>
          <div className="space-y-3">
            {(report.quickWins ?? []).map((item, idx) => (
              <article key={idx} className="rounded-xl bg-[#F9FAFC] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <input type="checkbox" readOnly />
                    <p className="text-sm">{item}</p>
                  </div>
                  <span className="rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-xs font-semibold text-[#1B2A4A]">
                    Do This
                  </span>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#1B2A4A]">Recommended Budget</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="text-left text-[#1B2A4A]/70">
                  <th className="py-2">Category</th>
                  <th className="py-2">Current Spending</th>
                  <th className="py-2">Recommended</th>
                  <th className="py-2">Difference</th>
                </tr>
              </thead>
              <tbody>
                {liveCategoryBreakdown.map((row) => {
                  const recommended =
                    report.recommendedBudget?.categories?.[row.category] ??
                    report.categoryBreakdown?.find((c) => c.category === row.category)?.recommendedBudget ??
                    0;
                  const diff = recommended - (row.amount || 0);
                  const status: "over" | "under" | "on-track" =
                    diff < 0 ? "over" : diff > 0 ? "under" : "on-track";
                  return (
                    <tr key={row.category} className="border-t border-[#F4F6FA]">
                      <td className="py-2">
                        {getCategoryEmoji(row.category)} {row.category}
                      </td>
                      <td className="py-2">{formatMoney(row.amount || 0)}</td>
                      <td className="py-2">{formatMoney(recommended)}</td>
                      <td
                        className={`py-2 font-medium ${
                          status === "over"
                            ? "text-red-600"
                            : status === "under"
                              ? "text-green-700"
                              : "text-[#C9A84C]"
                        }`}
                      >
                        {diff >= 0 ? "+" : "-"}
                        {formatMoney(Math.abs(diff))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-[#C9A84C] bg-white p-6 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold text-[#1B2A4A]">Encouragement</h2>
          <p className="text-sm italic text-[#1B2A4A]">👑 {report.encouragement}</p>
        </section>

        <section className="space-y-3 pb-4">
          <Link
            href="/dashboard"
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
          >
            Chat with AI Advisor →
          </Link>
          <button
            type="button"
            onClick={() => void regenerateReport()}
            disabled={regenerating}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#C9A84C] bg-white px-5 text-base font-semibold text-[#1B2A4A] transition hover:bg-[#FFF8E8]"
          >
            {regenerating ? "Regenerating..." : "Regenerate Report"}
          </button>
          <Link
            href="/onboarding/review"
            className="inline-block text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
          >
            Back to Transactions
          </Link>
        </section>
      </div>
    </div>
  );
}

export default function OnboardingReportPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-white">
          <div className="text-[#1B2A4A]">Loading report...</div>
        </div>
      }
    >
      <PageContent />
    </Suspense>
  );
}
