"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useMembers } from "@/app/hooks/useMembers";
import { useSubcategories } from "@/app/hooks/useSubcategories";
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
};

type SortKey = "date" | "desc" | "amount" | "category" | "assignedToName";
type TransactionPatch = Partial<Omit<Transaction, "id">> & {
  reviewedBy?: string;
  reviewedAt?: unknown;
};

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function getSignedAmount(tx: Pick<Transaction, "amount" | "type">) {
  const sign = tx.type === "income" || tx.type === "refund" ? "+" : "-";
  return `${sign}${formatMoney(Math.abs(tx.amount || 0))}`;
}

function getAmountColor(tx: Pick<Transaction, "type">) {
  return tx.type === "income" || tx.type === "refund" ? "text-green-700" : "text-red-600";
}

function getTypePillClasses(type: TransactionType) {
  if (type === "income") return "bg-green-100 text-green-800";
  if (type === "transfer") return "bg-blue-100 text-blue-800";
  if (type === "refund") return "bg-yellow-100 text-yellow-800";
  return "bg-red-100 text-red-700";
}

export default function OnboardingReviewPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId, setHouseholdId] = useState("");
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");
  const [startingAnalysis, setStartingAnalysis] = useState(false);
  const [markingAllReviewed, setMarkingAllReviewed] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<SortKey>("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const parsingInFlightRef = useRef<Set<string>>(new Set());

  const [docFilter, setDocFilter] = useState("all");
  const [spouseFilter, setSpouseFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [flaggedFilter, setFlaggedFilter] = useState("all");
  const [reviewedFilter, setReviewedFilter] = useState("unreviewed");
  const [search, setSearch] = useState("");
  const [subcategoryHideGraceUntil, setSubcategoryHideGraceUntil] = useState<Record<string, number>>(
    {},
  );
  const [addingSubcatForTx, setAddingSubcatForTx] = useState<Record<string, boolean>>({});
  const [newSubcatDrafts, setNewSubcatDrafts] = useState<
    Record<string, { name: string; parentCategory: string }>
  >({});

  const documents = useDocuments(householdId || undefined);
  const members = useMembers(householdId || undefined);
  const { subcatsByParent, addSubcategory } = useSubcategories(householdId || undefined);

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

        if (userData.onboardingStep === "complete") {
          router.replace("/dashboard");
          return;
        }

        const foundHouseholdId =
          typeof userData.householdId === "string" ? userData.householdId : "";
        if (!foundHouseholdId) {
          throw new Error("No household found for this account.");
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
          } satisfies Transaction;
        });
        setTransactions(parsed);
      },
      () => setTransactions([]),
    );

    return unsubscribe;
  }, [householdId]);

  useEffect(() => {
    if (!householdId) {
      return;
    }

    // FIX 6 — only parse docs with status === 'uploaded'.
    const unparsedDocs = documents.filter((d) => d.status === "uploaded");
    if (unparsedDocs.length === 0) {
      return;
    }

    const parseDoc = async (docItem: (typeof documents)[number]) => {
      if (parsingInFlightRef.current.has(docItem.id)) {
        return;
      }

      parsingInFlightRef.current.add(docItem.id);

      try {
        const response = await fetch("/api/parse-document", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storagePath: docItem.storagePath,
            householdId,
            docId: docItem.id,
            fileName: docItem.fileName,
          }),
        });

        if (!response.ok) {
          const text = await response.text();
          throw new Error(`Parse failed: ${response.status} ${text.slice(0, 100)}`);
        }
      } catch (parseError) {
        const message =
          parseError instanceof Error ? parseError.message : "Could not parse one document.";
        setError(message);
      } finally {
        parsingInFlightRef.current.delete(docItem.id);
      }
    };

    for (const docItem of unparsedDocs) {
      void parseDoc(docItem);
    }
  }, [documents, householdId]);

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

  const filteredTransactions = useMemo(() => {
    const now = Date.now();
    return transactions.filter((tx) => {
      if (docFilter !== "all" && tx.docId !== docFilter) return false;
      if (spouseFilter !== "all" && tx.assignedTo !== spouseFilter) return false;
      if (categoryFilter !== "all" && tx.category !== categoryFilter) return false;
      if (typeFilter !== "all" && tx.type !== typeFilter) return false;
      if (flaggedFilter === "flagged" && !tx.flagged) return false;
      const inSubcategoryGrace =
        tx.reviewedReason === "subcategory" &&
        typeof subcategoryHideGraceUntil[tx.id] === "number" &&
        subcategoryHideGraceUntil[tx.id] > now;
      if (reviewedFilter === "unreviewed" && tx.reviewed && !inSubcategoryGrace) return false;
      if (reviewedFilter === "reviewed" && !tx.reviewed) return false;
      if (search.trim() && !tx.desc.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [
    transactions,
    docFilter,
    spouseFilter,
    categoryFilter,
    typeFilter,
    flaggedFilter,
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
        (sum, tx) => (tx.type === "income" || tx.type === "refund" ? sum + tx.amount : sum),
        0,
      ),
    [filteredTransactions],
  );
  const totalExpenses = useMemo(
    () =>
      filteredTransactions.reduce(
        (sum, tx) => (tx.type === "expense" || tx.type === "transfer" ? sum + tx.amount : sum),
        0,
      ),
    [filteredTransactions],
  );
  const netAmount = totalIncome - totalExpenses;

  const dateRange = useMemo(() => {
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

  const handleUpdateTransaction = async (
    txId: string,
    patch: TransactionPatch,
  ) => {
    if (!householdId) return;
    try {
      await updateDoc(doc(db, "households", householdId, "transactions", txId), patch);
    } catch (updateError) {
      const message =
        updateError instanceof Error ? updateError.message : "Could not update transaction.";
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

  const handleSubcategorySelect = async (tx: Transaction, selectedValue: string) => {
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

  const toggleAll = () => {
    if (selectedIds.size === sortedTransactions.length) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(sortedTransactions.map((tx) => tx.id)));
  };

  const toggleOne = (id: string) => {
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

  const deleteSelected = async () => {
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

  const startAiAnalysis = async () => {
    if (!user) return;

    try {
      setStartingAnalysis(true);
      setError("");
      await updateDoc(doc(db, "users", user.uid), {
        onboardingStep: "analyzing",
      });
      router.push("/onboarding/analyzing");
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : "Could not start AI analysis.";
      setError(message);
    } finally {
      setStartingAnalysis(false);
    }
  };

  // FIX 8 — drive state from realtime document statuses.
  const allDone =
    documents.length > 0 &&
    documents.every((d) => d.status === "complete" || d.status === "error");
  const isParsing = documents.some((d) => d.status === "parsing" || d.status === "uploaded");
  const erroredDocs = documents.filter((d) => d.status === "error");

  const retryDocument = async (docItem: (typeof documents)[number]) => {
    if (!householdId) return;

    try {
      await updateDoc(doc(db, "households", householdId, "documents", docItem.id), {
        status: "uploaded",
        error: null,
      });
      const response = await fetch("/api/parse-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storagePath: docItem.storagePath,
          householdId,
          docId: docItem.id,
          fileName: docItem.fileName,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Parse failed: ${response.status} ${text.slice(0, 100)}`);
      }
    } catch (retryError) {
      const message =
        retryError instanceof Error ? retryError.message : "Could not retry parsing document.";
      setError(message);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDir("asc");
  };

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? "↑" : "↓") : "↕";

  useEffect(() => {
    if (!toastMessage) return;
    const timer = window.setTimeout(() => setToastMessage(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toastMessage]);

  if (authLoading || loadingContext) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl space-y-5">
        <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-6">
          <h1 className="text-3xl font-bold md:text-4xl">Review & Edit Transactions</h1>
          <p className="mt-2 text-sm text-[#1B2A4A]/75 md:text-base">
            Confirm parsed transactions before starting AI analysis.
          </p>
        </section>

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
        {toastMessage ? (
          <div className="rounded-lg border border-[#C9A84C] bg-[#FFF8E8] px-3 py-2 text-sm font-medium text-[#1B2A4A]">
            {toastMessage}
          </div>
        ) : null}

        {isParsing ? (
          <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10">
            <h2 className="text-lg font-semibold">Parsing your documents...</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {documents.map((docItem) => (
                <li key={docItem.id} className="rounded-lg bg-[#F4F6FA] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span>
                      {docItem.status === "complete"
                        ? "✅"
                        : docItem.status === "parsing"
                          ? "🔄"
                          : docItem.status === "uploaded"
                            ? "⏳"
                            : docItem.status === "error"
                              ? "❌"
                              : "•"}{" "}
                      {docItem.fileName} —{" "}
                      <span className="font-medium">
                        {docItem.status === "complete"
                          ? `complete (${docItem.transactionCount || 0} transactions)`
                          : docItem.status === "parsing"
                            ? "parsing..."
                            : docItem.status === "uploaded"
                              ? "waiting..."
                              : docItem.status === "error"
                                ? "error"
                                : docItem.status}
                      </span>
                    </span>
                    {docItem.status === "error" ? (
                      <button
                        type="button"
                        onClick={() => void retryDocument(docItem)}
                        className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-600"
                      >
                        Retry
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {allDone ? (
          <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10">
            <p className="text-sm font-medium text-[#1B2A4A]/75">
              All documents parsed. Review your transactions below.
            </p>
            {erroredDocs.length > 0 ? (
              <ul className="mt-3 space-y-2 text-sm">
                {erroredDocs.map((docItem) => (
                  <li
                    key={docItem.id}
                    className="flex items-center justify-between gap-3 rounded-lg bg-[#F4F6FA] p-3"
                  >
                    <span>
                      ❌ {docItem.fileName} — error
                    </span>
                    <button
                      type="button"
                      onClick={() => void retryDocument(docItem)}
                      className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-600"
                    >
                      Retry
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}

        {allDone ? (
          <section className="space-y-3 rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-6">
          <div className="flex items-center justify-end">
            <Link
              href="/settings/categories"
              className="text-xs font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
            >
              Manage categories →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <select
              value={docFilter}
              onChange={(event) => setDocFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="all">All documents</option>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.fileName || d.id}
                </option>
              ))}
            </select>

            <select
              value={spouseFilter}
              onChange={(event) => setSpouseFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="all">All spouses</option>
              {members.map((member) => (
                <option key={member.uid} value={member.uid}>
                  {memberNameByUid.get(member.uid)}
                </option>
              ))}
            </select>

            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category.name} value={category.name}>
                  {category.emoji} {category.name}
                </option>
              ))}
            </select>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search merchant"
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            />

            <select
              value={flaggedFilter}
              onChange={(event) => setFlaggedFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="all">Show all rows</option>
              <option value="flagged">Show flagged only</option>
            </select>

            <select
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="all">All types</option>
              <option value="income">Income</option>
              <option value="expense">Expense</option>
              <option value="transfer">Transfer</option>
              <option value="refund">Refund</option>
            </select>

            <select
              value={reviewedFilter}
              onChange={(event) => setReviewedFilter(event.target.value)}
              className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-[#F4F6FA] px-2 text-sm"
            >
              <option value="unreviewed">Hide reviewed</option>
              <option value="reviewed">Show reviewed only</option>
              <option value="all">Show all review states</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Total transactions: {sortedTransactions.length}</span>
            <span className="text-green-700">Total Income: {formatMoney(totalIncome)}</span>
            <span className="text-red-600">Total Expenses: {formatMoney(totalExpenses)}</span>
            <span className={netAmount >= 0 ? "text-green-700" : "text-red-600"}>
              Net: {netAmount >= 0 ? "+" : "-"}
              {formatMoney(Math.abs(netAmount))}
            </span>
            <span>Date range: {dateRange}</span>
            <span>
              {reviewedReviewableCount} of {totalReviewableCount} reviewed
            </span>
            <span className="rounded-full bg-yellow-100 px-2 py-1 text-yellow-800">
              {flaggedCount} flagged for review
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
            <div
              className="h-2 rounded-full bg-[#C9A84C] transition-all"
              style={{ width: `${reviewedProgressPercent}%` }}
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={
                sortedTransactions.length > 0 && selectedIds.size === sortedTransactions.length
              }
              onChange={toggleAll}
            />
            <span className="text-sm">Select all</span>
            <button
              type="button"
              onClick={deleteSelected}
              disabled={selectedIds.size === 0}
              className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 disabled:opacity-50"
            >
              Delete selected
            </button>
            <button
              type="button"
              onClick={() => void markAllAsReviewed()}
              disabled={markingAllReviewed || pendingReviewableCount === 0}
              className="rounded-lg border border-[#C9A84C] px-3 py-1 text-xs font-semibold text-[#1B2A4A] disabled:opacity-50"
            >
              {markingAllReviewed ? "Marking..." : "✓ Mark All as Reviewed"}
            </button>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="text-left text-xs text-[#1B2A4A]/70">
                  <th className="py-2">Sel</th>
                  <th>
                    <button type="button" onClick={() => handleSort("date")} className="font-semibold">
                      Date {sortIndicator("date")}
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => handleSort("desc")} className="font-semibold">
                      Merchant {sortIndicator("desc")}
                    </button>
                  </th>
                  <th>
                    <button type="button" onClick={() => handleSort("amount")} className="font-semibold">
                      Amount {sortIndicator("amount")}
                    </button>
                  </th>
                  <th>Type</th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort("category")}
                      className="font-semibold"
                    >
                      Category {sortIndicator("category")}
                    </button>
                  </th>
                  <th>
                    <button
                      type="button"
                      onClick={() => handleSort("assignedToName")}
                      className="font-semibold"
                    >
                      Assigned To {sortIndicator("assignedToName")}
                    </button>
                  </th>
                  <th>Comment</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedTransactions.map((tx, index) => (
                  <tr
                    key={tx.id}
                    className={
                      tx.reviewed
                        ? "bg-green-50"
                        : tx.flagged
                          ? "bg-yellow-50"
                          : index % 2
                            ? "bg-[#F9FAFC]"
                            : "bg-white"
                    }
                  >
                    <td className="py-2">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(tx.id)}
                        onChange={() => toggleOne(tx.id)}
                      />
                    </td>
                    <td>
                      <input
                        value={tx.date}
                        onChange={(event) =>
                          void handleUpdateTransaction(tx.id, { date: event.target.value })
                        }
                        className="h-9 w-28 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                      />
                    </td>
                    <td>
                      <div className="space-y-1">
                        <input
                          value={tx.desc}
                          onChange={(event) =>
                            void handleUpdateTransaction(tx.id, { desc: event.target.value })
                          }
                          className="h-9 w-52 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                        />
                        {tx.flagged && !tx.reviewed ? (
                          <div className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[11px] font-medium text-yellow-800">
                            <span>⚠️</span>
                            <span>{tx.flagReason || "Possible duplicate — please verify"}</span>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="space-y-1">
                        <div className={`text-xs font-semibold ${getAmountColor(tx)}`}>
                          {getSignedAmount(tx)}
                        </div>
                        <input
                          type="number"
                          value={tx.amount}
                          onChange={(event) =>
                            void handleUpdateTransaction(tx.id, {
                              amount: Math.abs(Number(event.target.value)),
                            })
                          }
                          className="h-9 w-28 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                        />
                      </div>
                    </td>
                    <td>
                      <select
                        value={tx.type}
                        onChange={(event) =>
                          void handleUpdateTransaction(tx.id, {
                            type: event.target.value as TransactionType,
                          })
                        }
                        className={`h-8 w-28 rounded-full px-2 text-xs font-semibold ${getTypePillClasses(
                          tx.type,
                        )}`}
                      >
                        <option value="expense">Expense</option>
                        <option value="income">Income</option>
                        <option value="transfer">Transfer</option>
                        <option value="refund">Refund</option>
                      </select>
                    </td>
                    <td>
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-[#1B2A4A]/70">
                          {tx.subcat
                            ? `${getCategoryEmoji(tx.category)} ${tx.category} › ${tx.subcat}`
                            : `${getCategoryEmoji(tx.category)} ${tx.category}`}
                        </div>
                        <select
                          value={tx.category}
                          onChange={(event) =>
                            void handleUpdateTransaction(tx.id, {
                              category: event.target.value,
                              subcat: "",
                              type: getDefaultType(event.target.value),
                              reviewed: false,
                              reviewedBy: "",
                              reviewedAt: null,
                              reviewedReason: "",
                            })
                          }
                          className="h-9 w-40 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                        >
                          {CATEGORIES.map((category) => (
                            <option key={category.name} value={category.name}>
                              {category.emoji} {category.name}
                            </option>
                          ))}
                        </select>
                        {(subcatsByParent[tx.category] ?? []).length > 0 ? (
                          <select
                            value={tx.subcat || ""}
                            onChange={(event) =>
                              void handleSubcategorySelect(tx, event.target.value)
                            }
                            className="h-9 w-40 rounded border border-transparent bg-transparent px-2 text-xs hover:border-[#C9A84C] focus:border-[#C9A84C]"
                          >
                            <option value="">No subcategory</option>
                            {(subcatsByParent[tx.category] ?? []).map((subcat) => (
                              <option key={subcat.id} value={subcat.name}>
                                {subcat.name}
                              </option>
                            ))}
                            <option value="__add_new__">➕ Add new</option>
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setAddingSubcatForTx((prev) => ({ ...prev, [tx.id]: true }));
                              setNewSubcatDrafts((prev) => ({
                                ...prev,
                                [tx.id]: prev[tx.id] ?? { name: "", parentCategory: tx.category },
                              }));
                            }}
                            className="text-xs font-semibold text-[#C9A84C]"
                          >
                            + Add subcategory
                          </button>
                        )}
                        {addingSubcatForTx[tx.id] ? (
                          <div className="flex items-center gap-1">
                            <input
                              value={newSubcatDrafts[tx.id]?.name ?? ""}
                              onChange={(event) =>
                                setNewSubcatDrafts((prev) => ({
                                  ...prev,
                                  [tx.id]: {
                                    name: event.target.value,
                                    parentCategory: prev[tx.id]?.parentCategory || tx.category,
                                  },
                                }))
                              }
                              placeholder="New subcategory"
                              className="h-8 w-24 rounded border border-[#1B2A4A]/20 bg-white px-2 text-xs"
                            />
                            <select
                              value={newSubcatDrafts[tx.id]?.parentCategory ?? tx.category}
                              onChange={(event) =>
                                setNewSubcatDrafts((prev) => ({
                                  ...prev,
                                  [tx.id]: {
                                    name: prev[tx.id]?.name ?? "",
                                    parentCategory: event.target.value,
                                  },
                                }))
                              }
                              className="h-8 w-24 rounded border border-[#1B2A4A]/20 bg-white px-1 text-xs"
                            >
                              {CATEGORIES.map((category) => (
                                <option key={category.name} value={category.name}>
                                  {category.emoji} {category.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => void handleSaveNewSubcategory(tx)}
                              className="h-8 rounded bg-[#C9A84C] px-2 text-xs font-semibold text-[#1B2A4A]"
                            >
                              Save
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <select
                        value={tx.assignedTo}
                        onChange={(event) =>
                          void handleUpdateTransaction(tx.id, {
                            assignedTo: event.target.value,
                            assignedToName: memberNameByUid.get(event.target.value) || "Unknown",
                          })
                        }
                        className="h-9 w-40 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                      >
                        {members.map((member) => (
                          <option key={member.uid} value={member.uid}>
                            {memberNameByUid.get(member.uid)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        value={tx.comment}
                        onChange={(event) =>
                          void handleUpdateTransaction(tx.id, {
                            comment: event.target.value,
                            commentBy: user.uid,
                          })
                        }
                        className="h-9 w-48 rounded border border-transparent bg-transparent px-2 text-sm hover:border-[#C9A84C] focus:border-[#C9A84C]"
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={tx.reviewed}
                            onChange={(event) =>
                              void handleUpdateTransaction(tx.id, {
                                reviewed: event.target.checked,
                                reviewedBy: event.target.checked ? user.uid : "",
                                reviewedAt: event.target.checked ? serverTimestamp() : null,
                                reviewedReason: event.target.checked ? "skip" : "",
                              })
                            }
                          />
                          Reviewed
                        </label>
                        <button
                          type="button"
                          onClick={() => void deleteOne(tx.id)}
                          className="text-xs font-semibold text-red-600 underline underline-offset-2"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-3 md:hidden">
            {sortedTransactions.map((tx) => (
              <article
                key={tx.id}
                className={
                  tx.reviewed
                    ? "rounded-xl border border-green-200 bg-green-50 p-3"
                    : tx.flagged
                      ? "rounded-xl border border-yellow-300 bg-[#F9FAFC] p-3"
                      : "rounded-xl bg-[#F9FAFC] p-3"
                }
              >
                <div className="grid grid-cols-1 gap-2">
                  {tx.flagged && !tx.reviewed ? (
                    <div className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-1 text-xs font-medium text-yellow-800">
                      <span>⚠️</span>
                      <span>{tx.flagReason || "Possible duplicate — please verify"}</span>
                    </div>
                  ) : null}
                  <input
                    value={tx.date}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, { date: event.target.value })
                    }
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                  />
                  <input
                    value={tx.desc}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, { desc: event.target.value })
                    }
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                  />
                  <input
                    type="number"
                    value={tx.amount}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, {
                        amount: Math.abs(Number(event.target.value)),
                      })
                    }
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                  />
                  <div className={`text-xs font-semibold ${getAmountColor(tx)}`}>
                    {getSignedAmount(tx)}
                  </div>
                  <select
                    value={tx.type}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, {
                        type: event.target.value as TransactionType,
                      })
                    }
                    className={`h-10 rounded-lg px-2 text-sm font-semibold ${getTypePillClasses(tx.type)}`}
                  >
                    <option value="expense">Expense</option>
                    <option value="income">Income</option>
                    <option value="transfer">Transfer</option>
                    <option value="refund">Refund</option>
                  </select>
                  <div className="space-y-1">
                    <span className="inline-flex rounded-full bg-[#1B2A4A]/10 px-2 py-1 text-xs font-semibold text-[#1B2A4A]">
                      {getCategoryEmoji(tx.category)} {tx.category}
                    </span>
                    {tx.subcat ? (
                      <p className="text-xs text-[#1B2A4A]/75">{tx.subcat}</p>
                    ) : (
                      <p className="text-xs text-[#1B2A4A]/60">No subcategory</p>
                    )}
                  </div>
                  <select
                    value={tx.category}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, {
                        category: event.target.value,
                        subcat: "",
                        type: getDefaultType(event.target.value),
                        reviewed: false,
                        reviewedBy: "",
                        reviewedAt: null,
                        reviewedReason: "",
                      })
                    }
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                  >
                    {CATEGORIES.map((category) => (
                      <option key={category.name} value={category.name}>
                        {category.emoji} {category.name}
                      </option>
                    ))}
                  </select>
                  {(subcatsByParent[tx.category] ?? []).length > 0 ? (
                    <select
                      value={tx.subcat || ""}
                      onChange={(event) => void handleSubcategorySelect(tx, event.target.value)}
                      className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                    >
                      <option value="">No subcategory</option>
                      {(subcatsByParent[tx.category] ?? []).map((subcat) => (
                        <option key={subcat.id} value={subcat.name}>
                          {subcat.name}
                        </option>
                      ))}
                      <option value="__add_new__">➕ Add new</option>
                    </select>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setAddingSubcatForTx((prev) => ({ ...prev, [tx.id]: true }));
                        setNewSubcatDrafts((prev) => ({
                          ...prev,
                          [tx.id]: prev[tx.id] ?? { name: "", parentCategory: tx.category },
                        }));
                      }}
                      className="h-10 rounded-lg border border-dashed border-[#C9A84C] bg-[#FFF8E8] px-2 text-sm font-semibold text-[#1B2A4A]"
                    >
                      + Add subcategory
                    </button>
                  )}
                  {addingSubcatForTx[tx.id] ? (
                    <div className="grid grid-cols-1 gap-2">
                      <input
                        value={newSubcatDrafts[tx.id]?.name ?? ""}
                        onChange={(event) =>
                          setNewSubcatDrafts((prev) => ({
                            ...prev,
                            [tx.id]: {
                              name: event.target.value,
                              parentCategory: prev[tx.id]?.parentCategory || tx.category,
                            },
                          }))
                        }
                        placeholder="New subcategory"
                        className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                      />
                      <select
                        value={newSubcatDrafts[tx.id]?.parentCategory ?? tx.category}
                        onChange={(event) =>
                          setNewSubcatDrafts((prev) => ({
                            ...prev,
                            [tx.id]: {
                              name: prev[tx.id]?.name ?? "",
                              parentCategory: event.target.value,
                            },
                          }))
                        }
                        className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                      >
                        {CATEGORIES.map((category) => (
                          <option key={category.name} value={category.name}>
                            {category.emoji} {category.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleSaveNewSubcategory(tx)}
                        className="h-10 rounded-lg bg-[#C9A84C] px-2 text-sm font-semibold text-[#1B2A4A]"
                      >
                        Save subcategory
                      </button>
                    </div>
                  ) : null}
                  <input
                    value={tx.comment}
                    onChange={(event) =>
                      void handleUpdateTransaction(tx.id, {
                        comment: event.target.value,
                        commentBy: user.uid,
                      })
                    }
                    placeholder="Comment"
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={tx.reviewed}
                      onChange={(event) =>
                        void handleUpdateTransaction(tx.id, {
                          reviewed: event.target.checked,
                          reviewedBy: event.target.checked ? user.uid : "",
                          reviewedAt: event.target.checked ? serverTimestamp() : null,
                          reviewedReason: event.target.checked ? "skip" : "",
                        })
                      }
                    />
                    Mark reviewed
                  </label>
                </div>
              </article>
            ))}
          </div>
          </section>
        ) : null}

        <div className="space-y-3">
          <Link
            href="/onboarding/upload"
            className="inline-block text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
          >
            ← Back to Documents
          </Link>
          <button
            type="button"
            onClick={startAiAnalysis}
            disabled={startingAnalysis}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
          >
            {startingAnalysis ? "Starting..." : "Start AI Analysis →"}
          </button>
        </div>
      </div>
    </div>
  );
}
