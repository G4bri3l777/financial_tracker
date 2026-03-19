"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc, collection, doc, getDoc, onSnapshot,
  serverTimestamp, setDoc, updateDoc,
} from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";
import { useAuth } from "@/app/hooks/useAuth";
import OnboardingProgressDots from "@/app/components/OnboardingProgressDots";
import { useAccounts, type AccountType, type AccountSubtype } from "@/app/hooks/useAccounts";
import { useDocuments } from "@/app/hooks/useDocuments";
import { db, storage } from "@/app/lib/firebase";

// Re-use account type helpers from review page
type AccountDraft = {
  id?: string;
  bankName: string;
  nickname: string;
  last4: string;
  cardLast4: string;
  creditLimit: string;
  type: AccountType;
  subtype: AccountSubtype;
  owner: string;
  ownerName: string;
  color: string;
  hasSubAccounts: boolean;
  subAccounts: { label: string; type: AccountSubtype; last4: string }[];
};

const COLORS = [
  "#C9A84C","#1B2A4A","#EF4444","#22C55E",
  "#3B82F6","#8B5CF6","#F97316","#14B8A6",
];

function formatCardMask(last4: string) {
  return `•••• •••• •••• ${last4 || "----"}`;
}

export default function OnboardingAccountsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [members, setMembers] = useState<{ uid: string; firstName: string }[]>([]);
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [error, setError] = useState("");
  const [continuing, setContinuing] = useState(false);

  // Account form state
  const [showForm, setShowForm] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);
  const [draft, setDraft] = useState<AccountDraft>({
    bankName: "", nickname: "", last4: "", cardLast4: "",
    creditLimit: "", type: "checking", subtype: "checking",
    owner: "", ownerName: "", color: "#C9A84C",
    hasSubAccounts: false, subAccounts: [],
  });

  const { accounts } = useAccounts(householdId || undefined);

  // Document state
  const documents = useDocuments(householdId || undefined);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [uploadStatus, setUploadStatus] = useState<Record<string, string>>({});

  const [draggingDocId, setDraggingDocId] = useState<string | null>(null);
  const [dragOverAccId, setDragOverAccId] = useState<string | null>(null);
  const [justDroppedAccId, setJustDroppedAccId] = useState<string | null>(null);

  const isAdmin = userRole === "admin";

  const docsByAccount = useMemo(() => {
    const map: Record<string, typeof documents> = {};
    for (const d of documents) {
      const key = d.accountDocId || "__unlinked__";
      if (!map[key]) map[key] = [];
      map[key].push(d);
    }
    for (const key of Object.keys(map)) {
      map[key].sort((a, b) =>
        (b.statementEnd || String(b.uploadedAt ?? "")).localeCompare(
          a.statementEnd || String(a.uploadedAt ?? "")
        )
      );
    }
    return map;
  }, [documents]);

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

  // Load members for owner selection
  useEffect(() => {
    if (!householdId) return;
    const unsub = onSnapshot(doc(db, "households", householdId), snap => {
      const memberIds: string[] = snap.data()?.members ?? [];
      Promise.all(memberIds.map(uid => getDoc(doc(db, "users", uid)))).then(docs => {
        setMembers(docs.map(d => ({
          uid: d.id,
          firstName: String(d.data()?.firstName ?? d.data()?.displayName ?? "Member"),
        })));
      });
    });
    return unsub;
  }, [householdId]);

  function resetDraft() {
    setDraft({
      bankName: "", nickname: "", last4: "", cardLast4: "",
      creditLimit: "", type: "checking", subtype: "checking",
      owner: user?.uid ?? "", ownerName: "",
      color: "#C9A84C", hasSubAccounts: false, subAccounts: [],
    });
  }

  async function saveAccount() {
    if (!householdId || !draft.nickname.trim() || !draft.bankName.trim()) {
      setError("Bank name and nickname are required.");
      return;
    }
    setSavingAccount(true);
    try {
      const ownerName = draft.owner === "joint"
        ? "Joint"
        : members.find(m => m.uid === draft.owner)?.firstName ?? "Member";
      const baseData = {
        nickname:    draft.nickname.trim(),
        bankName:    draft.bankName.trim(),
        last4:       draft.last4.replace(/\D/g, "").slice(0, 4),
        cardLast4:   draft.cardLast4.replace(/\D/g, "").slice(0, 4) || draft.last4.replace(/\D/g, "").slice(0, 4),
        type:        draft.type,
        subtype:     draft.subtype || "",
        creditLimit: draft.type === "credit" ? parseFloat(draft.creditLimit || "0") || null : null,
        owner:       draft.owner,
        ownerName,
        color:       draft.color,
        householdId,
        updatedAt:   serverTimestamp(),
      };
      if (draft.id) {
        await updateDoc(doc(db, "households", householdId, "accounts", draft.id), baseData);
      } else {
        const data = { ...baseData, currentBalance: 0, createdAt: serverTimestamp() };
        await addDoc(collection(db, "households", householdId, "accounts"), data);
        // If hasSubAccounts, create sub-account entries too
        if (draft.hasSubAccounts) {
          for (const sub of draft.subAccounts.filter(s => s.label)) {
            await addDoc(collection(db, "households", householdId, "accounts"), {
              ...data,
              nickname:  sub.label,
              last4:     sub.last4.replace(/\D/g, "").slice(0, 4),
              cardLast4: sub.last4.replace(/\D/g, "").slice(0, 4),
              type:      sub.type === "savings" ? "savings" : "checking",
              subtype:   sub.type,
              parentBankName: draft.bankName.trim(),
            });
          }
        }
      }
      resetDraft();
      setShowForm(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save account.");
    } finally {
      setSavingAccount(false);
    }
  }

  async function assignDocToAccount(docId: string, accountId: string) {
    if (!householdId) return;
    await updateDoc(
      doc(db, "households", householdId, "documents", docId),
      { accountDocId: accountId }
    );
    setJustDroppedAccId(accountId);
    setTimeout(() => setJustDroppedAccId(null), 1500);
  }

  async function continueToReview() {
    if (!user) return;
    setContinuing(true);
    try {
      await updateDoc(doc(db, "users", user.uid), { onboardingStep: "review" });
      router.push("/onboarding/review");
    } finally {
      setContinuing(false);
    }
  }

  async function handleFileUpload(file: File, accountId: string) {
    if (!householdId || !user) return;
    const acc = accounts.find(a => a.id === accountId);
    const ext = file.name.split(".").pop()?.toLowerCase();
    setUploadingFor(accountId);
    setUploadStatus(p => ({ ...p, [accountId]: "uploading" }));

    try {
      if (ext === "json") {
        setUploadStatus(p => ({ ...p, [accountId]: "importing" }));
        const text = await file.text();
        let parsed: unknown;
        try { parsed = JSON.parse(text); } catch {
          setUploadStatus(p => ({ ...p, [accountId]: "error: Invalid JSON file" }));
          setUploadingFor(null);
          return;
        }
        const res = await fetch("/api/import-statement", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            jsonContent: parsed,
            householdId,
            fileName: file.name,
          }),
        });
        const data = await res.json() as { imported?: number; flagged?: number; error?: string; duplicate?: boolean };
        if (!res.ok) {
          setUploadStatus(p => ({
            ...p,
            [accountId]: `error: ${data.error ?? "Import failed"}`,
          }));
        } else {
          setUploadStatus(p => ({
            ...p,
            [accountId]: `done: ${data.imported ?? 0} transactions imported · ${data.flagged ?? 0} flagged`,
          }));
        }
      } else {
        const path = `households/${householdId}/statements/${Date.now()}_${file.name}`;
        const storageRef = ref(storage, path);
        const uploadTask = uploadBytesResumable(storageRef, file);

        await new Promise<void>((resolve, reject) => {
          uploadTask.on(
            "state_changed",
            snap => {
              const pct = snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0;
              setUploadProgress(p => ({ ...p, [accountId]: pct }));
            },
            reject,
            () => resolve(),
          );
        });

        await getDownloadURL(uploadTask.snapshot.ref);
        setUploadStatus(p => ({ ...p, [accountId]: "parsing" }));

        const docRef = doc(collection(db, "households", householdId, "documents"));
        await setDoc(docRef, {
          fileName: file.name,
          storagePath: path,
          status: "uploaded",
          accountDocId: accountId,
          assignedTo: acc?.owner ?? user.uid,
          assignedToName: acc?.ownerName ?? "Unknown",
          uploadedAt: serverTimestamp(),
        });

        const res = await fetch("/api/parse-document", {
          method:  "POST",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({
            storagePath: path,
            householdId,
            docId: docRef.id,
            fileName: file.name,
          }),
        });

        if (!res.ok) {
          const text = await res.text();
          setUploadStatus(p => ({
            ...p,
            [accountId]: `error: Parse failed — ${text.slice(0, 80)}`,
          }));
        } else {
          setUploadStatus(p => ({
            ...p,
            [accountId]: "done: AI is processing your statement...",
          }));
        }
      }
    } catch (e) {
      setUploadStatus(p => ({
        ...p,
        [accountId]: `error: ${e instanceof Error ? e.message : "Upload failed"}`,
      }));
    } finally {
      setUploadingFor(null);
      setUploadProgress(p => { const n = { ...p }; delete n[accountId]; return n; });
    }
  }

  if (authLoading || loadingCtx) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
        <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
      </div>
    );
  }

  const myAccounts   = accounts.filter(a => a.owner === user?.uid);
  const otherAccounts = accounts.filter(a => a.owner !== user?.uid && a.owner !== "joint");
  const jointAccounts = accounts.filter(a => a.owner === "joint");

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-[#1B2A4A]">
      {/* Header */}
      <div className="border-b border-kw-border bg-white px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto max-w-2xl">
          <OnboardingProgressDots currentStep="Accounts" userRole={userRole} />
          <h1 className="text-xl font-bold text-kw-navy sm:text-2xl">Your Accounts & Cards</h1>
          <p className="mt-1 text-sm text-[#9AA5B4]">
            Add every bank account and credit card. We&apos;ll match your uploaded statements to these.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

        {/* Existing accounts — member sees all, grouped */}
        {accounts.length > 0 && (
          <div className="space-y-3">
            {/* My accounts */}
            {myAccounts.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Your Accounts
                </p>
                <div className="space-y-2">
                  {myAccounts.map(acc => (
                    <div
                      key={acc.id}
                      className={`relative rounded-2xl border bg-white p-4 transition-all ${
                        dragOverAccId === acc.id
                          ? "border-[#C9A84C] bg-[#FFF8E8] shadow-md"
                          : justDroppedAccId === acc.id
                            ? "border-green-400 bg-green-50"
                            : "border-[#E4E8F0]"
                      }`}
                      style={{ borderLeftWidth: 4, borderLeftColor: acc.color || "#C9A84C" }}
                      onDragOver={e => { e.preventDefault(); setDragOverAccId(acc.id); }}
                      onDragLeave={() => setDragOverAccId(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverAccId(null);
                        const docId = e.dataTransfer.getData("docId");
                        if (docId) void assignDocToAccount(docId, acc.id);
                      }}
                    >
                      {dragOverAccId === acc.id && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl">
                          <span className="rounded-full bg-[#C9A84C] px-3 py-1 text-xs font-bold text-white shadow">
                            Drop to assign →
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-[#1B2A4A]">{acc.nickname}</p>
                          <p className="font-mono text-xs text-[#9AA5B4]">
                            {acc.bankName} {formatCardMask(acc.last4)}
                          </p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            acc.type === "credit" ? "bg-red-100 text-red-700"
                            : acc.type === "savings" ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                          }`}>
                            {acc.type}
                          </span>
                        </div>
                        <button
                        type="button"
                        onClick={() => {
                          setDraft({
                            id: acc.id,
                            bankName:    acc.bankName,
                            nickname:    acc.nickname,
                            last4:       acc.last4,
                            cardLast4:   acc.cardLast4 || acc.last4,
                            creditLimit: acc.creditLimit ? String(acc.creditLimit) : "",
                            type:        acc.type,
                            subtype:     acc.subtype || "checking",
                            owner:       acc.owner,
                            ownerName:   acc.ownerName,
                            color:       acc.color || "#C9A84C",
                            hasSubAccounts: false,
                            subAccounts: [],
                          });
                          setShowForm(true);
                        }}
                        className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
                        >
                          Edit
                        </button>
                      </div>
                      {/* ── Documents linked to this account ──────────────── */}
                      {(() => {
                        const accDocs = docsByAccount[acc.id] ?? [];
                        const status  = uploadStatus[acc.id] ?? "";
                        const isError = status.startsWith("error:");
                        const isDone  = status.startsWith("done:");
                        const isParsing = status.startsWith("parsing");
                        const isImporting = status === "importing";
                        const isUploading = status === "uploading";
                        const progress = uploadProgress[acc.id] ?? 0;
                        const showDocs = accDocs.length > 0;

                        return (
                          <div className="mt-3 border-t border-[#F4F6FA] pt-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                                📄 Statements {accDocs.length > 0 && `(${accDocs.length})`}
                              </p>
                              <label className="cursor-pointer rounded-lg border border-[#C9A84C] px-2.5 py-1 text-[10px] font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
                                + Upload
                                <input
                                  type="file"
                                  accept=".json,.pdf,.csv"
                                  className="hidden"
                                  disabled={uploadingFor === acc.id}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) void handleFileUpload(f, acc.id);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                            {(isUploading || isImporting || isParsing) && (
                              <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-blue-700">
                                  {isUploading ? `Uploading... ${progress}%` : isImporting ? "Importing transactions..." : "AI is parsing your statement..."}
                                </p>
                                {isUploading && (
                                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                                    <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                                  </div>
                                )}
                              </div>
                            )}
                            {isDone && (
                              <div className="mb-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-green-700">✅ {status.replace("done: ", "")}</p>
                              </div>
                            )}
                            {isError && (
                              <div className="mb-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-red-600">{status.replace("error: ", "")}</p>
                              </div>
                            )}
                            {showDocs ? (
                              <div className="space-y-1">
                                {accDocs.slice(0, 3).map(d => (
                                  <div
                                    key={d.id}
                                    draggable
                                    onDragStart={e => {
                                      e.dataTransfer.setData("docId", d.id);
                                      setDraggingDocId(d.id);
                                    }}
                                    onDragEnd={() => setDraggingDocId(null)}
                                    className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                      draggingDocId === d.id
                                        ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                        : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="shrink-0 text-[10px] text-[#C9A84C]/60 select-none">⠿</span>
                                        <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                          {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                        </p>
                                      </div>
                                      {(d.statementStart || d.statementEnd) && (
                                        <p className="mt-0.5 pl-4 text-[9px] text-[#9AA5B4]">
                                          {d.statementStart?.slice(5) ?? "?"} → {d.statementEnd?.slice(5) ?? "?"}
                                          {d.transactionCount != null && ` · ${d.transactionCount} txns`}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 text-[10px] font-semibold ${
                                      d.status === "complete" ? "text-green-600"
                                      : d.status === "error"  ? "text-red-500"
                                      : "text-amber-500"
                                    }`}>
                                      {d.status === "complete" ? "✅"
                                      : d.status === "error"   ? "❌"
                                      : d.status === "parsing" ? "🔄"
                                      : "⏳"}
                                    </span>
                                  </div>
                                ))}
                                {accDocs.length > 3 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] font-semibold text-[#C9A84C] hover:text-[#b8943a]">
                                      +{accDocs.length - 3} more statements
                                    </summary>
                                    <div className="mt-1 space-y-1">
                                      {accDocs.slice(3).map(d => (
                                        <div
                                          key={d.id}
                                          draggable
                                          onDragStart={e => {
                                            e.dataTransfer.setData("docId", d.id);
                                            setDraggingDocId(d.id);
                                          }}
                                          onDragEnd={() => setDraggingDocId(null)}
                                          className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                            draggingDocId === d.id
                                              ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                              : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                          }`}
                                        >
                                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="shrink-0 text-[10px] text-[#C9A84C]/60">⠿</span>
                                            <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                              {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                            </p>
                                            {d.statementEnd && (
                                              <span className="shrink-0 text-[9px] text-[#9AA5B4]">
                                                {d.statementEnd.slice(0, 7)}
                                              </span>
                                            )}
                                          </div>
                                          <span className="ml-2 shrink-0 text-[10px]">
                                            {d.status === "complete" ? "✅" : d.status === "error" ? "❌" : "⏳"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] italic text-[#9AA5B4]">No statements yet — upload a JSON, PDF, or CSV above</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {otherAccounts.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  {isAdmin ? "Household — Manage All" : "Household — Other Member"}
                </p>
                <div className="space-y-2">
                  {otherAccounts.map(acc => (
                    <div
                      key={acc.id}
                      className={`relative rounded-2xl border bg-white p-4 transition-all ${
                        dragOverAccId === acc.id
                          ? "border-[#C9A84C] bg-[#FFF8E8] shadow-md"
                          : justDroppedAccId === acc.id
                            ? "border-green-400 bg-green-50"
                            : "border-[#E4E8F0]"
                      } ${!isAdmin ? "opacity-70" : ""}`}
                      style={{ borderLeftWidth: 4, borderLeftColor: acc.color || "#C9A84C" }}
                      onDragOver={e => { e.preventDefault(); setDragOverAccId(acc.id); }}
                      onDragLeave={() => setDragOverAccId(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverAccId(null);
                        const docId = e.dataTransfer.getData("docId");
                        if (docId) void assignDocToAccount(docId, acc.id);
                      }}
                    >
                      {dragOverAccId === acc.id && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl">
                          <span className="rounded-full bg-[#C9A84C] px-3 py-1 text-xs font-bold text-white shadow">
                            Drop to assign →
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-[#1B2A4A]">{acc.nickname}</p>
                          <p className="font-mono text-xs text-[#9AA5B4]">
                            {acc.bankName} {formatCardMask(acc.last4)} · {acc.ownerName}
                          </p>
                          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            acc.type === "credit" ? "bg-red-100 text-red-700"
                            : acc.type === "savings" ? "bg-green-100 text-green-700"
                            : "bg-blue-100 text-blue-700"
                          }`}>
                            {acc.type}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                        {isAdmin ? (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setDraft({
                                  id: acc.id,
                                  bankName:    acc.bankName,
                                  nickname:    acc.nickname,
                                  last4:       acc.last4,
                                  cardLast4:   acc.cardLast4 || acc.last4,
                                  creditLimit: acc.creditLimit ? String(acc.creditLimit) : "",
                                  type:        acc.type,
                                  subtype:     acc.subtype || "checking",
                                  owner:       acc.owner,
                                  ownerName:   acc.ownerName,
                                  color:       acc.color || "#C9A84C",
                                  hasSubAccounts: false,
                                  subAccounts: [],
                                });
                                setShowForm(true);
                              }}
                              className="rounded-lg border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!window.confirm(
                                  `Delete ${acc.nickname} (${acc.ownerName})?\nTransactions assigned to this account will lose the account link.`
                                )) return;
                                const { deleteDoc: fsDeleteDoc, writeBatch, collection: fsCol, where, getDocs, query: fsQuery } = await import("firebase/firestore");
                                await fsDeleteDoc(doc(db, "households", householdId, "accounts", acc.id));
                                const txSnap = await getDocs(fsQuery(
                                  fsCol(db, "households", householdId, "transactions"),
                                  where("accountId", "==", acc.id)
                                ));
                                if (!txSnap.empty) {
                                  const batch = writeBatch(db);
                                  txSnap.docs.forEach(d => batch.update(d.ref, { accountId: "" }));
                                  await batch.commit();
                                }
                              }}
                              className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-semibold text-red-400 hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </>
                        ) : (
                          <span className="text-[10px] text-[#9AA5B4]">View only</span>
                        )}
                        </div>
                      </div>

                      {/* Documents section — admin can upload here too */}
                      {(() => {
                        const accDocs = docsByAccount[acc.id] ?? [];
                        const status  = uploadStatus[acc.id] ?? "";
                        const isError = status.startsWith("error:");
                        const isDone  = status.startsWith("done:");
                        const isParsing = status.startsWith("parsing") || status === "importing" || status === "uploading";
                        return (
                          <div className="mt-3 w-full border-t border-[#F4F6FA] pt-3">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                                📄 Statements {accDocs.length > 0 && `(${accDocs.length})`}
                              </p>
                              {isAdmin && (
                                <label className="cursor-pointer rounded-lg border border-[#C9A84C] px-2 py-0.5 text-[10px] font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
                                  + Upload
                                  <input
                                    type="file"
                                    accept=".json,.pdf,.csv"
                                    className="hidden"
                                    disabled={uploadingFor === acc.id}
                                    onChange={e => {
                                      const file = e.target.files?.[0];
                                      if (file) void handleFileUpload(file, acc.id);
                                      e.target.value = "";
                                    }}
                                  />
                                </label>
                              )}
                            </div>
                            {isParsing && (
                              <p className="mt-1 text-[10px] text-blue-600">🔄 Processing...</p>
                            )}
                            {isDone && (
                              <p className="mt-1 text-[10px] text-green-600">✅ {status.replace("done: ", "")}</p>
                            )}
                            {isError && (
                              <p className="mt-1 text-[10px] text-red-500">{status.replace("error: ", "")}</p>
                            )}
                            {accDocs.length > 0 ? (
                              <div className="mt-1 space-y-1">
                                {accDocs.slice(0, 3).map(d => (
                                  <div
                                    key={d.id}
                                    draggable
                                    onDragStart={e => {
                                      e.dataTransfer.setData("docId", d.id);
                                      setDraggingDocId(d.id);
                                    }}
                                    onDragEnd={() => setDraggingDocId(null)}
                                    className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                      draggingDocId === d.id
                                        ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                        : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="shrink-0 text-[10px] text-[#C9A84C]/60 select-none">⠿</span>
                                        <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                          {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                        </p>
                                      </div>
                                      {(d.statementStart || d.statementEnd) && (
                                        <p className="mt-0.5 pl-4 text-[9px] text-[#9AA5B4]">
                                          {d.statementStart?.slice(5) ?? "?"} → {d.statementEnd?.slice(5) ?? "?"}
                                          {d.transactionCount != null && ` · ${d.transactionCount} txns`}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 text-[10px] font-semibold ${
                                      d.status === "complete" ? "text-green-600"
                                      : d.status === "error"  ? "text-red-500"
                                      : "text-amber-500"
                                    }`}>
                                      {d.status === "complete" ? "✅"
                                      : d.status === "error"   ? "❌"
                                      : d.status === "parsing" ? "🔄"
                                      : "⏳"}
                                    </span>
                                  </div>
                                ))}
                                {accDocs.length > 3 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] font-semibold text-[#C9A84C] hover:text-[#b8943a]">
                                      +{accDocs.length - 3} more statements
                                    </summary>
                                    <div className="mt-1 space-y-1">
                                      {accDocs.slice(3).map(d => (
                                        <div
                                          key={d.id}
                                          draggable
                                          onDragStart={e => {
                                            e.dataTransfer.setData("docId", d.id);
                                            setDraggingDocId(d.id);
                                          }}
                                          onDragEnd={() => setDraggingDocId(null)}
                                          className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                            draggingDocId === d.id
                                              ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                              : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                          }`}
                                        >
                                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="shrink-0 text-[10px] text-[#C9A84C]/60">⠿</span>
                                            <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                              {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                            </p>
                                            {d.statementEnd && (
                                              <span className="shrink-0 text-[9px] text-[#9AA5B4]">
                                                {d.statementEnd.slice(0, 7)}
                                              </span>
                                            )}
                                          </div>
                                          <span className="ml-2 shrink-0 text-[10px]">
                                            {d.status === "complete" ? "✅" : d.status === "error" ? "❌" : "⏳"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            ) : (
                              <p className="mt-1 text-[10px] italic text-[#9AA5B4]">No statements yet</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Joint accounts */}
            {jointAccounts.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Joint Accounts
                </p>
                <div className="space-y-2">
                  {jointAccounts.map(acc => (
                    <div
                      key={acc.id}
                      className={`relative rounded-2xl border bg-white p-4 transition-all ${
                        dragOverAccId === acc.id
                          ? "border-[#C9A84C] bg-[#FFF8E8] shadow-md"
                          : justDroppedAccId === acc.id
                            ? "border-green-400 bg-green-50"
                            : "border-[#E4E8F0]"
                      }`}
                      style={{ borderLeftWidth: 4, borderLeftColor: acc.color || "#14B8A6" }}
                      onDragOver={e => { e.preventDefault(); setDragOverAccId(acc.id); }}
                      onDragLeave={() => setDragOverAccId(null)}
                      onDrop={e => {
                        e.preventDefault();
                        setDragOverAccId(null);
                        const docId = e.dataTransfer.getData("docId");
                        if (docId) void assignDocToAccount(docId, acc.id);
                      }}
                    >
                      {dragOverAccId === acc.id && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl">
                          <span className="rounded-full bg-[#C9A84C] px-3 py-1 text-xs font-bold text-white shadow">
                            Drop to assign →
                          </span>
                        </div>
                      )}
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-bold text-[#1B2A4A]">{acc.nickname}</p>
                          <p className="font-mono text-xs text-[#9AA5B4]">
                            {acc.bankName} {formatCardMask(acc.last4)} · Joint
                          </p>
                        </div>
                      </div>
                      {/* ── Documents linked to joint account ──────────────── */}
                      {(() => {
                        const accDocs = docsByAccount[acc.id] ?? [];
                        const status  = uploadStatus[acc.id] ?? "";
                        const isError = status.startsWith("error:");
                        const isDone  = status.startsWith("done:");
                        const isParsing = status.startsWith("parsing");
                        const isImporting = status === "importing";
                        const isUploading = status === "uploading";
                        const progress = uploadProgress[acc.id] ?? 0;
                        const showDocs = accDocs.length > 0;

                        return (
                          <div className="mt-3 w-full border-t border-[#F4F6FA] pt-3">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                                📄 Statements {accDocs.length > 0 && `(${accDocs.length})`}
                              </p>
                              <label className="cursor-pointer rounded-lg border border-[#C9A84C] px-2.5 py-1 text-[10px] font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
                                + Upload
                                <input
                                  type="file"
                                  accept=".json,.pdf,.csv"
                                  className="hidden"
                                  disabled={uploadingFor === acc.id}
                                  onChange={e => {
                                    const f = e.target.files?.[0];
                                    if (f) void handleFileUpload(f, acc.id);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                            {(isUploading || isImporting || isParsing) && (
                              <div className="mb-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-blue-700">
                                  {isUploading ? `Uploading... ${progress}%` : isImporting ? "Importing transactions..." : "AI is parsing your statement..."}
                                </p>
                                {isUploading && (
                                  <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-blue-100">
                                    <div className="h-1.5 rounded-full bg-blue-500 transition-all" style={{ width: `${progress}%` }} />
                                  </div>
                                )}
                              </div>
                            )}
                            {isDone && (
                              <div className="mb-2 rounded-lg border border-green-100 bg-green-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-green-700">✅ {status.replace("done: ", "")}</p>
                              </div>
                            )}
                            {isError && (
                              <div className="mb-2 rounded-lg border border-red-100 bg-red-50 px-3 py-2">
                                <p className="text-[11px] font-semibold text-red-600">{status.replace("error: ", "")}</p>
                              </div>
                            )}
                            {showDocs ? (
                              <div className="space-y-1">
                                {accDocs.slice(0, 3).map(d => (
                                  <div
                                    key={d.id}
                                    draggable
                                    onDragStart={e => {
                                      e.dataTransfer.setData("docId", d.id);
                                      setDraggingDocId(d.id);
                                    }}
                                    onDragEnd={() => setDraggingDocId(null)}
                                    className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                      draggingDocId === d.id
                                        ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                        : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-1.5">
                                        <span className="shrink-0 text-[10px] text-[#C9A84C]/60 select-none">⠿</span>
                                        <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                          {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                        </p>
                                      </div>
                                      {(d.statementStart || d.statementEnd) && (
                                        <p className="mt-0.5 pl-4 text-[9px] text-[#9AA5B4]">
                                          {d.statementStart?.slice(5) ?? "?"} → {d.statementEnd?.slice(5) ?? "?"}
                                          {d.transactionCount != null && ` · ${d.transactionCount} txns`}
                                        </p>
                                      )}
                                    </div>
                                    <span className={`ml-2 shrink-0 text-[10px] font-semibold ${
                                      d.status === "complete" ? "text-green-600"
                                      : d.status === "error"  ? "text-red-500"
                                      : "text-amber-500"
                                    }`}>
                                      {d.status === "complete" ? "✅"
                                      : d.status === "error"   ? "❌"
                                      : d.status === "parsing" ? "🔄"
                                      : "⏳"}
                                    </span>
                                  </div>
                                ))}
                                {accDocs.length > 3 && (
                                  <details className="mt-1">
                                    <summary className="cursor-pointer text-[10px] font-semibold text-[#C9A84C] hover:text-[#b8943a]">
                                      +{accDocs.length - 3} more statements
                                    </summary>
                                    <div className="mt-1 space-y-1">
                                      {accDocs.slice(3).map(d => (
                                        <div
                                          key={d.id}
                                          draggable
                                          onDragStart={e => {
                                            e.dataTransfer.setData("docId", d.id);
                                            setDraggingDocId(d.id);
                                          }}
                                          onDragEnd={() => setDraggingDocId(null)}
                                          className={`flex cursor-grab items-center justify-between rounded-lg px-3 py-2 transition select-none ${
                                            draggingDocId === d.id
                                              ? "border border-[#C9A84C] bg-[#C9A84C]/10 opacity-60"
                                              : "bg-[#F9FAFC] hover:bg-[#F1F3F8]"
                                          }`}
                                        >
                                          <div className="flex min-w-0 flex-1 items-center gap-1.5">
                                            <span className="shrink-0 text-[10px] text-[#C9A84C]/60">⠿</span>
                                            <p className="truncate text-[11px] font-semibold text-[#1B2A4A]">
                                              {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                                            </p>
                                            {d.statementEnd && (
                                              <span className="shrink-0 text-[9px] text-[#9AA5B4]">
                                                {d.statementEnd.slice(0, 7)}
                                              </span>
                                            )}
                                          </div>
                                          <span className="ml-2 shrink-0 text-[10px]">
                                            {d.status === "complete" ? "✅" : d.status === "error" ? "❌" : "⏳"}
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  </details>
                                )}
                              </div>
                            ) : (
                              <p className="text-[10px] italic text-[#9AA5B4]">No statements yet — upload a JSON, PDF, or CSV above</p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Add Account button */}
        {!showForm && (
          <button
            type="button"
            onClick={() => { resetDraft(); setShowForm(true); }}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#C9A84C] bg-white py-5 text-sm font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]"
          >
            + Add Account or Card
          </button>
        )}

        {/* Account form */}
        {showForm && (
          <div className="rounded-2xl border border-[#E4E8F0] bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#1B2A4A]">
                {draft.id ? "Edit Account" : "Add Account"}
              </h3>
              <button
                type="button"
                onClick={() => { setShowForm(false); resetDraft(); }}
                className="text-sm text-[#9AA5B4]"
              >
                × Cancel
              </button>
            </div>

            <div className="space-y-4">
              {/* Bank name */}
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Bank Name
                </label>
                <input
                  autoFocus
                  value={draft.bankName}
                  onChange={e => setDraft(p => ({ ...p, bankName: e.target.value }))}
                  placeholder="e.g. PNC Bank, Citadel Credit Union"
                  className="h-10 w-full rounded-lg border border-[#E4E8F0] px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["Chase","Wells Fargo","Bank of America","Capital One","PNC","Citadel","TD Bank","Other"].map(b => (
                    <button
                      key={b}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, bankName: b === "Other" ? "" : b }))}
                      className="rounded-full border border-[#E4E8F0] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#1B2A4A] hover:border-[#C9A84C]"
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>

              {/* Nickname */}
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Nickname
                </label>
                <input
                  value={draft.nickname}
                  onChange={e => setDraft(p => ({ ...p, nickname: e.target.value }))}
                  placeholder="e.g. Checking PNC, Blue Card, Victoria Savings"
                  className="h-10 w-full rounded-lg border border-[#E4E8F0] px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>

              {/* Account type */}
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Account Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["credit",   "💳 Credit Card"],
                    ["checking", "🏦 Checking"],
                    ["savings",  "🐷 Savings"],
                    ["debit",    "🏧 Debit"],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, type: val, subtype: val === "savings" ? "savings" : "checking" }))}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        draft.type === val
                          ? "border-[#C9A84C] bg-[#C9A84C] text-white"
                          : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Last 4 + Card last 4 */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                    Account # Last 4
                  </label>
                  <input
                    value={draft.last4}
                    onChange={e => setDraft(p => ({ ...p, last4: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                    placeholder="8376"
                    className="h-10 w-full rounded-lg border border-[#E4E8F0] px-3 font-mono text-sm focus:border-[#C9A84C] focus:outline-none"
                  />
                  <p className="mt-1 font-mono text-[10px] text-[#9AA5B4]">
                    •••• •••• •••• {draft.last4 || "----"}
                  </p>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                    Card # Last 4 (if different)
                  </label>
                  <input
                    value={draft.cardLast4}
                    onChange={e => setDraft(p => ({ ...p, cardLast4: e.target.value.replace(/\D/g,"").slice(0,4) }))}
                    placeholder="6910"
                    className="h-10 w-full rounded-lg border border-[#E4E8F0] px-3 font-mono text-sm focus:border-[#C9A84C] focus:outline-none"
                  />
                  <p className="mt-1 text-[10px] text-[#9AA5B4]">
                    Leave blank if same as account #
                  </p>
                </div>
              </div>

              {/* Credit limit */}
              {draft.type === "credit" && (
                <div>
                  <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                    Credit Limit
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#9AA5B4]">$</span>
                    <input
                      type="number"
                      min={0}
                      value={draft.creditLimit}
                      onChange={e => setDraft(p => ({ ...p, creditLimit: e.target.value }))}
                      placeholder="5000"
                      className="h-10 w-full rounded-lg border border-[#E4E8F0] pl-7 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Sub-accounts toggle */}
              {draft.type !== "credit" && (
                <div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={draft.hasSubAccounts}
                      onChange={e => setDraft(p => ({
                        ...p,
                        hasSubAccounts: e.target.checked,
                        subAccounts: e.target.checked
                          ? [{ label: "Star Savings", type: "savings" as AccountSubtype, last4: "" }]
                          : [],
                      }))}
                    />
                    <span className="font-semibold text-[#1B2A4A]">
                      This account has sub-accounts
                    </span>
                    <span className="text-[10px] text-[#9AA5B4]">
                      (e.g. Citadel with Savings + Checking)
                    </span>
                  </label>

                  {draft.hasSubAccounts && (
                    <div className="mt-3 space-y-2 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                        Sub-Accounts
                      </p>
                      {draft.subAccounts.map((sub, i) => (
                        <div key={i} className="grid grid-cols-3 gap-2">
                          <input
                            value={sub.label}
                            onChange={e => {
                              const next = [...draft.subAccounts];
                              next[i] = { ...next[i], label: e.target.value };
                              setDraft(p => ({ ...p, subAccounts: next }));
                            }}
                            placeholder="Label (e.g. Star Savings)"
                            className="h-9 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                          <select
                            value={sub.type}
                            onChange={e => {
                              const next = [...draft.subAccounts];
                              next[i] = { ...next[i], type: e.target.value as AccountSubtype };
                              setDraft(p => ({ ...p, subAccounts: next }));
                            }}
                            className="h-9 rounded-lg border border-[#E4E8F0] bg-white px-2 text-xs focus:border-[#C9A84C] focus:outline-none"
                          >
                            <option value="savings">Savings</option>
                            <option value="checking">Checking</option>
                            <option value="growth">Growth</option>
                            <option value="emergency">Emergency</option>
                          </select>
                          <input
                            value={sub.last4}
                            onChange={e => {
                              const next = [...draft.subAccounts];
                              next[i] = { ...next[i], last4: e.target.value.replace(/\D/g,"").slice(0,4) };
                              setDraft(p => ({ ...p, subAccounts: next }));
                            }}
                            placeholder="Last 4"
                            className="h-9 rounded-lg border border-[#E4E8F0] bg-white px-2 font-mono text-xs focus:border-[#C9A84C] focus:outline-none"
                          />
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={() => setDraft(p => ({
                          ...p,
                          subAccounts: [...p.subAccounts, { label: "", type: "checking", last4: "" }],
                        }))}
                        className="text-[10px] font-semibold text-[#C9A84C]"
                      >
                        + Add sub-account
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Owner */}
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Owner
                </label>
                <div className="flex flex-wrap gap-2">
                  {members.map(m => (
                    <button
                      key={m.uid}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, owner: m.uid, ownerName: m.firstName }))}
                      className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                        draft.owner === m.uid
                          ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                          : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                      }`}
                    >
                      {m.firstName}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setDraft(p => ({ ...p, owner: "joint", ownerName: "Joint" }))}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${
                      draft.owner === "joint"
                        ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                        : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                    }`}
                  >
                    🤝 Joint
                  </button>
                </div>
              </div>

              {/* Color */}
              <div>
                <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Card Color
                </label>
                <div className="flex gap-2">
                  {COLORS.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setDraft(p => ({ ...p, color: c }))}
                      className="relative h-7 w-7 rounded-full"
                      style={{ backgroundColor: c }}
                    >
                      {draft.color === c && (
                        <span className="absolute inset-0 grid place-items-center text-[10px] font-bold text-white">✓</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div
                className="rounded-xl border bg-white p-3"
                style={{ borderLeftWidth: 5, borderLeftColor: draft.color }}
              >
                <p className="font-mono text-[10px] uppercase text-[#9AA5B4]">{draft.bankName || "Bank"}</p>
                <p className="text-lg font-bold text-[#1B2A4A]">{draft.nickname || "Nickname"}</p>
                <p className="font-mono text-xs text-[#9AA5B4]">
                  •••• •••• •••• {draft.last4 || "----"}
                </p>
              </div>

              {/* Save */}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={savingAccount}
                  onClick={() => void saveAccount()}
                  className="rounded-lg bg-[#C9A84C] px-5 py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
                >
                  {savingAccount ? "Saving..." : draft.id ? "Update Account" : "Add Account"}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); resetDraft(); }}
                  className="rounded-lg border border-[#E4E8F0] px-5 py-2.5 text-sm font-semibold text-[#9AA5B4]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Unlinked documents */}
        {(docsByAccount["__unlinked__"] ?? []).length > 0 && (
          <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-amber-600">
              ⚠️ Statements not linked to an account (
              {(docsByAccount["__unlinked__"] ?? []).length})
            </p>
            <p className="mb-3 text-[11px] text-amber-700">
              Drag each statement onto the correct account card above to link it.
            </p>
            <div className="flex flex-wrap gap-2">
              {(docsByAccount["__unlinked__"] ?? []).map(d => (
                <div
                  key={d.id}
                  draggable
                  onDragStart={e => {
                    e.dataTransfer.setData("docId", d.id);
                    setDraggingDocId(d.id);
                  }}
                  onDragEnd={() => setDraggingDocId(null)}
                  className={`cursor-grab rounded-xl border px-3 py-2 transition select-none ${
                    draggingDocId === d.id
                      ? "border-[#C9A84C] bg-[#C9A84C] text-white shadow-lg scale-105"
                      : "border-amber-200 bg-white text-[#1B2A4A] hover:border-[#C9A84C]"
                  }`}
                >
                  <p className="text-[11px] font-bold">
                    {d.fileName?.replace("-parsed.json", "").replace(".json", "") ?? d.id}
                  </p>
                  <p className="text-[9px] text-[#9AA5B4]">
                    {d.bankName} ••{d.accountLast4}
                    {d.statementEnd && ` · ${d.statementEnd.slice(0, 7)}`}
                    {d.transactionCount != null && ` · ${d.transactionCount} txns`}
                  </p>
                  <p className="mt-1 text-[9px] font-semibold text-amber-600">
                    ☰ drag to assign
                  </p>
                </div>
              ))}
            </div>

            {draggingDocId && (
              <div className="mt-3 rounded-lg border border-[#C9A84C]/30 bg-[#FFF8E8] px-3 py-2 text-[11px] font-semibold text-[#C9A84C]">
                ↑ Scroll up and drop onto the correct account card
              </div>
            )}
          </div>
        )}

        {/* Upload note */}
        {accounts.length > 0 && !showForm && (
          <div className="rounded-2xl border border-blue-100 bg-blue-50 px-5 py-4">
            <p className="text-sm font-semibold text-blue-700">
              📄 Upload statements in the next step
            </p>
            <p className="mt-1 text-xs text-blue-600">
              After reviewing your accounts, you&apos;ll upload PDFs or CSVs.
              We&apos;ll automatically match each statement to the right account
              using bank name and last-4 digits.
            </p>
          </div>
        )}

        {/* Continue / Skip */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={async () => {
              if (!user) return;
              await updateDoc(doc(db, "users", user.uid), { onboardingStep: "review" });
              router.push("/onboarding/review");
            }}
            className="text-sm font-semibold text-[#9AA5B4] underline hover:text-[#1B2A4A]"
          >
            Skip for now →
          </button>
          <button
            type="button"
            disabled={continuing}
            onClick={() => void continueToReview()}
            className="rounded-xl bg-[#1B2A4A] px-6 py-3 text-sm font-bold text-white disabled:opacity-50"
          >
            {continuing ? "..." : "Continue to Review →"}
          </button>
        </div>
      </div>

      {/* Global drag hint */}
      {draggingDocId && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#C9A84C] bg-white px-5 py-2.5 shadow-xl">
          <p className="text-sm font-semibold text-[#1B2A4A]">
            ↕ Drop onto any account card to reassign this statement
          </p>
        </div>
      )}
    </div>
  );
}
