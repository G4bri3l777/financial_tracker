"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useAccounts, type AccountSubtype, type AccountType } from "@/app/hooks/useAccounts";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useMembers } from "@/app/hooks/useMembers";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import OnboardingProgressDots from "@/app/components/OnboardingProgressDots";
import AddTransactionForm from "@/app/components/AddTransactionForm";
import {
  CATEGORIES,
  CATEGORY_NAMES,
  getCategoryEmoji,
  getDefaultType,
  type TransactionType,
} from "@/app/lib/categories";
import { db } from "@/app/lib/firebase";

type Transaction = {
  id: string;
  date: string;
  desc: string;
  amount: number;
  type: TransactionType;
  category: string;
  assignedTo: string;
  assignedToName: string;
  comment: string;
  commentBy: string;
  reviewed: boolean;
  docId: string;
  flagged: boolean;
  flagReason: string;
  subcat: string;
  reviewedReason: string;
  accountId: string;
  accountLabel: string;
  transferType: "internal" | "external-own" | "external-third-party" | "card-payment" | "";
  transferTo: string;
  transferFrom: string;
  transferPairId: string;
  transferNote: string;
  addedManually: boolean;
  createdAt: unknown;
  // New fields from the ideal schema
  merchantName: string;
  direction: "debit" | "credit" | "";
  confidence: number;
  isSubscription: boolean;
  transferFromAccountId: string;
  transferToAccountId: string;
  sourceDocId: string;
  month: string;
  accountSnapshot?: { nickname?: string; bankName?: string; last4?: string; type?: string; color?: string } | null;
};

type SortKey = "date" | "desc" | "amount" | "category" | "assignedToName";
type TransactionPatch = Partial<Omit<Transaction, "id">> & {
  reviewedBy?: string;
  reviewedAt?: unknown;
};

type ReviewTab = "accounts" | "transactions";
type QuickFilter = "all" | "unreviewed" | "reviewed" | "flagged" | "no-account";
type TransferSubtypeFilter =
  | "all"
  | "internal"
  | "external-own"
  | "external-third-party"
  | "unclassified";
type AccountDraft = {
  id?: string;
  bankName: string;
  nickname: string;
  last4: string;
  creditLimit: string;
  type: AccountType;
  subtype: AccountSubtype;
  owner: string;
  ownerName: string;
  color: string;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function getTypePillClasses(type: TransactionType) {
  if (type === "income") return "bg-green-100 text-green-800";
  if (type === "transfer") return "bg-blue-100 text-blue-800";
  if (type === "refund") return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-700";
}

function isThirdPartyTransfer(tx: Pick<Transaction, "type" | "transferType">) {
  return tx.type === "transfer" && tx.transferType === "external-third-party";
}

function transferDirectionLabel(direction: string, type: string) {
  if (type !== "transfer") return null;
  return direction === "debit"
    ? { label: "↑ Sent", color: "#F97316", bg: "rgba(249,115,22,0.08)" }
    : { label: "↓ Received", color: "#16A34A", bg: "rgba(22,163,74,0.08)" };
}

function detectSuggestedTransferType(
  description: string,
  hasHouseholdAccount: boolean,
): "internal" | "external-third-party" | null {
  const text = description.toLowerCase();
  const internalKeywords = [
    "transfer to",
    "transfer from",
    "online transfer",
    "credit card payment",
    "card payment",
    "payment thank you",
    "autopay",
    "mobile transfer",
    "account transfer",
  ];
  const thirdPartyKeywords = [
    "zelle to",
    "venmo",
    "paypal",
    "cashapp",
    "wire transfer",
    "ach to",
    "send money",
  ];

  if (hasHouseholdAccount && internalKeywords.some((k) => text.includes(k))) {
    return "internal";
  }
  if (thirdPartyKeywords.some((k) => text.includes(k))) {
    return "external-third-party";
  }
  return null;
}

function toYmd(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ─── MONEY FLOW & ACCOUNT STATUS SECTION ──────────────────────────────────────

function AccountStatusBadge({ status }: { status: "healthy" | "watch" | "alert" }) {
  if (status === "healthy")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
        Healthy
      </span>
    );
  if (status === "watch")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Watch
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
      Alert
    </span>
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for future use
function MoneyFlowSectionUnused({
  accounts,
  transactions,
  onViewAccountTransactions,
}: {
  accounts: Array<{
    id: string;
    nickname: string;
    bankName: string;
    last4: string;
    type: string;
    color?: string;
    ownerName: string;
    creditLimit?: number | null;
  }>;
  transactions: Transaction[];
  onViewAccountTransactions: (accountId: string) => void;
}) {
  const fmt = (n: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(n);

  const fmtFull = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const accountStats = useMemo(() => {
  return accounts.map((acc) => {
    const txns = transactions.filter((t) => t.accountId === acc.id);
    const isCreditCard = acc.type === 'credit';

    // Real income = salary, dividends, gifts coming in
    const realIncome = txns.reduce((s, t) =>
      t.type === 'income' || t.type === 'refund' ? s + t.amount : s, 0);

    // Real expenses = actual purchases paid with this account
    const realExpenses = txns.reduce((s, t) =>
      t.type === 'expense' ? s + t.amount : s, 0);

    // Transfer direction depends on account type:
    // Credit card: transfers = payments RECEIVED (money coming IN to pay balance)
    // Checking/Savings: transfers = money SENT OUT to pay bills or move funds
    const transferAmount = txns.reduce((s, t) =>
      t.type === 'transfer' ? s + t.amount : s, 0);

    const transferSent = isCreditCard ? 0 : transferAmount;
    const transferRecv = isCreditCard ? transferAmount : 0;

    // NET for display:
    // Credit card: how much unpaid balance remains = charges - payments received
    // Checking/Savings: real income minus real direct expenses (transfers neutral)
    const creditBalance = isCreditCard
      ? Math.max(0, realExpenses - transferRecv)
      : 0;
    const net = isCreditCard
      ? -(creditBalance)  // negative = you owe money
      : realIncome - realExpenses;

    // Credit utilization based on ACTUAL balance (charges minus payments)
    const creditLimit = Number(acc.creditLimit ?? 0);
    const utilization = isCreditCard && creditLimit > 0
      ? Math.min(150, Math.round((creditBalance / creditLimit) * 100))
      : null;

    // Health status
    let status: 'healthy' | 'watch' | 'alert' = 'healthy';
    const unreviewedCount = txns.filter((t) => !t.reviewed).length;
    const flaggedCount = txns.filter((t) => t.flagged).length;
    if (flaggedCount > 0) status = 'alert';
    else if (utilization !== null && utilization > 60) status = 'alert';
    else if (utilization !== null && utilization > 30) status = 'watch';
    else if (unreviewedCount > 5) status = 'watch';

    // Top spending category
    const catMap: Record<string, number> = {};
    txns.forEach((t) => {
      if (t.type === 'expense' && t.category) {
        catMap[t.category] = (catMap[t.category] ?? 0) + t.amount;
      }
    });
    const topCategory = Object.entries(catMap).sort((a, b) => b[1] - a[1])[0];

    // 3 most recent transactions
    const recent = [...txns]
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 3);

    const txCount = txns.length;

    return {
      ...acc,
      realIncome,
      realExpenses,
      transferSent,
      transferRecv,
      creditBalance,
      net,
      unreviewedCount,
      flaggedCount,
      txCount,
      utilization,
      creditLimit,
      status,
      topCategory,
      recent,
    };
  });
}, [accounts, transactions]);

const transferFlows = useMemo(() => {
  const flowMap = new Map<string, {
    fromId: string; toId: string;
    fromLabel: string; toLabel: string;
    fromColor: string; toColor: string;
    total: number; count: number;
  }>();

  // Group transfer transactions by pairId
  const byPairId = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    if (tx.type !== 'transfer' || !tx.transferPairId) continue;
    const group = byPairId.get(tx.transferPairId) ?? [];
    group.push(tx);
    byPairId.set(tx.transferPairId, group);
  }

  const pairs = Array.from(byPairId.values());
  for (const pair of pairs) {
    if (pair.length < 2) continue;

    // Identify sender (checking/savings) and receiver (credit)
    const sender = pair.find((t) => {
      const acc = accounts.find((a) => a.id === t.accountId);
      return acc && acc.type !== 'credit';
    });
    const receiver = pair.find((t) => {
      const acc = accounts.find((a) => a.id === t.accountId);
      return acc && acc.type === 'credit';
    });

    // Fallback: if both same type, first is sender second is receiver
    const fromTx = sender ?? pair[0];
    const toTx = receiver ?? pair[1];

    const fromAcc = accounts.find((a) => a.id === fromTx.accountId);
    const toAcc = accounts.find((a) => a.id === toTx.accountId);
    if (!fromAcc || !toAcc || fromAcc.id === toAcc.id) continue;

    const key = `${fromAcc.id}__${toAcc.id}`;
    const existing = flowMap.get(key);
    if (existing) {
      existing.total += fromTx.amount;
      existing.count += 1;
    } else {
      flowMap.set(key, {
        fromId: fromAcc.id,
        toId: toAcc.id,
        fromLabel: fromAcc.nickname,
        toLabel: toAcc.nickname,
        fromColor: fromAcc.color ?? '#C9A84C',
        toColor: toAcc.color ?? '#1B2A4A',
        total: fromTx.amount,
        count: 1,
      });
    }
  }

  return Array.from(flowMap.values()).sort((a, b) => b.total - a.total);
}, [accounts, transactions]);

  const totalIncome = accountStats.reduce((s, a) => s + a.realIncome, 0);
  const totalExpenses = accountStats.reduce((s, a) => s + a.realExpenses, 0);
  const totalMoved = transferFlows.reduce((s, f) => s + f.total, 0);
  const maxBar = Math.max(
    ...accountStats.map((a) => Math.max(a.realIncome, a.realExpenses)),
    1,
  );

  if (accounts.length === 0) return null;

  return (
    <div className="space-y-5">
      {/* ── HOUSEHOLD KPI STRIP ── */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {
            label: "Total Income",
            value: fmt(totalIncome),
            color: "#16A34A",
            bg: "rgba(22,163,74,0.07)",
            icon: "💵",
          },
          {
            label: "Total Expenses",
            value: fmt(totalExpenses),
            color: "#DC2626",
            bg: "rgba(220,38,38,0.07)",
            icon: "💸",
          },
          {
            label: "Money Moved",
            value: fmt(totalMoved),
            color: "#2563EB",
            bg: "rgba(37,99,235,0.07)",
            icon: "↔",
          },
        ].map((item) => (
          <div key={item.label} className="rounded-2xl p-4 text-center" style={{ backgroundColor: item.bg }}>
            <p className="text-2xl">{item.icon}</p>
            <p className="mt-1 text-lg font-bold" style={{ color: item.color }}>
              {item.value}
            </p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-[#1B2A4A]/50">
              {item.label}
            </p>
          </div>
        ))}
      </div>

      {/* ── TRANSFER FLOWS ── */}
      {transferFlows.length > 0 && (
        <div className="rounded-2xl border border-[#E4E8F0] bg-[#F9FAFC] p-4">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#1B2A4A]/40">
            ↔ Money Flows Between Accounts
          </p>
          <div className="space-y-2">
            {transferFlows.map((flow) => {
              const pct = Math.max(6, Math.round((flow.total / totalMoved) * 100));
              return (
                <div key={`${flow.fromId}__${flow.toId}`} className="rounded-xl border border-[#E4E8F0] bg-white p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                      style={{ backgroundColor: flow.fromColor }}
                    >
                      {flow.fromLabel}
                    </span>
                    <svg width="20" height="10" viewBox="0 0 20 10" className="shrink-0">
                      <path
                        d="M0 5 L14 5 M10 1 L18 5 L10 9"
                        stroke="#9AA5B4"
                        strokeWidth="1.5"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
                      style={{ backgroundColor: flow.toColor }}
                    >
                      {flow.toLabel}
                    </span>
                    <span className="ml-auto text-sm font-bold text-[#1B2A4A]">{fmt(flow.total)}</span>
                    <span className="rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[10px] text-[#9AA5B4]">
                      {flow.count}×
                    </span>
                  </div>
                  {/* Flow bar */}
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
                    <div
                      className="h-1.5 rounded-full"
                      style={{
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${flow.fromColor}, ${flow.toColor})`,
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-[#9AA5B4]">
                    avg {fmtFull(flow.total / flow.count)} per payment · {flow.count} payment
                    {flow.count !== 1 ? "s" : ""} total
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ACCOUNT STATUS CARDS ── */}
      <div className="rounded-2xl border border-[#E4E8F0] bg-[#F9FAFC] p-4">
        <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#1B2A4A]/40">
          🏦 Account Status
        </p>
        <div className="space-y-3">
          {accountStats.map((acc) => (
            <div
              key={acc.id}
              className="overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white"
              style={{ borderLeftWidth: 4, borderLeftColor: acc.color ?? "#C9A84C" }}
            >
              {/* Card header */}
              <div className="flex items-start justify-between gap-3 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
                    style={{ backgroundColor: acc.color ?? "#C9A84C" }}
                  >
                    {acc.ownerName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <p className="leading-tight font-semibold text-[#1B2A4A]">{acc.nickname}</p>
                    <p className="text-[11px] text-[#9AA5B4]">
                      {acc.bankName} ••{acc.last4}
                    </p>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <AccountStatusBadge status={acc.status} />
                  <p className="text-[10px] text-[#9AA5B4]">{acc.txCount} transactions</p>
                </div>
              </div>

              {/* Flow bars */}
              <div className="space-y-1.5 px-4 pb-3">
                {acc.realIncome > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-right text-[10px] font-semibold text-green-600">IN</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F4F6FA]">
                      <div
                        className="h-1.5 rounded-full bg-green-400"
                        style={{ width: `${Math.round((acc.realIncome / maxBar) * 100)}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[10px] font-semibold text-green-700">
                      {fmt(acc.realIncome)}
                    </span>
                  </div>
                )}
                {acc.realExpenses > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-10 shrink-0 text-right text-[10px] font-semibold text-red-500">OUT</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F4F6FA]">
                      <div
                        className="h-1.5 rounded-full bg-red-400"
                        style={{ width: `${Math.round((acc.realExpenses / maxBar) * 100)}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[10px] font-semibold text-red-600">
                      {fmt(acc.realExpenses)}
                    </span>
                  </div>
                )}
                {acc.type !== "credit" && acc.transferSent > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right text-[10px] font-semibold text-blue-500 shrink-0">SENT</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#F4F6FA]">
                      <div
                        className="h-1.5 rounded-full bg-blue-300"
                        style={{ width: `${Math.round((acc.transferSent / maxBar) * 100)}%` }}
                      />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[10px] font-semibold text-blue-500">
                      {fmt(acc.transferSent)}
                    </span>
                  </div>
                )}
                {acc.type === "credit" && acc.transferRecv > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="w-10 text-right text-[10px] font-semibold text-green-600 shrink-0">PAID</span>
                    <div className="flex-1 rounded-full bg-[#F4F6FA] h-1.5 overflow-hidden">
                      <div className="h-1.5 rounded-full bg-green-400"
                        style={{ width: `${Math.round((acc.transferRecv / maxBar) * 100)}%` }} />
                    </div>
                    <span className="w-20 text-[10px] font-semibold text-green-700 shrink-0 text-right">
                      {fmt(acc.transferRecv)}
                    </span>
                  </div>
                )}
              </div>

              {/* Credit utilization bar (credit accounts only) */}
              {acc.type === "credit" && acc.creditLimit > 0 && acc.utilization !== null && (
                <div className="border-t border-[#F4F6FA] px-4 py-2">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[#9AA5B4]">
                      Credit Utilization
                    </span>
                    <span
                      className="text-[10px] font-bold"
                      style={{
                        color:
                          acc.utilization > 60
                            ? "#DC2626"
                            : acc.utilization > 30
                              ? "#D97706"
                              : "#16A34A",
                      }}
                    >
                      {acc.utilization}%
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${acc.utilization}%`,
                        backgroundColor:
                          acc.utilization > 60
                            ? "#EF4444"
                            : acc.utilization > 30
                              ? "#F59E0B"
                              : "#22C55E",
                      }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-[#9AA5B4]">
                    {fmtFull(acc.creditBalance)} owed · {fmtFull(acc.transferRecv)} paid · {fmtFull(acc.creditLimit)} limit
                  </p>
                </div>
              )}

              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-3 border-t border-[#F4F6FA] px-4 py-2">
                <div className="flex items-center gap-1.5">
                  <span className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold
                    ${acc.type === 'credit'
                      ? (acc.creditBalance === 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
                      : (acc.net >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')
                    }`}>
                    {acc.type === 'credit' ? (acc.creditBalance === 0 ? '✓' : '!') : (acc.net >= 0 ? '+' : '−')}
                  </span>
                  <span className="text-xs font-bold"
                    style={{
                      color: acc.type === 'credit'
                        ? (acc.creditBalance === 0 ? '#16A34A' : '#DC2626')
                        : (acc.net >= 0 ? '#16A34A' : '#DC2626')
                    }}>
                    {acc.type === 'credit'
                      ? (acc.creditBalance === 0
                          ? 'Paid off ✓'
                          : `${fmtFull(acc.creditBalance)} owed`)
                      : `${acc.net >= 0 ? '+' : '−'}${fmt(Math.abs(acc.net))} net`
                    }
                  </span>
                </div>
                {acc.topCategory && (
                  <span className="rounded-full bg-[#F4F6FA] px-2 py-0.5 text-[10px] text-[#1B2A4A]/70">
                    Top: {acc.topCategory[0]} {fmt(acc.topCategory[1])}
                  </span>
                )}
                {acc.flaggedCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                    ⚠️ {acc.flaggedCount} flagged
                  </span>
                )}
                {acc.unreviewedCount > 0 && (
                  <span className="rounded-full bg-[#FFF8E8] px-2 py-0.5 text-[10px] font-semibold text-[#C9A84C]">
                    ⏳ {acc.unreviewedCount} to review
                  </span>
                )}
              </div>

              {/* Recent transactions preview */}
              {acc.recent.length > 0 && (
                <div className="space-y-1 border-t border-[#F4F6FA] px-4 py-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Recent</p>
                  {acc.recent.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between gap-2">
                      <span className="max-w-[160px] truncate text-[11px] text-[#1B2A4A]/80">{tx.desc}</span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-[10px] text-[#9AA5B4]">{tx.date}</span>
                        <span
                          className={`text-[11px] font-semibold ${
                            tx.type === "income" || tx.type === "refund"
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {tx.type === "income" || tx.type === "refund" ? "+" : "−"}
                          {fmtFull(tx.amount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* View transactions button */}
              <div className="border-t border-[#F4F6FA] px-4 py-2">
                <button
                  type="button"
                  onClick={() => onViewAccountTransactions(acc.id)}
                  className="flex w-full items-center justify-between rounded-lg bg-[#F9FAFC] px-3 py-2 text-xs font-semibold text-[#1B2A4A] transition hover:bg-[#F1F3F8]"
                >
                  <span>View all {acc.txCount} transactions</span>
                  <span className="text-[#9AA5B4]">→</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function OnboardingReviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId, setHouseholdId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [_userOnboardingStep, setUserOnboardingStep] = useState("");
  const [_activeTab, _setActiveTab] = useState<ReviewTab>("transactions");
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");
  const [continuing, setContinuing] = useState(false);
  const [markingAllReviewed, setMarkingAllReviewed] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [_showDetailPanel, setShowDetailPanel] = useState(false);
  const [selectedTxId, setSelectedTxId] = useState("");
  const [_accountFormOpen, setAccountFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountDraft | null>(null);
  const [_savingAccount, setSavingAccount] = useState(false);
  const [showAddTransactionModal, setShowAddTransactionModal] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [_bulkAccountId, _setBulkAccountId] = useState("");
  const [transferSubtypeFilter, _setTransferSubtypeFilter] = useState<TransferSubtypeFilter>("all");
  const [_showTransfersSummary, _setShowTransfersSummary] = useState(false);
  const [suggestedTransferTypeByTxId, setSuggestedTransferTypeByTxId] = useState<
    Record<string, "internal" | "external-third-party">
  >({});
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const [docFilter, setDocFilter] = useState("all");
  const [monthFilter, _setMonthFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [_activeDatePreset, setActiveDatePreset] = useState<
    "this-month" | "last-month" | "last-3-months" | "all-time" | ""
  >("");
  const [spouseFilter, _setSpouseFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [categoryFilter, _setCategoryFilter] = useState("all");
  const [typeFilter, _setTypeFilter] = useState("all");
  const [flaggedFilter, _setFlaggedFilter] = useState("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [reviewedFilter, _setReviewedFilter] = useState("unreviewed");
  const [search, setSearch] = useState("");
  const [subcategoryHideGraceUntil, setSubcategoryHideGraceUntil] = useState<Record<string, number>>(
    {},
  );
  const [addingSubcatForTx, setAddingSubcatForTx] = useState<Record<string, boolean>>({});
  const [newSubcatDrafts, setNewSubcatDrafts] = useState<
    Record<string, { name: string; parentCategory: string }>
  >({});
  const [focusMode, setFocusMode] = useState<"queue" | "all">("queue");
  const [mobilePanel, setMobilePanel] = useState<"list" | "detail">("list");

  const documents = useDocuments(householdId || undefined);
  const { accounts, loading: _accountsLoading } = useAccounts(householdId || undefined);
  const members = useMembers(householdId || undefined);
  const subcatOptions = useMemo(
    () => ({
      transactions: transactions.map((t) => ({ category: t.category, subcat: t.subcat })),
    }),
    [transactions],
  );
  const { subcatsByParent, addSubcategory } = useSubcategories(householdId || undefined, subcatOptions);

  useEffect(() => {
    const loadContext = async () => {
      if (!user) {
        return;
      }

      setLoadingContext(true);
      setError("");

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();
        if (!userData) throw new Error("Could not find your user profile.");

        setUserOnboardingStep(String(userData.onboardingStep ?? "")); // used for guard: loans/complete can revisit
        setUserRole(String(userData.role ?? ""));

        const foundHouseholdId =
          typeof userData.householdId === "string" ? userData.householdId : "";
        if (!foundHouseholdId) {
          router.replace("/onboarding/profile");
          return;
        }

        setHouseholdId(foundHouseholdId);
      } catch (contextError) {
        const message =
          contextError instanceof Error ? contextError.message : "Could not load review context.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };

    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }

    if (!authLoading && user) {
      void loadContext();
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!householdId) {
      setTransactions([]);
      return;
    }

    const q = query(
      collection(db, "households", householdId, "transactions"),
      orderBy("date", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const parsed = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            date: String(data.date ?? ""),
            desc: String(data.desc ?? ""),
            amount: Math.abs(Number(data.amount ?? 0)),
            type: (data.type as TransactionType | undefined) ?? getDefaultType(String(data.category ?? CATEGORY_NAMES[0])),
            category: String(data.category ?? CATEGORY_NAMES[0]),
            assignedTo: String(data.assignedTo ?? ""),
            assignedToName: String(data.assignedToName ?? "Unknown"),
            comment: String(data.comment ?? ""),
            commentBy: String(data.commentBy ?? ""),
            reviewed: Boolean(data.reviewed),
            docId: String(data.docId ?? ""),
            flagged: Boolean(data.flagged),
            flagReason: String(data.flagReason ?? ""),
            subcat: String(data.subcat ?? ""),
            reviewedReason: String(data.reviewedReason ?? ""),
            accountId: String(data.accountId ?? ""),
            accountLabel: String(data.accountLabel ?? ""),
            transferType:
              data.transferType === "internal" ||
              data.transferType === "external-own" ||
              data.transferType === "external-third-party"
                ? data.transferType
                : "",
            transferTo: String(data.transferTo ?? ""),
            transferFrom: String(data.transferFrom ?? ""),
            transferPairId: String(data.transferPairId ?? ""),
            transferNote: String(data.transferNote ?? ""),
            addedManually: Boolean(data.addedManually),
            createdAt: data.createdAt ?? null,
            merchantName: String(data.merchantName ?? ""),
            direction:
              data.direction === "debit" || data.direction === "credit"
                ? data.direction
                : "",
            confidence: typeof data.confidence === "number" ? data.confidence : 1.0,
            isSubscription: Boolean(data.isSubscription),
            transferFromAccountId: String(data.transferFromAccountId ?? ""),
            transferToAccountId: String(data.transferToAccountId ?? ""),
            sourceDocId: String(data.sourceDocId ?? ""),
            month: String(data.month ?? ""),
            accountSnapshot: data.accountSnapshot ?? null,
          } satisfies Transaction;
        });
        setTransactions(parsed);
      },
      () => setTransactions([]),
    );

    return unsubscribe;
  }, [householdId]);

  useEffect(() => {
    if (!householdId || transactions.length === 0) {
      return;
    }

    const negativeTxns = transactions.filter((t) => t.amount < 0);
    if (negativeTxns.length === 0) {
      return;
    }

    const fixNegativeAmounts = async () => {
      try {
        const batch = writeBatch(db);
        negativeTxns.forEach((t) => {
          const ref = doc(db, "households", householdId, "transactions", t.id);
          batch.update(ref, {
            amount: Math.abs(t.amount),
            type: t.type ?? (t.category === "Income" ? "income" : "expense"),
          });
        });
        await batch.commit();
        console.log("Fixed negative amounts:", negativeTxns.length);
      } catch (migrationError) {
        const message =
          migrationError instanceof Error
            ? migrationError.message
            : "Could not migrate negative transaction amounts.";
        setError(message);
      }
    };

    void fixNegativeAmounts();
  }, [householdId, transactions]);

  const memberNameByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const member of members) {
      const name =
        [member.firstName, member.lastName].filter(Boolean).join(" ").trim() ||
        member.displayName ||
        "Member";
      map.set(member.uid, name);
    }
    return map;
  }, [members]);

  const accountById = useMemo(() => {
    const map = new Map<string, (typeof accounts)[number]>();
    for (const account of accounts) {
      map.set(account.id, account);
    }
    return map;
  }, [accounts]);

  const _monthOptions = useMemo(() => {
    const values = new Set<string>();
    for (const tx of transactions) {
      if (tx.date && tx.date.length >= 7) {
        values.add(tx.date.slice(0, 7));
      }
    }
    return Array.from(values).sort((a, b) => b.localeCompare(a));
  }, [transactions]);

  useEffect(() => {
    console.log("accounts loaded:", accounts);
  }, [accounts]);

  const _exportToCSV = (txns: Transaction[], filename: string) => {
    const headers = [
      "Date",
      "Merchant",
      "Amount",
      "Type",
      "TransferType",
      "Category",
      "Subcategory",
      "Account",
      "Bank",
      "Person",
      "Comment",
      "Reviewed",
      "Flagged",
      "FlagReason",
      "AddedManually",
      "CreatedAt",
    ];

    const rows = txns.map((t) => {
      const account = t.accountId ? accountById.get(t.accountId) : undefined;
      const createdAtValue = t.createdAt as { toDate?: () => Date } | string | null | undefined;
      const createdAt =
        createdAtValue && typeof createdAtValue === "object" && typeof createdAtValue.toDate === "function"
          ? createdAtValue.toDate().toISOString()
          : typeof createdAtValue === "string"
            ? createdAtValue
            : "";

      return [
        t.date || "",
        `"${(t.desc || "").replace(/"/g, '""')}"`,
        Number.isFinite(t.amount) ? t.amount.toFixed(2) : "0.00",
        t.type || "",
        t.transferType || "",
        t.category || "",
        t.subcat || "",
        account ? `${account.bankName} ••${account.last4}` : (t.accountLabel || ""),
        account?.bankName || "",
        t.assignedToName || "",
        `"${(t.comment || "").replace(/"/g, '""')}"`,
        t.reviewed ? "yes" : "no",
        t.flagged ? "yes" : "no",
        `"${(t.flagReason || "").replace(/"/g, '""')}"`,
        t.addedManually ? "yes" : "no",
        createdAt,
      ].join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!showExportMenu) return;
    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (exportMenuRef.current && target && !exportMenuRef.current.contains(target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showExportMenu]);

  useEffect(() => {
    if (transactions.length === 0) return;
    setSuggestedTransferTypeByTxId((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const tx of transactions) {
        if (tx.type !== "transfer" || tx.transferType) continue;
        if (next[tx.id]) continue;
        const hasAccount = Boolean(tx.accountId && accountById.has(tx.accountId));
        const suggestion = detectSuggestedTransferType(tx.desc, hasAccount);
        if (suggestion) {
          next[tx.id] = suggestion;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [transactions, accountById]);

  const _applyDatePreset = (preset: "this-month" | "last-month" | "last-3-months" | "all-time") => {
    const now = new Date();
    if (preset === "all-time") {
      setDateFrom("");
      setDateTo("");
      setActiveDatePreset("all-time");
      return;
    }

    if (preset === "this-month") {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      setDateFrom(toYmd(from));
      setDateTo(toYmd(now));
      setActiveDatePreset("this-month");
      return;
    }

    if (preset === "last-month") {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const to = new Date(now.getFullYear(), now.getMonth(), 0);
      setDateFrom(toYmd(from));
      setDateTo(toYmd(to));
      setActiveDatePreset("last-month");
      return;
    }

    const from = new Date(now);
    from.setMonth(now.getMonth() - 3);
    setDateFrom(toYmd(from));
    setDateTo(toYmd(now));
    setActiveDatePreset("last-3-months");
  };

  const filteredTransactions = useMemo(() => {
    const now = Date.now();
    return transactions.filter((tx) => {
      if (docFilter !== "all" && tx.docId !== docFilter) return false;
      if (monthFilter !== "all" && tx.date.slice(0, 7) !== monthFilter) return false;
      if (dateFrom && tx.date < dateFrom) return false;
      if (dateTo && tx.date > dateTo) return false;
      if (spouseFilter !== "all" && tx.assignedTo !== spouseFilter) return false;
      if (accountFilter === "__none__" && tx.accountId) return false;
      if (accountFilter !== "all" && accountFilter !== "__none__" && tx.accountId !== accountFilter) {
        return false;
      }
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (transferSubtypeFilter === "unclassified" && !(tx.type === "transfer" && !tx.transferType)) {
        return false;
      }
      if (
        transferSubtypeFilter !== "all" &&
        transferSubtypeFilter !== "unclassified" &&
        tx.transferType !== transferSubtypeFilter
      ) {
        return false;
      }
      if (flaggedFilter === "flagged" && !tx.flagged) return false;
      // quickFilter takes priority over reviewedFilter
      if (quickFilter === "unreviewed" && tx.reviewed) return false;
      if (quickFilter === "reviewed" && !tx.reviewed) return false;
      if (quickFilter === "flagged" && !tx.flagged) return false;
      if (quickFilter === "no-account" && tx.accountId) return false;

      // reviewedFilter only applies when quickFilter is not already filtering by review state
      if (quickFilter === "all") {
        const inSubcategoryGrace =
          tx.reviewedReason === "subcategory" &&
          typeof subcategoryHideGraceUntil[tx.id] === "number" &&
          subcategoryHideGraceUntil[tx.id] > now;
        if (reviewedFilter === "unreviewed" && tx.reviewed && !inSubcategoryGrace) return false;
        if (reviewedFilter === "reviewed" && !tx.reviewed) return false;
      }
      if (search.trim() && !tx.desc.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [
    transactions,
    docFilter,
    monthFilter,
    dateFrom,
    dateTo,
    spouseFilter,
    accountFilter,
    categoryFilter,
    typeFilter,
    flaggedFilter,
    transferSubtypeFilter,
    quickFilter,
    reviewedFilter,
    search,
    subcategoryHideGraceUntil,
  ]);

  const sortedTransactions = useMemo(() => {
    const copy = [...filteredTransactions];
    copy.sort((a, b) => {
      const direction = sortDir === "asc" ? 1 : -1;
      if (sortKey === "amount") {
        return (a.amount - b.amount) * direction;
      }

      const left = String(a[sortKey] ?? "").toLowerCase();
      const right = String(b[sortKey] ?? "").toLowerCase();
      return left.localeCompare(right) * direction;
    });
    return copy;
  }, [filteredTransactions, sortDir, sortKey]);

  const totalIncome = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) =>
          tx.type === "income" || tx.type === "refund"
            ? sum + tx.amount
            : tx.type === "transfer" && tx.transferType !== "external-third-party"
              ? sum
              : sum,
        0,
      ),
    [filteredTransactions],
  );
  const totalExpenses = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) =>
          tx.type === "expense" || isThirdPartyTransfer(tx) ? sum + tx.amount : sum,
        0,
      ),
    [filteredTransactions],
  );
  const _netAmount = totalIncome - totalExpenses;
  const _internalTransferVolume = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) => (tx.type === "transfer" && tx.transferType === "internal" ? sum + tx.amount : sum),
        0,
      ),
    [filteredTransactions],
  );
  const _ownBankTransferVolume = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) =>
          tx.type === "transfer" && tx.transferType === "external-own" ? sum + tx.amount : sum,
        0,
      ),
    [filteredTransactions],
  );

  const _dateRange = useMemo(() => {
    if (filteredTransactions.length === 0) {
      return "—";
    }
    const sorted = [...filteredTransactions]
      .map((tx) => tx.date)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    if (sorted.length === 0) {
      return "—";
    }
    const start = sorted[0];
    const end = sorted[sorted.length - 1];
    return `${start} - ${end}`;
  }, [filteredTransactions]);

  const flaggedCount = useMemo(
    () => filteredTransactions.filter((tx) => tx.flagged && !tx.reviewed).length,
    [filteredTransactions],
  );
  const unreviewedCount = useMemo(
    () => transactions.filter((tx) => !tx.reviewed).length,
    [transactions],
  );
  const assignedAccountCount = useMemo(
    () => transactions.filter((tx) => Boolean(tx.accountId)).length,
    [transactions],
  );
  const _unassignedAccountCount = Math.max(0, transactions.length - assignedAccountCount);
  const _transferStats = useMemo(() => {
    const txs = transactions.filter((tx) => tx.type === "transfer");
    const internal = txs.filter((tx) => tx.transferType === "internal");
    const externalOwn = txs.filter((tx) => tx.transferType === "external-own");
    const thirdParty = txs.filter((tx) => tx.transferType === "external-third-party");
    const unclassified = txs.filter((tx) => !tx.transferType);
    const sum = (list: Transaction[]) => list.reduce((acc, tx) => acc + tx.amount, 0);
    return {
      totalCount: txs.length,
      internalCount: internal.length,
      internalAmount: sum(internal),
      externalOwnCount: externalOwn.length,
      externalOwnAmount: sum(externalOwn),
      thirdPartyCount: thirdParty.length,
      thirdPartyAmount: sum(thirdParty),
      unclassifiedCount: unclassified.length,
      unclassifiedAmount: sum(unclassified),
    };
  }, [transactions]);
  const totalReviewableCount = useMemo(
    () => transactions.filter((tx) => !tx.flagged).length,
    [transactions],
  );
  const reviewedReviewableCount = useMemo(
    () => transactions.filter((tx) => !tx.flagged && tx.reviewed).length,
    [transactions],
  );
  const pendingReviewableCount = useMemo(
    () => transactions.filter((tx) => !tx.flagged && !tx.reviewed).length,
    [transactions],
  );
  const reviewedProgressPercent =
    totalReviewableCount > 0 ? Math.round((reviewedReviewableCount / totalReviewableCount) * 100) : 0;
  const _accountProgressPercent =
    transactions.length > 0 ? Math.round((assignedAccountCount / transactions.length) * 100) : 0;
  const _activeFilterCount = useMemo(() => {
    let count = 0;
    if (docFilter !== "all") count += 1;
    if (monthFilter !== "all") count += 1;
    if (dateFrom || dateTo) count += 1;
    if (spouseFilter !== "all") count += 1;
    if (accountFilter !== "all") count += 1;
    if (categoryFilter !== "all") count += 1;
    if (typeFilter !== "all") count += 1;
    if (transferSubtypeFilter !== "all") count += 1;
    if (flaggedFilter !== "all") count += 1;
    if (quickFilter !== "all") count += 1;
    if (reviewedFilter !== "unreviewed") count += 1;
    if (search.trim()) count += 1;
    return count;
  }, [
    accountFilter,
    categoryFilter,
    dateFrom,
    dateTo,
    docFilter,
    flaggedFilter,
    monthFilter,
    quickFilter,
    reviewedFilter,
    search,
    spouseFilter,
    typeFilter,
    transferSubtypeFilter,
  ]);

  const handleUpdateTransaction = useCallback(
    async (txId: string, patch: TransactionPatch) => {
      if (!householdId) return;
      try {
        await updateDoc(doc(db, "households", householdId, "transactions", txId), patch);
      } catch (updateError) {
        const message =
          updateError instanceof Error ? updateError.message : "Could not update transaction.";
        setError(message);
      }
    },
    [householdId],
  );

  const assignAccount = async (txId: string, nextAccountId: string) => {
    if (!nextAccountId) {
      await handleUpdateTransaction(txId, { accountId: "", accountLabel: "" });
      return;
    }
    const account = accountById.get(nextAccountId);
    if (!account) return;
    await handleUpdateTransaction(txId, {
      accountId: account.id,
      accountLabel: `${account.bankName} ••${account.last4}`,
      transferFrom: account.id,
    });
  };

  const updateTransferType = async (
    tx: Transaction,
    nextType: "internal" | "external-own" | "external-third-party",
  ) => {
    await handleUpdateTransaction(tx.id, {
      transferType: nextType,
      transferFrom: tx.accountId || tx.transferFrom || "",
    });
    setSuggestedTransferTypeByTxId((prev) => {
      const next = { ...prev };
      delete next[tx.id];
      return next;
    });
  };

  const convertTransferToExpense = async (tx: Transaction, nextCategory = "Personal") => {
    await handleUpdateTransaction(tx.id, {
      type: "expense",
      category: nextCategory,
      transferType: "",
      transferTo: "",
      transferFrom: "",
      transferNote: "",
    });
    setSuggestedTransferTypeByTxId((prev) => {
      const next = { ...prev };
      delete next[tx.id];
      return next;
    });
  };

  const _bulkAssignAccount = async (nextAccountId: string) => {
    if (!householdId || selectedIds.size === 0) return;
    try {
      const account = nextAccountId ? accountById.get(nextAccountId) : undefined;
      const batch = writeBatch(db);
      for (const txId of Array.from(selectedIds)) {
        batch.update(doc(db, "households", householdId, "transactions", txId), {
          accountId: account?.id ?? "",
          accountLabel: account ? `${account.bankName} ••${account.last4}` : "",
        });
      }
      await batch.commit();
      setToastMessage("✅ Account assignment saved.");
    } catch (bulkError) {
      const message =
        bulkError instanceof Error ? bulkError.message : "Could not bulk assign account.";
      setError(message);
    }
  };

  const resetAccountForm = () => {
    const firstMember = members[0];
    const defaultOwner = firstMember?.uid || user?.uid || "joint";
    const defaultOwnerName =
      defaultOwner === "joint"
        ? "Joint"
        : memberNameByUid.get(defaultOwner) || firstMember?.firstName || user?.displayName || "Member";
    setEditingAccount({
      bankName: "",
      nickname: "",
      last4: "",
      creditLimit: "",
      type: "credit",
      subtype: "",
      owner: defaultOwner || "joint",
      ownerName: defaultOwnerName,
      color: "#C9A84C",
    });
  };

  const _beginAddAccount = () => {
    resetAccountForm();
    setAccountFormOpen(true);
  };

  const _beginEditAccount = (account: (typeof accounts)[number]) => {
    setEditingAccount({
      id: account.id,
      bankName: account.bankName,
      nickname: account.nickname,
      last4: account.last4,
      creditLimit: account.creditLimit ? String(account.creditLimit) : "",
      type: account.type,
      subtype: account.subtype || "",
      owner: account.owner,
      ownerName: account.ownerName,
      color: account.color || "#C9A84C",
    });
    setAccountFormOpen(true);
  };

  const _saveAccount = async () => {
    if (!householdId || !editingAccount) return;
    if (!editingAccount.nickname.trim()) {
      setError("Please enter a nickname.");
      setToastMessage("Please enter a nickname");
      return;
    }
    if (!editingAccount.bankName.trim()) {
      setError("Please enter a bank name.");
      setToastMessage("Please enter a bank name");
      return;
    }

    setSavingAccount(true);
    const bankName = editingAccount.bankName.trim();
    const nickname = editingAccount.nickname.trim();
    const last4 = editingAccount.last4.replace(/\D/g, "").slice(0, 4);
    const ownerName =
      editingAccount.owner === "joint"
        ? "Joint"
        : memberNameByUid.get(editingAccount.owner) || editingAccount.ownerName || "Member";
    const accountData = {
      nickname,
      bankName,
      last4,
      type: editingAccount.type,
      subtype: editingAccount.subtype || "",
      creditLimit:
        editingAccount.type === "credit"
          ? parseFloat(editingAccount.creditLimit || "0") || 0
          : null,
      owner: editingAccount.owner,
      ownerName,
      color: editingAccount.color || "#C9A84C",
      householdId,
      createdAt: serverTimestamp(),
    };
    console.log("householdId:", householdId);
    console.log("saving account:", accountData);
    try {
      if (editingAccount.id) {
        await updateDoc(
          doc(db, "households", householdId, "accounts", editingAccount.id),
          accountData,
        );
        setToastMessage(`✅ ${nickname} updated!`);
      } else {
        await addDoc(collection(db, "households", householdId, "accounts"), accountData);
        setToastMessage(`✅ ${nickname} added!`);
      }
      resetAccountForm();
      setAccountFormOpen(false);
      setEditingAccount(null);
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save account.";
      console.error("Save account error:", saveError);
      setError(`Error saving account: ${message}`);
      setToastMessage(`Error saving account: ${message}`);
    } finally {
      setSavingAccount(false);
    }
  };

  const _deleteAccountAndUnlink = async (account: (typeof accounts)[number]) => {
    if (!householdId) return;
    const confirmed = window.confirm(
      `Delete ${account.nickname}? Transactions assigned to this account will keep their data but lose the account link.`,
    );
    if (!confirmed) return;
    try {
      await deleteDoc(doc(db, "households", householdId, "accounts", account.id));
      const linkedTx = await getDocs(
        query(
          collection(db, "households", householdId, "transactions"),
          where("accountId", "==", account.id),
        ),
      );
      if (!linkedTx.empty) {
        const batch = writeBatch(db);
        linkedTx.docs.forEach((txDoc) => {
          batch.update(txDoc.ref, { accountId: "", accountLabel: "" });
        });
        await batch.commit();
      }
      setToastMessage("✅ Account deleted");
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete account.";
      setError(message);
    }
  };

  const getAutoReviewedPatch = (
    reason: "category" | "subcategory" | "skip" | "bulk",
  ): Pick<TransactionPatch, "reviewed" | "reviewedBy" | "reviewedAt" | "reviewedReason"> => ({
    reviewed: true,
    reviewedBy: user?.uid ?? "",
    reviewedAt: serverTimestamp(),
    reviewedReason: reason,
  });

  const _handleSubcategorySelect = async (tx: Transaction, selectedValue: string) => {
    if (selectedValue === "__add_new__") {
      setAddingSubcatForTx((prev) => ({ ...prev, [tx.id]: true }));
      setNewSubcatDrafts((prev) => ({
        ...prev,
        [tx.id]: prev[tx.id] ?? { name: "", parentCategory: tx.category },
      }));
      return;
    }

    const graceUntil = Date.now() + 200;
    setSubcategoryHideGraceUntil((prev) => ({ ...prev, [tx.id]: graceUntil }));
    window.setTimeout(() => {
      setSubcategoryHideGraceUntil((prev) => {
        if (!prev[tx.id] || prev[tx.id] > Date.now()) {
          return prev;
        }
        const next = { ...prev };
        delete next[tx.id];
        return next;
      });
    }, 250);

    await handleUpdateTransaction(tx.id, {
      subcat: selectedValue,
      ...getAutoReviewedPatch("subcategory"),
    });
  };

  const handleSaveNewSubcategory = async (tx: Transaction) => {
    const draft = newSubcatDrafts[tx.id] ?? { name: "", parentCategory: tx.category };
    const name = draft.name.trim();
    if (!name) {
      setError("Please enter a subcategory name.");
      return;
    }

    try {
      await addSubcategory(name, draft.parentCategory);
      const graceUntil = Date.now() + 200;
      setSubcategoryHideGraceUntil((prev) => ({ ...prev, [tx.id]: graceUntil }));
      window.setTimeout(() => {
        setSubcategoryHideGraceUntil((prev) => {
          if (!prev[tx.id] || prev[tx.id] > Date.now()) {
            return prev;
          }
          const next = { ...prev };
          delete next[tx.id];
          return next;
        });
      }, 250);

      await handleUpdateTransaction(tx.id, {
        category: draft.parentCategory,
        subcat: name,
        type: getDefaultType(draft.parentCategory),
        ...getAutoReviewedPatch("subcategory"),
      });
      setAddingSubcatForTx((prev) => ({ ...prev, [tx.id]: false }));
      setNewSubcatDrafts((prev) => ({
        ...prev,
        [tx.id]: { name: "", parentCategory: draft.parentCategory },
      }));
    } catch (subcatError) {
      const message =
        subcatError instanceof Error ? subcatError.message : "Could not create subcategory.";
      setError(message);
    }
  };

  const _toggleAll = () => {
    if (selectedIds.size === sortedTransactions.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(sortedTransactions.map((tx) => tx.id)));
  };

  const _toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteOne = async (id: string) => {
    if (!householdId) return;
    try {
      await deleteDoc(doc(db, "households", householdId, "transactions", id));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete transaction.";
      setError(message);
    }
  };

  const _deleteSelected = async () => {
    if (!householdId || selectedIds.size === 0) return;
    try {
      await Promise.all(
        Array.from(selectedIds).map((id) =>
          deleteDoc(doc(db, "households", householdId, "transactions", id)),
        ),
      );
      setSelectedIds(new Set());
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete selected rows.";
      setError(message);
    }
  };

  const markAllAsReviewed = async () => {
    if (!householdId || !user) return;

    const toReview = transactions.filter((t) => !t.flagged && !t.reviewed);
    if (toReview.length === 0) {
      return;
    }

    const confirmed = window.confirm(
      `Mark all ${toReview.length} transactions as reviewed?\nFlagged transactions will be skipped.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setMarkingAllReviewed(true);
      const batch = writeBatch(db);
      toReview.forEach((t) => {
        const ref = doc(db, "households", householdId, "transactions", t.id);
        batch.update(ref, {
          reviewed: true,
          reviewedBy: user.uid,
          reviewedAt: serverTimestamp(),
          reviewedReason: "bulk",
        });
      });
      await batch.commit();
      setToastMessage(`${toReview.length} transactions marked as reviewed ✓`);
    } catch (markError) {
      const message =
        markError instanceof Error ? markError.message : "Could not mark all as reviewed.";
      setError(message);
    } finally {
      setMarkingAllReviewed(false);
    }
  };

  const continueToLoans = async () => {
    if (!user) return;
    try {
      setContinuing(true);
      await updateDoc(doc(db, "users", user.uid), {
        onboardingStep: "loans",
      });
      router.push("/onboarding/loans");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not continue.";
      setError(msg);
    } finally {
      setContinuing(false);
    }
  };

  const _handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const _sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "↕";

  const selectedTx = useMemo(
    () => transactions.find((tx) => tx.id === selectedTxId) ?? null,
    [transactions, selectedTxId],
  );

  const renderTransferDetails = (tx: Transaction, compact = false) => {
    if (tx.type !== "transfer") return null;

    const fromAcc = tx.transferFromAccountId
      ? accountById.get(tx.transferFromAccountId)
      : tx.accountId
        ? accountById.get(tx.accountId)
        : undefined;

    const toAcc = tx.transferToAccountId
      ? accountById.get(tx.transferToAccountId)
      : undefined;

    const isLinked = Boolean(tx.transferPairId);

    // ── LINKED PAIR — clean diagram + collapsible reclassify ──────
    if (isLinked) {
      return (
        <div className={`space-y-2 rounded-xl border border-blue-100 bg-blue-50 p-3 ${compact ? "" : "mt-2"}`}>
          {/* FROM → TO diagram */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
              style={{ backgroundColor: fromAcc?.color ?? "#9AA5B4" }}
            >
              {fromAcc?.nickname ?? "Unknown"}
            </span>
            <svg width="20" height="10" viewBox="0 0 20 10" className="shrink-0">
              <path
                d="M0 5 L14 5 M10 1 L18 5 L10 9"
                stroke="#93C5FD"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span
              className="rounded-full px-2.5 py-1 text-[11px] font-bold text-white"
              style={{ backgroundColor: toAcc?.color ?? "#9AA5B4" }}
            >
              {toAcc?.nickname ?? "Unknown"}
            </span>
            <span className="ml-auto text-xs font-bold text-blue-700">${tx.amount.toFixed(2)}</span>
          </div>

          <p className="text-[10px] text-blue-400">
            {tx.direction === "debit" ? "Sending side" : "Receiving side"}
            {" · "}
            {(tx.transferType as string) === "card-payment"
              ? "Card payment"
              : tx.transferType === "internal"
                ? "Internal transfer"
                : tx.transferType === "external-own"
                  ? "Own bank transfer"
                  : "Transfer"}
          </p>

          {/* Collapsible reclassify section */}
          <details className="group">
            <summary className="cursor-pointer list-none text-[11px] font-semibold text-blue-500 hover:text-blue-700">
              <span className="group-open:hidden">⚙ Reclassify →</span>
              <span className="hidden group-open:inline">⚙ Reclassify ↑</span>
            </summary>

            <div className="mt-2 space-y-2 rounded-lg border border-blue-100 bg-white p-2">
              {/* Transfer type buttons */}
              <div className="flex flex-wrap gap-2">
                {([
                  ["internal", "🏠 Internal", "Between your own accounts"],
                  ["external-own", "🏦 My Other Bank", "Your account at another bank"],
                  ["external-third-party", "👤 Third Party", "To another person or business"],
                ] as const).map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => void updateTransferType(tx, value)}
                    className={`rounded-lg border px-2 py-1 text-left ${
                      tx.transferType === value
                        ? value === "internal"
                          ? "border-transparent bg-[#1B2A4A] text-white"
                          : value === "external-own"
                            ? "border-transparent bg-[#3B82F6] text-white"
                            : "border-transparent bg-[#F97316] text-white"
                        : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                    }`}
                  >
                    <div className="text-xs font-semibold">{label}</div>
                    <div className="text-[10px] opacity-70">{description}</div>
                  </button>
                ))}
              </div>

              {/* Convert to expense */}
              <div className="rounded-md border border-[#F97316]/30 bg-orange-50 p-2 text-[11px] text-[#F97316]">
                This looks wrong? Convert to an expense instead:
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {[
                    ["Giving", "💝 Giving"],
                    ["Housing", "🏠 Rent"],
                    ["Personal", "👤 Personal"],
                    ["Debt", "💳 Debt"],
                  ].map(([category, label]) => (
                    <button
                      key={category}
                      type="button"
                      onClick={() => void convertTransferToExpense(tx, category)}
                      className="rounded-full border border-[#F97316]/30 bg-white px-2 py-0.5 text-[10px] font-semibold text-[#1B2A4A]"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      );
    }

    // ── UNLINKED TRANSFER — full classification UI ─────────────────
    const suggestion = suggestedTransferTypeByTxId[tx.id];

    return (
      <div className={`space-y-2 rounded-lg border border-[#E4E8F0] bg-white p-2 ${compact ? "" : "mt-2"}`}>
        {/* Suggestion hint */}
        {suggestion && (
          <div
            className={`rounded-md px-2 py-1 text-[11px] ${
              suggestion === "internal"
                ? "border border-[#C9A84C]/40 bg-[#FFF8E8] text-[#1B2A4A]"
                : "border border-[#F97316]/40 bg-orange-50 text-[#F97316]"
            }`}
          >
            {suggestion === "internal"
              ? "💡 Detected as internal transfer"
              : "⚠️ May be an expense — review carefully"}
          </div>
        )}

        {/* Transfer type buttons */}
        <div className="flex flex-wrap gap-2">
          {([
            ["internal", "🏠 Internal", "Between your own accounts", "bg-[#1B2A4A]"],
            ["external-own", "🏦 My Other Bank", "Your account at another bank", "bg-[#3B82F6]"],
            ["external-third-party", "👤 Third Party", "To another person or business", "bg-[#F97316]"],
          ] as const).map(([value, label, description, activeBg]) => (
            <button
              key={value}
              type="button"
              onClick={() => void updateTransferType(tx, value)}
              className={`rounded-lg border px-2 py-1 text-left ${
                tx.transferType === value
                  ? `${activeBg} border-transparent text-white`
                  : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
              }`}
            >
              <div className="text-xs font-semibold">{label}</div>
              <div className="text-[10px] opacity-80">{description}</div>
            </button>
          ))}
        </div>

        {/* Third party warning + convert */}
        {tx.transferType === "external-third-party" && (
          <div className="rounded-md border border-[#F97316]/40 bg-orange-50 p-2 text-[11px] text-[#F97316]">
            ⚠️ This might be an expense. Convert?
            <div className="mt-1.5 flex flex-wrap gap-1">
              {[
                ["Giving", "💝 Giving"],
                ["Housing", "🏠 Rent/Housing"],
                ["Personal", "👤 Personal"],
                ["Debt", "💳 Debt Payment"],
              ].map(([category, label]) => (
                <button
                  key={category}
                  type="button"
                  onClick={() => void convertTransferToExpense(tx, category)}
                  className="rounded-full border border-[#E4E8F0] bg-white px-2 py-0.5 text-[10px] font-semibold text-[#1B2A4A]"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Internal: select destination account */}
        {tx.transferType === "internal" && (
          <select
            value={tx.transferTo || ""}
            onChange={(e) =>
              void handleUpdateTransaction(tx.id, {
                transferTo: e.target.value,
                transferFrom: tx.accountId || tx.transferFrom || "",
              })
            }
            className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
          >
            <option value="">Select destination account</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.nickname} · {account.bankName} ••{account.last4}
              </option>
            ))}
          </select>
        )}

        {/* External-own: free text destination */}
        {tx.transferType === "external-own" && (
          <input
            value={tx.transferTo}
            onChange={(e) =>
              void handleUpdateTransaction(tx.id, {
                transferTo: e.target.value,
                transferFrom: tx.accountId || tx.transferFrom || "",
              })
            }
            placeholder="e.g. Wells Fargo ••8834, TD Bank account"
            className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
          />
        )}

        {/* External-third-party: recipient name */}
        {tx.transferType === "external-third-party" && (
          <input
            value={tx.transferTo}
            onChange={(e) =>
              void handleUpdateTransaction(tx.id, {
                transferTo: e.target.value,
                transferFrom: tx.accountId || tx.transferFrom || "",
              })
            }
            placeholder="e.g. John Smith, Landlord, Ivan Merchan"
            className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
          />
        )}

        {/* Transfer note */}
        <input
          value={tx.transferNote}
          onChange={(e) => void handleUpdateTransaction(tx.id, { transferNote: e.target.value })}
          placeholder="Optional note (e.g. Monthly rent, Emergency fund)"
          className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
        />
      </div>
    );
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  useEffect(() => {
    if (!selectedTxId) return;
    if (!transactions.some((tx) => tx.id === selectedTxId)) {
      setSelectedTxId("");
      setShowDetailPanel(false);
    }
  }, [selectedTxId, transactions]);

  // Keyboard shortcuts for review
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in an input/textarea/select
      const tag = (e.target as HTMLElement).tagName;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

      const currentIdx = selectedTxId
        ? sortedTransactions.findIndex((t) => t.id === selectedTxId)
        : -1;

      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = sortedTransactions[currentIdx + 1];
        if (next) {
          setSelectedTxId(next.id);
          setShowDetailPanel(true);
          setMobilePanel("detail");
        }
      }
      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = sortedTransactions[currentIdx - 1];
        if (prev) {
          setSelectedTxId(prev.id);
          setShowDetailPanel(true);
          setMobilePanel("detail");
        }
      }
      if ((e.key === " " || e.key === "Enter") && selectedTxId) {
        e.preventDefault();
        const tx = transactions.find((t) => t.id === selectedTxId);
        if (tx && !tx.flagged) {
          void handleUpdateTransaction(selectedTxId, {
            reviewed: !tx.reviewed,
            reviewedBy: user?.uid ?? "",
            reviewedAt: serverTimestamp(),
            reviewedReason: "skip",
          });
          // Auto-advance to next
          const next = sortedTransactions[currentIdx + 1];
          if (next) setSelectedTxId(next.id);
        }
      }
      if (e.key === "f" && selectedTxId) {
        const tx = transactions.find((t) => t.id === selectedTxId);
        if (tx) {
          void handleUpdateTransaction(selectedTxId, {
            flagged: !tx.flagged,
            flagReason: tx.flagged ? "" : "Needs review",
          });
        }
      }
      if (e.key === "Escape") {
        setShowDetailPanel(false);
        setSelectedTxId("");
        setMobilePanel("list");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedTxId, sortedTransactions, transactions, user, handleUpdateTransaction]);

  // Queue = unreviewed OR flagged
  const queueTransactions = useMemo(
    () => sortedTransactions.filter((tx) => !tx.reviewed || tx.flagged),
    [sortedTransactions],
  );
  // When quickFilter explicitly requests reviewed/flagged/all,
  // override queue mode and show from the full sorted list
  const displayTransactions = useMemo(() => {
    if (quickFilter === "reviewed" || quickFilter === "flagged") {
      return sortedTransactions; // filteredTransactions already handles the filter
    }
    return focusMode === "queue" ? queueTransactions : sortedTransactions;
  }, [focusMode, quickFilter, queueTransactions, sortedTransactions]);

  if (authLoading || loadingContext) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F6FA]">
        <div className="text-sm text-[#1B2A4A]/40">Loading...</div>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#F4F6FA] text-[#1B2A4A]">
      <header className="shrink-0 border-b border-[#E4E8F0] bg-white">
        <div className="px-5 pt-3 pb-1">
          <OnboardingProgressDots currentStep="Review" userRole={userRole} />
        </div>
        <div className="flex items-center gap-4 px-5 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold text-[#1B2A4A]">Review Transactions</h1>
          <span className="rounded-full bg-[#FFF8E8] px-3 py-0.5 text-xs font-semibold text-[#C9A84C]">
            {reviewedReviewableCount}/{totalReviewableCount} done
          </span>
          {flaggedCount > 0 && (
            <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-700">
              ⚠️ {flaggedCount} flagged
            </span>
          )}
        </div>

        <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#F4F6FA]">
          <div
            className="h-2 rounded-full bg-[#C9A84C] transition-all duration-500"
            style={{ width: `${reviewedProgressPercent}%` }}
          />
        </div>

        <div className="hidden md:flex items-center gap-1 rounded-lg border border-[#E4E8F0] p-0.5">
          <button
            type="button"
            onClick={() => {
              setFocusMode("queue");
              setQuickFilter("all");
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              focusMode === "queue" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A]/60 hover:text-[#1B2A4A]"
            }`}
          >
            Queue {queueTransactions.length > 0 && `(${queueTransactions.length})`}
          </button>
          <button
            type="button"
            onClick={() => {
              setFocusMode("all");
              setQuickFilter("all");
            }}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
              focusMode === "all" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A]/60 hover:text-[#1B2A4A]"
            }`}
          >
            All ({transactions.length})
          </button>
        </div>

        <div className="hidden md:flex items-center gap-2">
          <button
            type="button"
            onClick={() => void markAllAsReviewed()}
            disabled={markingAllReviewed || pendingReviewableCount === 0}
            className="rounded-lg border border-[#E4E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA] disabled:opacity-40"
          >
            ✓ Mark All
          </button>
          <button
            type="button"
            onClick={() => setShowAddTransactionModal(true)}
            className="rounded-lg bg-[#C9A84C] px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] hover:brightness-95"
          >
            + Add
          </button>
          <button
            type="button"
            onClick={() => void continueToLoans()}
            disabled={continuing}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#1B2A4A] px-4 text-sm font-semibold text-white disabled:opacity-50"
          >
            {continuing ? "..." : "Continue →"}
          </button>
          <button
            type="button"
            onClick={async () => {
              if (!user) return;
              await updateDoc(doc(db, "users", user.uid), { onboardingStep: "loans" });
              router.push("/onboarding/loans");
            }}
            className="text-xs font-semibold text-[#9AA5B4] underline hover:text-[#1B2A4A]"
          >
            Skip for now →
          </button>
        </div>
        </div>
      </header>

      <div className="hidden md:block shrink-0 border-b border-[#E4E8F0] bg-[#FAFBFC] px-5 py-1.5">
        <p className="text-[10px] text-[#9AA5B4]">
          <span className="font-semibold text-[#1B2A4A]/50">Space/Enter</span> approve &nbsp;·&nbsp;
          <span className="font-semibold text-[#1B2A4A]/50">↑↓</span> navigate &nbsp;·&nbsp;
          <span className="font-semibold text-[#1B2A4A]/50">F</span> flag &nbsp;·&nbsp;
          <span className="font-semibold text-[#1B2A4A]/50">Esc</span> close
        </p>
      </div>

      {docFilter !== "all" &&
        (() => {
          const stmt = documents.find((d) => d.id === docFilter);
          if (!stmt) return null;
          return (
            <div className="shrink-0 flex items-center justify-between border-b border-blue-100 bg-blue-50 px-5 py-2">
              <p className="text-xs font-semibold text-blue-700">
                📄 {stmt.fileName?.replace("-parsed.json", "") || "Statement"} ·
                {stmt.statementStart && stmt.statementEnd
                  ? ` ${stmt.statementStart} → ${stmt.statementEnd}`
                  : ""}
                {stmt.openingBalance != null && stmt.closingBalance != null
                  ? ` · $${stmt.openingBalance.toFixed(2)} → $${stmt.closingBalance.toFixed(2)}`
                  : ""}
              </p>
              <button
                type="button"
                onClick={() => setDocFilter("all")}
                className="text-xs text-blue-400 hover:text-blue-600"
              >
                × clear
              </button>
            </div>
          );
        })()}

      {error && (
        <div className="shrink-0 border-b border-red-100 bg-red-50 px-5 py-2 text-xs font-medium text-red-600">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        <div className={`flex flex-col border-[#E4E8F0] bg-white ${
          mobilePanel === "detail"
            ? "hidden md:flex md:w-[340px] md:shrink-0 md:border-r"
            : "flex w-full md:w-[340px] md:shrink-0 md:border-r"
        }`}>
          <div className="flex items-center gap-1 border-b border-[#E4E8F0] p-3 md:hidden">
            <div className="flex flex-1 items-center gap-1 rounded-lg border border-[#E4E8F0] p-0.5">
              <button
                type="button"
                onClick={() => { setFocusMode("queue"); setQuickFilter("all"); }}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
                  focusMode === "queue" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A]/60"
                }`}
              >
                Queue {queueTransactions.length > 0 && `(${queueTransactions.length})`}
              </button>
              <button
                type="button"
                onClick={() => { setFocusMode("all"); setQuickFilter("all"); }}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition ${
                  focusMode === "all" ? "bg-[#1B2A4A] text-white" : "text-[#1B2A4A]/60"
                }`}
              >
                All ({transactions.length})
              </button>
            </div>
          </div>

          <div className="shrink-0 space-y-2 border-b border-[#E4E8F0] p-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant..."
              className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-[#F9FAFC] px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
            />
            <div className="flex flex-wrap gap-1.5">
              {([
                ["all", "All", `${transactions.length}`],
                ["unreviewed", "⏳ Pending", `${unreviewedCount}`],
                ["flagged", "⚠️ Flagged", `${flaggedCount}`],
                ["reviewed", "✅ Done", `${reviewedReviewableCount}`],
              ] as [QuickFilter, string, string][]).map(([val, label, count]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setQuickFilter(val)}
                  className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                    quickFilter === val
                      ? "border-[#C9A84C] bg-[#FFF8E8] text-[#1B2A4A]"
                      : "border-[#E4E8F0] text-[#9AA5B4] hover:border-[#C9A84C]/50"
                  }`}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <select
              value={accountFilter}
              onChange={(e) => setAccountFilter(e.target.value)}
              className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs text-[#1B2A4A] focus:outline-none"
            >
              <option value="all">All accounts</option>
              <option value="__none__">⚠️ No account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nickname} ••{a.last4}
                </option>
              ))}
            </select>
            {/* Statement / source doc filter */}
            {documents.length > 0 && (
              <select
                value={docFilter}
                onChange={(e) => setDocFilter(e.target.value)}
                className="h-8 w-full rounded-lg border border-[#E4E8F0] bg-[#F9FAFC] px-2 text-xs text-[#1B2A4A] focus:outline-none"
              >
                <option value="all">All statements</option>
                {documents
                  .slice()
                  .sort((a, b) => (b.statementEnd || "").localeCompare(a.statementEnd || ""))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.fileName?.replace("-parsed.json", "") || d.id}
                      {d.statementEnd ? ` (${d.statementEnd.slice(0, 7)})` : ""}
                    </option>
                  ))}
              </select>
            )}
          </div>

          <div className="flex-1 overflow-y-auto">
            {displayTransactions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-3xl">✅</p>
                <p className="mt-2 text-sm font-semibold text-[#1B2A4A]">
                  {focusMode === "queue" ? "All caught up!" : "No transactions"}
                </p>
                <p className="mt-1 text-xs text-[#9AA5B4]">
                  {focusMode === "queue" ? "Switch to All to browse" : "Add transactions or adjust filters"}
                </p>
              </div>
            ) : (
              displayTransactions.map((tx) => {
                const isSelected = tx.id === selectedTxId;
                const account = tx.accountId ? accountById.get(tx.accountId) : undefined;
                return (
                  <button
                    key={tx.id}
                    type="button"
                    onClick={() => {
                      setSelectedTxId(tx.id);
                      setShowDetailPanel(true);
                      setMobilePanel("detail");
                    }}
                    className={`w-full border-b border-[#F4F6FA] px-4 py-3 text-left transition ${
                      isSelected
                        ? "border-l-2 border-l-[#C9A84C] bg-[#FFF8E8]"
                        : tx.flagged
                          ? "bg-amber-50 hover:bg-amber-100/60"
                          : tx.reviewed
                            ? "bg-[#F9FAFC] opacity-60 hover:opacity-100"
                            : "bg-white hover:bg-[#F9FAFC]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p
                          className={`truncate text-sm font-semibold ${
                            tx.reviewed && !tx.flagged ? "text-[#1B2A4A]/50" : "text-[#1B2A4A]"
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            {tx.merchantName || tx.desc}
                            {tx.isSubscription && (
                              <span className="text-[10px] text-blue-400" title="Subscription">
                                🔄
                              </span>
                            )}
                            {tx.confidence < 0.8 && tx.confidence > 0 && (
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400"
                                title={`AI confidence: ${Math.round(tx.confidence * 100)}%`}
                              />
                            )}
                          </span>
                        </p>
                        {tx.type === "transfer" &&
                          (tx.transferFromAccountId || tx.transferToAccountId) &&
                          (() => {
                            const fromAcc = tx.transferFromAccountId
                              ? accountById.get(tx.transferFromAccountId)
                              : null;
                            const toAcc = tx.transferToAccountId
                              ? accountById.get(tx.transferToAccountId)
                              : null;
                            const fromLabel =
                              fromAcc?.nickname ??
                              (tx.direction === "debit"
                                ? (tx.accountSnapshot?.nickname ?? "This account")
                                : "External");
                            const toLabel =
                              toAcc?.nickname ??
                              (tx.direction === "credit"
                                ? (tx.accountSnapshot?.nickname ?? "This account")
                                : "External");
                            return (
                              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#9AA5B4]">
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: fromAcc?.color ?? "#9AA5B4" }}
                                />
                                {fromLabel}
                                <span>→</span>
                                <span
                                  className="inline-block h-2 w-2 rounded-full"
                                  style={{ backgroundColor: toAcc?.color ?? "#9AA5B4" }}
                                />
                                {toLabel}
                              </span>
                            );
                          })()}
                        <p className="mt-0.5 text-[11px] text-[#9AA5B4]">
                          {tx.date}
                          {account && (
                            <span
                              className="ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold text-white"
                              style={{ backgroundColor: account.color || "#9AA5B4" }}
                            >
                              ••{account.last4}
                            </span>
                          )}
                        </p>
                        <div className="mt-1 flex items-center gap-1.5">
                          {tx.category && tx.type !== "transfer" && (
                            <span className="text-[10px] text-[#9AA5B4]">
                              {getCategoryEmoji(tx.category)} {tx.category}
                            </span>
                          )}
                          {tx.type === "transfer" &&
                            (() => {
                              const d = transferDirectionLabel(tx.direction, tx.type);
                              if (!d) return null;
                              return (
                                <span
                                  className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                  style={{ color: d.color, backgroundColor: d.bg }}
                                >
                                  {d.label}
                                </span>
                              );
                            })()}
                          {tx.flagged && <span className="text-[10px] text-amber-600">⚠️ flagged</span>}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span
                          className={`text-sm font-bold ${
                            tx.direction === "credit" ? "text-green-600" : "text-[#1B2A4A]"
                          }`}
                        >
                          {tx.direction === "credit" ? "+" : "−"}${tx.amount.toFixed(0)}
                        </span>
                        <span
                          className={`inline-flex h-2 w-2 rounded-full ${
                            tx.flagged ? "bg-amber-400" : tx.reviewed ? "bg-green-400" : "bg-[#E4E8F0]"
                          }`}
                        />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="shrink-0 border-t border-[#E4E8F0] px-4 py-2">
            <p className="text-[10px] text-[#9AA5B4]">
              {displayTransactions.length} shown · {reviewedProgressPercent}% reviewed
            </p>
          </div>
        </div>

        <div className={`flex flex-col overflow-hidden ${
          mobilePanel === "detail"
            ? "flex w-full flex-1"
            : "hidden md:flex md:flex-1"
        }`}>
          {mobilePanel === "detail" && (
            <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-4 py-2 md:hidden">
              <button
                type="button"
                onClick={() => { setSelectedTxId(""); setMobilePanel("list"); }}
                className="flex items-center gap-1.5 text-sm font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
              >
                ← Back to list
              </button>
            </div>
          )}
          {!selectedTx ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <p className="text-4xl">👈</p>
              <p className="text-base font-semibold text-[#1B2A4A]">
                <span className="md:hidden">Tap a transaction to review it</span>
                <span className="hidden md:inline">Select a transaction</span>
              </p>
              <p className="text-sm text-[#9AA5B4]">or use ↑↓ arrow keys to navigate</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div
                className={`shrink-0 border-b px-6 py-4 ${
                  selectedTx.flagged
                    ? "border-amber-200 bg-amber-50"
                    : selectedTx.reviewed
                      ? "border-green-100 bg-green-50"
                      : "border-[#E4E8F0] bg-white"
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-bold text-[#1B2A4A]">
                      {selectedTx.merchantName || selectedTx.desc}
                    </h2>
                    <p className="mt-0.5 leading-tight text-[10px] text-[#9AA5B4]">
                      {selectedTx.merchantName && selectedTx.merchantName !== selectedTx.desc
                        ? selectedTx.desc
                        : null}
                    </p>
                    {selectedTx.isSubscription && (
                      <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600">
                        🔄 Recurring subscription
                      </span>
                    )}
                    {selectedTx.confidence > 0 && selectedTx.confidence < 0.8 && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
                        🤖 AI confidence {Math.round(selectedTx.confidence * 100)}% — please verify this
                        classification
                      </div>
                    )}
                    {selectedTx.flagged && selectedTx.flagReason && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-100 px-3 py-2 text-xs font-medium text-amber-800">
                        ⚠️ {selectedTx.flagReason}
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-2xl font-bold ${
                        selectedTx.type === "income" || selectedTx.type === "refund"
                          ? "text-green-600"
                          : "text-[#1B2A4A]"
                      }`}
                    >
                      {selectedTx.type === "income" || selectedTx.type === "refund" ? "+" : "−"}
                      {formatMoney(selectedTx.amount)}
                    </p>
                    <p className="text-xs text-[#9AA5B4]">{selectedTx.date}</p>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      void handleUpdateTransaction(selectedTx.id, {
                        reviewed: !selectedTx.reviewed,
                        reviewedBy: user.uid,
                        reviewedAt: serverTimestamp(),
                        reviewedReason: "skip",
                      })
                    }
                    className={`flex-1 rounded-lg py-2 text-sm font-bold transition ${
                      selectedTx.reviewed
                        ? "bg-green-100 text-green-700 hover:bg-green-200"
                        : "bg-[#1B2A4A] text-white hover:brightness-110"
                    }`}
                  >
                    {selectedTx.reviewed ? "✓ Reviewed — click to undo" : "✓ Approve (Space)"}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleUpdateTransaction(selectedTx.id, {
                        flagged: !selectedTx.flagged,
                        flagReason: selectedTx.flagged ? "" : "Needs review",
                      })
                    }
                    className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                      selectedTx.flagged
                        ? "bg-amber-200 text-amber-800 hover:bg-amber-300"
                        : "border border-[#E4E8F0] bg-white text-[#1B2A4A] hover:bg-amber-50"
                    }`}
                  >
                    {selectedTx.flagged ? "⚠️ Flagged" : "⚑ Flag"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteOne(selectedTx.id)}
                    className="rounded-lg border border-[#E4E8F0] bg-white px-4 py-2 text-sm font-semibold text-red-500 hover:bg-red-50"
                  >
                    🗑
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#F9FAFC] px-6 py-5">
                <div className="mx-auto max-w-2xl space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Type
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        {(["expense", "income", "transfer", "refund"] as TransactionType[]).map((t) => (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              void handleUpdateTransaction(selectedTx.id, {
                                type: t,
                                ...(t !== "transfer"
                                  ? {
                                      transferType: "",
                                      transferTo: "",
                                      transferFrom: "",
                                      transferNote: "",
                                    }
                                  : { transferFrom: selectedTx.accountId || "" }),
                              })
                            }
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold capitalize transition ${
                              selectedTx.type === t
                                ? `${getTypePillClasses(t)} border-transparent`
                                : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#C9A84C]/50"
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Person
                      </label>
                      <div className="flex gap-1.5">
                        {members.map((m) => (
                          <button
                            key={m.uid}
                            type="button"
                            onClick={() =>
                              void handleUpdateTransaction(selectedTx.id, {
                                assignedTo: m.uid,
                                assignedToName: memberNameByUid.get(m.uid) || m.uid,
                              })
                            }
                            className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                              selectedTx.assignedTo === m.uid
                                ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                                : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#1B2A4A]/30"
                            }`}
                          >
                            {m.firstName || memberNameByUid.get(m.uid)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Category + Subcategory — only for non-transfer */}
                  {selectedTx.type !== "transfer" && (
                    <div className="space-y-3">
                      {/* Category buttons */}
                      <div>
                        <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                          Category
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {CATEGORIES.map((cat) => (
                            <button
                              key={cat.name}
                              type="button"
                              onClick={() =>
                                void handleUpdateTransaction(selectedTx.id, {
                                  category: cat.name,
                                  subcat: "",
                                  type: getDefaultType(cat.name),
                                })
                              }
                              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                selectedTx.category === cat.name
                                  ? "border-[#C9A84C] bg-[#C9A84C]/10 text-[#1B2A4A]"
                                  : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#C9A84C]/40"
                              }`}
                            >
                              {cat.emoji} {cat.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Subcategory — shown when a category is selected */}
                      {selectedTx.category && (
                        <div>
                          <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                              Subcategory
                            </label>
                            {selectedTx.subcat && (
                              <button
                                type="button"
                                onClick={() => void handleUpdateTransaction(selectedTx.id, { subcat: "" })}
                                className="text-[10px] text-[#9AA5B4] hover:text-red-500"
                              >
                                × clear
                              </button>
                            )}
                          </div>

                          {/* Existing subcategory pills */}
                          <div className="flex flex-wrap gap-1.5">
                            {(subcatsByParent[selectedTx.category] ?? []).map((sub) => (
                              <button
                                key={sub.id}
                                type="button"
                                onClick={() =>
                                  void handleUpdateTransaction(selectedTx.id, {
                                    subcat: sub.name,
                                    ...getAutoReviewedPatch("subcategory"),
                                  })
                                }
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  selectedTx.subcat === sub.name
                                    ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                                    : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#1B2A4A]/30"
                                }`}
                              >
                                {sub.name}
                              </button>
                            ))}

                            {/* Add new subcategory toggle */}
                            {!addingSubcatForTx[selectedTx.id] && (
                              <button
                                type="button"
                                onClick={() => {
                                  setAddingSubcatForTx((prev) => ({ ...prev, [selectedTx.id]: true }));
                                  setNewSubcatDrafts((prev) => ({
                                    ...prev,
                                    [selectedTx.id]: prev[selectedTx.id] ?? {
                                      name: "",
                                      parentCategory: selectedTx.category,
                                    },
                                  }));
                                }}
                                className="rounded-full border border-dashed border-[#C9A84C] px-2.5 py-1 text-[11px] font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]"
                              >
                                + New
                              </button>
                            )}
                          </div>

                          {/* New subcategory input — shown when adding */}
                          {addingSubcatForTx[selectedTx.id] && (
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                autoFocus
                                value={newSubcatDrafts[selectedTx.id]?.name ?? ""}
                                onChange={(e) =>
                                  setNewSubcatDrafts((prev) => ({
                                    ...prev,
                                    [selectedTx.id]: {
                                      name: e.target.value,
                                      parentCategory:
                                        prev[selectedTx.id]?.parentCategory || selectedTx.category,
                                    },
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") void handleSaveNewSubcategory(selectedTx);
                                  if (e.key === "Escape") {
                                    setAddingSubcatForTx((prev) => ({ ...prev, [selectedTx.id]: false }));
                                  }
                                }}
                                placeholder="Subcategory name..."
                                className="h-8 flex-1 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void handleSaveNewSubcategory(selectedTx)}
                                className="h-8 rounded-lg bg-[#C9A84C] px-3 text-xs font-bold text-[#1B2A4A]"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setAddingSubcatForTx((prev) => ({ ...prev, [selectedTx.id]: false }))
                                }
                                className="h-8 rounded-lg border border-[#E4E8F0] px-2 text-xs text-[#9AA5B4] hover:text-[#1B2A4A]"
                              >
                                ×
                              </button>
                            </div>
                          )}

                          {/* Current selection confirmation */}
                          {selectedTx.subcat && (
                            <p className="mt-1.5 text-[11px] text-[#1B2A4A]/60">
                              {getCategoryEmoji(selectedTx.category)} {selectedTx.category}
                              {" › "}
                              <span className="font-semibold text-[#1B2A4A]">{selectedTx.subcat}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedTx.type === "transfer" &&
                    (() => {
                      const fromAcc = selectedTx.transferFromAccountId
                        ? accountById.get(selectedTx.transferFromAccountId)
                        : null;
                      const toAcc = selectedTx.transferToAccountId
                        ? accountById.get(selectedTx.transferToAccountId)
                        : null;
                      const isPaired = Boolean(selectedTx.transferPairId);
                      const isSent = selectedTx.direction === "debit";

                      const fromLabel =
                        fromAcc?.nickname ??
                        (isSent
                          ? (selectedTx.accountSnapshot?.nickname ?? "This account")
                          : "External");
                      const toLabel =
                        toAcc?.nickname ??
                        (!isSent
                          ? (selectedTx.accountSnapshot?.nickname ?? "This account")
                          : "External");
                      const fromColor = fromAcc?.color ?? "#9AA5B4";
                      const toColor = toAcc?.color ?? "#9AA5B4";

                      const typeLabels = {
                        "card-payment": {
                          label: "Credit card payment",
                          icon: "💳",
                          desc: "Paying down a credit card balance",
                        },
                        internal: {
                          label: "Between my accounts",
                          icon: "🔄",
                          desc: "Moving money between your own accounts",
                        },
                        "external-own": {
                          label: "My other bank",
                          icon: "🏦",
                          desc: "Sent to or received from your own account at another bank",
                        },
                        "external-third-party": {
                          label: "Person / Business",
                          icon: "👤",
                          desc: "Zelle, Venmo, PayPal, cash, wire",
                        },
                      } as const;
                      const txTypeKey = selectedTx.transferType;
                      const currentTypeInfo =
                        txTypeKey === "card-payment" ||
                        txTypeKey === "internal" ||
                        txTypeKey === "external-own" ||
                        txTypeKey === "external-third-party"
                          ? typeLabels[txTypeKey]
                          : null;

                      return (
                        <div className="space-y-3">
                          {/* FROM → TO diagram */}
                          <div className="rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] p-4">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                                {currentTypeInfo?.icon}{" "}
                                {currentTypeInfo?.label ?? "Transfer"}
                              </p>
                              {isPaired ? (
                                <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                                  ✓ Linked pair
                                </span>
                              ) : (
                                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                                  ⚠ Single-sided
                                </span>
                              )}
                            </div>

                            {/* Visual flow */}
                            <div className="flex items-center gap-3">
                              {/* FROM */}
                              <div
                                className="flex-1 rounded-xl border-2 p-3 text-center"
                                style={{ borderColor: fromColor }}
                              >
                                <div
                                  className="mx-auto mb-1 h-3 w-3 rounded-full"
                                  style={{ backgroundColor: fromColor }}
                                />
                                <p className="text-xs font-bold text-[#1B2A4A]">
                                  {fromLabel}
                                </p>
                                {fromAcc && (
                                  <p className="font-mono text-[9px] text-[#9AA5B4]">
                                    ••{fromAcc.last4}
                                  </p>
                                )}
                                <span className="mt-1 inline-block rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold text-orange-600">
                                  ↑ OUT
                                </span>
                              </div>

                              {/* Arrow + Amount */}
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-lg font-bold text-[#1B2A4A]">
                                  $
                                  {Number(selectedTx.amount).toFixed(2)}
                                </span>
                                <span className="text-xl text-[#9AA5B4]">→</span>
                                <span className="text-[9px] text-[#9AA5B4]">
                                  {selectedTx.date}
                                </span>
                              </div>

                              {/* TO */}
                              <div
                                className="flex-1 rounded-xl border-2 p-3 text-center"
                                style={{ borderColor: toColor }}
                              >
                                <div
                                  className="mx-auto mb-1 h-3 w-3 rounded-full"
                                  style={{ backgroundColor: toColor }}
                                />
                                <p className="text-xs font-bold text-[#1B2A4A]">
                                  {toLabel}
                                </p>
                                {toAcc && (
                                  <p className="font-mono text-[9px] text-[#9AA5B4]">
                                    ••{toAcc.last4}
                                  </p>
                                )}
                                <span className="mt-1 inline-block rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold text-green-600">
                                  ↓ IN
                                </span>
                              </div>
                            </div>
                          </div>

                          {/* Transfer type classification — plain language */}
                          <div>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                              What kind of transfer?
                            </p>
                            <div className="grid grid-cols-2 gap-2">
                              {(Object.entries(typeLabels) as [keyof typeof typeLabels, (typeof typeLabels)[keyof typeof typeLabels]][]).map(([val, info]) => (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() =>
                                    void handleUpdateTransaction(selectedTx.id, {
                                      transferType: val,
                                    })
                                  }
                                  className={`rounded-xl border p-2.5 text-left transition ${
                                    selectedTx.transferType === val
                                      ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                                      : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#1B2A4A]/30"
                                  }`}
                                >
                                  <p className="text-sm font-bold">
                                    {info.icon} {info.label}
                                  </p>
                                  <p
                                    className={`mt-0.5 text-[9px] leading-tight ${
                                      selectedTx.transferType === val
                                        ? "text-white/60"
                                        : "text-[#9AA5B4]"
                                    }`}
                                  >
                                    {info.desc}
                                  </p>
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Account reassignment */}
                          <div>
                            <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                              {isPaired
                                ? "Change destination account"
                                : "Which account did this go to / come from?"}
                            </p>

                            <div className="space-y-1.5">
                              {/* FROM account picker */}
                              <div className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-right text-[10px] font-bold text-orange-500">
                                  FROM
                                </span>
                                <select
                                  value={
                                    selectedTx.transferFromAccountId ||
                                    "__external__"
                                  }
                                  onChange={async (e) => {
                                    const val = e.target.value;
                                    await handleUpdateTransaction(selectedTx.id, {
                                      transferFromAccountId:
                                        val !== "__external__" ? val : "",
                                    });
                                    if (selectedTx.transferPairId) {
                                      const pair = transactions.find(
                                        (t) =>
                                          t.transferPairId ===
                                            selectedTx.transferPairId &&
                                          t.id !== selectedTx.id
                                      );
                                      if (pair) {
                                        await handleUpdateTransaction(pair.id, {
                                          transferFromAccountId:
                                            val !== "__external__" ? val : "",
                                        });
                                      }
                                    }
                                  }}
                                  className="h-8 flex-1 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                                >
                                  <option value="__external__">
                                    External (not in app)
                                  </option>
                                  {accounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.nickname} ••{acc.last4}
                                    </option>
                                  ))}
                                </select>
                              </div>

                              {/* TO account picker */}
                              <div className="flex items-center gap-2">
                                <span className="w-16 shrink-0 text-right text-[10px] font-bold text-green-600">
                                  TO
                                </span>
                                <select
                                  value={
                                    selectedTx.transferToAccountId ||
                                    "__external__"
                                  }
                                  onChange={async (e) => {
                                    const val = e.target.value;
                                    await handleUpdateTransaction(selectedTx.id, {
                                      transferToAccountId:
                                        val !== "__external__" ? val : "",
                                    });
                                    if (selectedTx.transferPairId) {
                                      const pair = transactions.find(
                                        (t) =>
                                          t.transferPairId ===
                                            selectedTx.transferPairId &&
                                          t.id !== selectedTx.id
                                      );
                                      if (pair) {
                                        await handleUpdateTransaction(pair.id, {
                                          transferToAccountId:
                                            val !== "__external__" ? val : "",
                                        });
                                      }
                                    }
                                  }}
                                  className="h-8 flex-1 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                                >
                                  <option value="__external__">
                                    External (not in app)
                                  </option>
                                  {accounts.map((acc) => (
                                    <option key={acc.id} value={acc.id}>
                                      {acc.nickname} ••{acc.last4}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </div>

                            {isPaired && (
                              <p className="mt-1.5 text-[9px] text-[#9AA5B4]">
                                ✓ Both sides of the pair will update together
                              </p>
                            )}
                          </div>

                          {/* Convert to expense */}
                          <div className="rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-4 py-3">
                            <p className="mb-1 text-[10px] font-bold text-[#9AA5B4]">
                              Misclassified? This was actually a purchase.
                            </p>
                            <button
                              type="button"
                              onClick={() =>
                                void handleUpdateTransaction(selectedTx.id, {
                                  type: "expense",
                                  transferType: "",
                                  transferPairId: "",
                                  transferFromAccountId: "",
                                  transferToAccountId: "",
                                })
                              }
                              className="rounded-lg border border-[#E4E8F0] bg-white px-3 py-1.5 text-[10px] font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                            >
                              Convert to expense →
                            </button>
                          </div>
                        </div>
                      );
                    })()}

                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                      Account
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {accounts.map((acc) => (
                        <button
                          key={acc.id}
                          type="button"
                          onClick={() => void assignAccount(selectedTx.id, acc.id)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                            selectedTx.accountId === acc.id
                              ? "border-transparent text-white"
                              : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:border-[#C9A84C]/40"
                          }`}
                          style={selectedTx.accountId === acc.id ? { backgroundColor: acc.color || "#C9A84C" } : undefined}
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{
                              backgroundColor: acc.color || "#C9A84C",
                              opacity: selectedTx.accountId === acc.id ? 0 : 1,
                            }}
                          />
                          {acc.nickname}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Amount
                      </label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9AA5B4]">
                          $
                        </span>
                        <input
                          type="number"
                          value={selectedTx.amount}
                          onChange={(e) =>
                            void handleUpdateTransaction(selectedTx.id, {
                              amount: Math.abs(Number(e.target.value)),
                            })
                          }
                          className="h-10 w-full rounded-lg border border-[#E4E8F0] bg-white pl-7 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Date
                      </label>
                      <input
                        type="date"
                        value={selectedTx.date}
                        onChange={(e) => void handleUpdateTransaction(selectedTx.id, { date: e.target.value })}
                        className="h-10 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                      Description
                    </label>
                    <input
                      value={selectedTx.desc}
                      onChange={(e) => void handleUpdateTransaction(selectedTx.id, { desc: e.target.value })}
                      className="h-10 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                      Comment
                    </label>
                    <input
                      value={selectedTx.comment}
                      onChange={(e) =>
                        void handleUpdateTransaction(selectedTx.id, {
                          comment: e.target.value,
                          commentBy: user.uid,
                        })
                      }
                      placeholder="Add a note about this transaction..."
                      className="h-10 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                    />
                  </div>

                  {selectedTx.flagged && (
                    <div>
                      <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-amber-500">
                        Flag Reason
                      </label>
                      <input
                        value={selectedTx.flagReason}
                        onChange={(e) => void handleUpdateTransaction(selectedTx.id, { flagReason: e.target.value })}
                        placeholder="Why is this flagged?"
                        className="h-10 w-full rounded-lg border border-amber-200 bg-amber-50 px-3 text-sm focus:border-amber-400 focus:outline-none"
                      />
                    </div>
                  )}
                </div>
              </div>

              <div className="shrink-0 border-t border-[#E4E8F0] bg-white px-6 py-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      const idx = sortedTransactions.findIndex((t) => t.id === selectedTxId);
                      const prev = sortedTransactions[idx - 1];
                      if (prev) setSelectedTxId(prev.id);
                    }}
                    disabled={sortedTransactions.findIndex((t) => t.id === selectedTxId) === 0}
                    className="rounded-lg border border-[#E4E8F0] px-4 py-2 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA] disabled:opacity-30"
                  >
                    ↑ Previous
                  </button>
                  <span className="text-xs text-[#9AA5B4]">
                    {sortedTransactions.findIndex((t) => t.id === selectedTxId) + 1} of {sortedTransactions.length}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = sortedTransactions.findIndex((t) => t.id === selectedTxId);
                      const next = sortedTransactions[idx + 1];
                      if (next) setSelectedTxId(next.id);
                    }}
                    disabled={sortedTransactions.findIndex((t) => t.id === selectedTxId) === sortedTransactions.length - 1}
                    className="rounded-lg border border-[#E4E8F0] px-4 py-2 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA] disabled:opacity-30"
                  >
                    ↓ Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 rounded-xl border-l-4 border-green-500 bg-white px-4 py-3 text-sm font-medium text-[#1B2A4A] shadow-lg">
          {toastMessage}
        </div>
      )}

      {showAddTransactionModal && householdId && user ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" style={{ backdropFilter: "blur(4px)" }}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl border border-[#E4E8F0] bg-white p-6 shadow-[0_20px_60px_rgba(27,42,74,0.15)]">
            <div className="flex items-start justify-between mb-4">
              <h3 className="text-2xl font-semibold text-[#1B2A4A]">Add Transaction</h3>
              <button
                type="button"
                onClick={() => setShowAddTransactionModal(false)}
                className="text-lg text-[#1B2A4A]/70 hover:text-[#1B2A4A]"
              >
                ×
              </button>
            </div>
            <AddTransactionForm
              householdId={householdId}
              user={user}
              accounts={accounts}
              members={members}
              subcatsByParent={subcatsByParent}
              defaultAssignedTo={user.uid}
              onSaved={(result) => {
                setToastMessage(result.message);
                if (result.success) setShowAddTransactionModal(false);
              }}
              onCancel={() => setShowAddTransactionModal(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
