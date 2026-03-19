"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addDoc, collection, doc, getDoc,
  serverTimestamp, updateDoc, deleteDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useLoans, LOAN_TYPE_LABELS, LOAN_TYPE_COLORS, type Loan, type LoanDraft } from "@/app/hooks/useLoans";
import { useMembers } from "@/app/hooks/useMembers";
import { db } from "@/app/lib/firebase";

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

export default function SettingsLoansPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [userRole, setUserRole] = useState("");
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [hasDebt, setHasDebt] = useState<"yes" | "no" | "">("");

  const isAdmin = userRole === "admin";

  const { loans } = useLoans(householdId || undefined);
  const members = useMembers(householdId || undefined);

  // Loan form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<LoanDraft & { assignedTo?: string }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const data = snap.data() ?? {};
      const hid = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setUserRole(String(data.role ?? "member"));
      if (loans.length > 0) setHasDebt("yes");
      setLoadingCtx(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, router]);

  // Auto-set hasDebt when loans load
  useEffect(() => {
    if (loans.length > 0) setHasDebt("yes");
  }, [loans.length]);

  async function saveLoan() {
    if (!householdId || !draft.name) return;
    setSaving(true);
    try {
      const m = members.find(x => x.uid === draft.assignedTo);
      const payload = {
        ...draft,
        balance:        Number(draft.balance ?? 0),
        rate:           Number(draft.rate ?? 0),
        minimumPayment: Number(draft.minimumPayment ?? 0),
        assignedToName: draft.assignedTo === "joint"
          ? "Joint"
          : m?.firstName || m?.displayName || "Member",
        active:      true,
        householdId,
        updatedAt:   serverTimestamp(),
      };
      if (editingId) {
        await updateDoc(doc(db, "households", householdId, "loans", editingId), payload);
      } else {
        await addDoc(collection(db, "households", householdId, "loans"), {
          ...payload,
          createdAt: serverTimestamp(),
        });
      }
      setDraft({});
      setEditingId(null);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  async function deleteLoan(id: string) {
    if (!householdId || !window.confirm("Delete this loan?")) return;
    await deleteDoc(doc(db, "households", householdId, "loans", id));
  }

  if (authLoading || loadingCtx) return (
    <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  const myLoans    = loans.filter(l => l.assignedTo === user?.uid);
  const otherLoans = loans.filter(l => l.assignedTo !== user?.uid);
  const totalDebt  = loans.reduce((s, l) => s + l.balance, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">
      {/* Header */}
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/settings" className="text-xs text-[#9AA5B4] hover:text-[#1B2A4A]">← Settings</Link>
            <span className="text-[#E4E8F0]">/</span>
            <h1 className="text-xl font-bold text-[#1B2A4A]">Loans & Debt</h1>
          </div>
        </div>
        <p className="mx-auto mt-1 max-w-2xl text-xs text-[#9AA5B4]">
          Track what you owe. We&apos;ll use this for your financial overview.
        </p>
      </div>

      <div className="mx-auto max-w-2xl flex-1 space-y-5 px-4 py-4 sm:px-6 sm:py-6">

        {/* Do you have debt? */}
        {hasDebt === "" && loans.length === 0 && (
          <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 text-center">
            <p className="text-2xl">💸</p>
            <p className="mt-2 text-lg font-bold text-[#1B2A4A]">
              Do you have any loans or debt?
            </p>
            <p className="mt-1 text-sm text-[#9AA5B4]">
              Student loans, car loans, personal loans, medical debt, etc.
            </p>
            <div className="mt-4 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => { setHasDebt("yes"); setShowForm(true); setDraft({ type: "other" }); }}
                className="rounded-xl bg-[#1B2A4A] px-6 py-3 text-sm font-bold text-white"
              >
                Yes, I have debt
              </button>
              <Link
                href="/dashboard"
                className="rounded-xl border border-[#E4E8F0] bg-white px-6 py-3 text-sm font-semibold text-[#9AA5B4]"
              >
                No debt — go to dashboard
              </Link>
            </div>
          </div>
        )}

        {/* Loans list */}
        {(hasDebt === "yes" || loans.length > 0) && (
          <>
            {/* Summary */}
            {loans.length > 0 && (
              <div className="rounded-2xl border border-[#E4E8F0] bg-white px-5 py-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Total Debt Tracked
                </p>
                <p className="text-3xl font-bold text-[#1B2A4A]">{fmt(totalDebt)}</p>
                <p className="text-xs text-[#9AA5B4]">
                  {loans.length} loan{loans.length !== 1 ? "s" : ""} ·{" "}
                  {fmt(loans.reduce((s,l) => s + l.minimumPayment, 0))}/mo minimum
                </p>
              </div>
            )}

            {/* My loans */}
            {myLoans.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  Your Loans
                </p>
                <div className="space-y-2">
                  {myLoans.map(loan => {
                    const isEditing = editingId === loan.id;
                    const color = LOAN_TYPE_COLORS[loan.type] || "#9AA5B4";
                    return (
                      <div
                        key={loan.id}
                        className="overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white"
                        style={{ borderLeftWidth: 4, borderLeftColor: color }}
                      >
                        {!isEditing ? (
                          <div className="flex items-start justify-between p-4">
                            <div>
                              <p className="font-bold text-[#1B2A4A]">{loan.name}</p>
                              <span
                                className="mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold text-white"
                                style={{ backgroundColor: color }}
                              >
                                {LOAN_TYPE_LABELS[loan.type]}
                              </span>
                              {loan.notes && (
                                <p className="mt-1 text-[10px] italic text-[#9AA5B4]">{loan.notes}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-[#1B2A4A]">{fmt(loan.balance)}</p>
                              <p className="text-[10px] text-[#9AA5B4]">
                                {loan.rate > 0 ? `${loan.rate}% APR` : "0% APR"}
                              </p>
                              <div className="mt-1 flex gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingId(loan.id);
                                    setDraft({ ...loan, assignedTo: loan.assignedTo });
                                  }}
                                  className="rounded border border-[#E4E8F0] px-2 py-0.5 text-[10px] text-[#9AA5B4]"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void deleteLoan(loan.id)}
                                  className="rounded border border-red-100 px-2 py-0.5 text-[10px] text-red-400"
                                >
                                  ×
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 bg-[#F9FAFC] p-4">
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Name</label>
                                <input autoFocus value={draft.name ?? ""} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Type</label>
                                <select value={draft.type ?? "other"} onChange={e => setDraft(p => ({ ...p, type: e.target.value as Loan["type"] }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none">
                                  {Object.entries(LOAN_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Balance ($)</label>
                                <input type="number" min={0} value={draft.balance ?? ""} onChange={e => setDraft(p => ({ ...p, balance: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Rate (%)</label>
                                <input type="number" min={0} step="0.01" value={draft.rate ?? ""} onChange={e => setDraft(p => ({ ...p, rate: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Min/mo ($)</label>
                                <input type="number" min={0} value={draft.minimumPayment ?? ""} onChange={e => setDraft(p => ({ ...p, minimumPayment: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                            </div>
                            <input value={draft.notes ?? ""} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))}
                              placeholder="Notes (optional)"
                              className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                            <div className="flex gap-2">
                              <button type="button" disabled={saving} onClick={() => void saveLoan()}
                                className="rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#1B2A4A] disabled:opacity-50">
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button type="button" onClick={() => { setEditingId(null); setDraft({}); }}
                                className="rounded-lg border border-[#E4E8F0] px-4 py-2 text-xs font-semibold text-[#9AA5B4]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {otherLoans.length > 0 && (
              <div>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                  {isAdmin
                    ? "Household — All Loans (Admin)"
                    : "Household — Other Member's Loans"}
                </p>
                <div className="space-y-2">
                  {otherLoans.map(loan => {
                    const isEditing = editingId === loan.id;
                    const color = LOAN_TYPE_COLORS[loan.type] || "#9AA5B4";
                    return (
                      <div
                        key={loan.id}
                        className={`overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white ${!isAdmin ? "opacity-70" : ""}`}
                        style={{ borderLeftWidth: 4, borderLeftColor: color }}
                      >
                        {!isEditing ? (
                          <div className="flex items-start justify-between p-4">
                            <div>
                              <p className="font-bold text-[#1B2A4A]">{loan.name}</p>
                              <div className="mt-0.5 flex items-center gap-2">
                                <span
                                  className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-semibold text-white"
                                  style={{ backgroundColor: color }}
                                >
                                  {LOAN_TYPE_LABELS[loan.type]}
                                </span>
                                <span className="text-[9px] text-[#9AA5B4]">{loan.assignedToName}</span>
                              </div>
                              {loan.notes && (
                                <p className="mt-1 text-[10px] italic text-[#9AA5B4]">{loan.notes}</p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-lg font-bold text-[#1B2A4A]">{fmt(loan.balance)}</p>
                              <p className="text-[10px] text-[#9AA5B4]">{loan.rate > 0 ? `${loan.rate}% APR` : "0% APR"}</p>
                              {isAdmin && (
                                <div className="mt-1 flex justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => { setEditingId(loan.id); setDraft({ ...loan, assignedTo: loan.assignedTo }); }}
                                    className="rounded border border-[#E4E8F0] px-2 py-0.5 text-[10px] text-[#9AA5B4] hover:text-[#1B2A4A]"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void deleteLoan(loan.id)}
                                    className="rounded border border-red-100 px-2 py-0.5 text-[10px] text-red-400 hover:bg-red-50"
                                  >
                                    ×
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-3 bg-[#F9FAFC] p-4">
                            <p className="text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                              Editing: {loan.name} ({loan.assignedToName})
                            </p>
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Name</label>
                                <input autoFocus value={draft.name ?? ""} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Type</label>
                                <select value={draft.type ?? "other"} onChange={e => setDraft(p => ({ ...p, type: e.target.value as Loan["type"] }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none">
                                  {Object.entries(LOAN_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                                </select>
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Balance ($)</label>
                                <input type="number" min={0} value={draft.balance ?? ""} onChange={e => setDraft(p => ({ ...p, balance: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Rate (%)</label>
                                <input type="number" min={0} step="0.01" value={draft.rate ?? ""} onChange={e => setDraft(p => ({ ...p, rate: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                              <div>
                                <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Min/mo ($)</label>
                                <input type="number" min={0} value={draft.minimumPayment ?? ""} onChange={e => setDraft(p => ({ ...p, minimumPayment: Number(e.target.value) }))}
                                  className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                              </div>
                            </div>
                            <input value={draft.notes ?? ""} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))}
                              placeholder="Notes (optional)"
                              className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                            <div className="flex gap-2">
                              <button type="button" disabled={saving} onClick={() => void saveLoan()}
                                className="rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#1B2A4A] disabled:opacity-50">
                                {saving ? "Saving…" : "Save"}
                              </button>
                              <button type="button" onClick={() => { setEditingId(null); setDraft({}); }}
                                className="rounded-lg border border-[#E4E8F0] px-4 py-2 text-xs font-semibold text-[#9AA5B4]">
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Add loan form */}
            {showForm && !editingId && (
              <div className="rounded-2xl border-2 border-dashed border-[#C9A84C] bg-[#FFF8E8] p-5">
                <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#C9A84C]">
                  Add Loan
                </p>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Name</label>
                      <input autoFocus value={draft.name ?? ""} onChange={e => setDraft(p => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Victoria Student Loan"
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Type</label>
                      <select value={draft.type ?? "other"} onChange={e => setDraft(p => ({ ...p, type: e.target.value as Loan["type"] }))}
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none">
                        {Object.entries(LOAN_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Balance ($)</label>
                      <input type="number" min={0} step="0.01" value={draft.balance ?? ""}
                        onChange={e => setDraft(p => ({ ...p, balance: Number(e.target.value) }))}
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Rate (% APR)</label>
                      <input type="number" min={0} step="0.01" value={draft.rate ?? ""}
                        onChange={e => setDraft(p => ({ ...p, rate: Number(e.target.value) }))}
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Min/mo ($)</label>
                      <input type="number" min={0} step="0.01" value={draft.minimumPayment ?? ""}
                        onChange={e => setDraft(p => ({ ...p, minimumPayment: Number(e.target.value) }))}
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Person</label>
                      <select value={draft.assignedTo ?? ""} onChange={e => setDraft(p => ({ ...p, assignedTo: e.target.value }))}
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none">
                        <option value="">Select person</option>
                        {members.map(m => (
                          <option key={m.uid} value={m.uid}>{m.firstName || m.displayName}</option>
                        ))}
                        <option value="joint">Joint</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[10px] font-semibold text-[#9AA5B4]">Notes</label>
                      <input value={draft.notes ?? ""} onChange={e => setDraft(p => ({ ...p, notes: e.target.value }))}
                        placeholder="Optional context"
                        className="h-9 w-full rounded-lg border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" disabled={saving || !draft.name} onClick={() => void saveLoan()}
                      className="rounded-lg bg-[#C9A84C] px-4 py-2 text-xs font-bold text-[#1B2A4A] disabled:opacity-50">
                      {saving ? "Saving…" : "Add Loan"}
                    </button>
                    <button type="button" onClick={() => { setShowForm(false); setDraft({}); }}
                      className="rounded-lg border border-[#E4E8F0] px-4 py-2 text-xs font-semibold text-[#9AA5B4]">
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Add another loan button */}
            {!showForm && !editingId && hasDebt === "yes" && (
              <button
                type="button"
                onClick={() => { setShowForm(true); setDraft({ type: "other", assignedTo: user?.uid ?? "" }); }}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#E4E8F0] bg-white py-4 text-sm font-semibold text-[#9AA5B4] hover:border-[#C9A84C] hover:text-[#C9A84C]"
              >
                + Add another loan
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
