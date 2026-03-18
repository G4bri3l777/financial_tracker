"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useAccounts, type AccountType, type HouseholdAccount } from "@/app/hooks/useAccounts";
import { useMembers } from "@/app/hooks/useMembers";
import { db } from "@/app/lib/firebase";

const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: "checking", label: "Checking" },
  { value: "savings", label: "Savings" },
  { value: "credit", label: "Credit" },
  { value: "debit", label: "Debit" },
  { value: "cash", label: "Cash" },
];

const ACCOUNT_COLORS = ["#C9A84C", "#2563EB", "#059669", "#DC2626", "#7C3AED", "#EA580C"];

export default function SettingsAccountsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const members = useMembers(householdId || undefined);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<HouseholdAccount | null>(null);
  const [saving, setSaving] = useState(false);

  const { accounts, loading } = useAccounts(householdId || undefined);

  const [form, setForm] = useState({
    nickname: "",
    bankName: "",
    last4: "",
    type: "checking" as AccountType,
    creditLimit: "",
    owner: "joint",
    ownerName: "Joint",
    color: "#C9A84C",
  });

  const memberNameByUid = useMemo(
    () => new Map(members.map((m) => [m.uid, m.firstName || m.displayName || "Member"])),
    [members],
  );

  useEffect(() => {
    const loadContext = async () => {
      if (!user) return;
      setLoadingContext(true);
      setError("");
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();
        if (!userData) throw new Error("Could not load user profile.");
        const hid = typeof userData.householdId === "string" ? userData.householdId : "";
        if (!hid) throw new Error("No household found for your account.");
        setHouseholdId(hid);
      } catch (contextError) {
        const message =
          contextError instanceof Error ? contextError.message : "Could not load accounts.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };
    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!authLoading && user) void loadContext();
  }, [authLoading, user, router]);

  const resetForm = () => {
    const firstMember = members[0];
    const defaultOwner = firstMember?.uid || user?.uid || "joint";
    const defaultOwnerName =
      defaultOwner === "joint"
        ? "Joint"
        : memberNameByUid.get(defaultOwner) || firstMember?.firstName || user?.displayName || "Member";
    setForm({
      nickname: "",
      bankName: "",
      last4: "",
      type: "checking",
      creditLimit: "",
      owner: defaultOwner || "joint",
      ownerName: defaultOwnerName,
      color: "#C9A84C",
    });
    setEditingAccount(null);
  };

  const beginAdd = () => { resetForm(); setFormOpen(true); };

  const beginEdit = (account: HouseholdAccount) => {
    setForm({
      nickname: account.nickname,
      bankName: account.bankName,
      last4: account.last4,
      type: account.type,
      creditLimit: account.creditLimit ? String(account.creditLimit) : "",
      owner: account.owner,
      ownerName: account.ownerName,
      color: account.color || "#C9A84C",
    });
    setEditingAccount(account);
    setFormOpen(true);
  };

  const saveAccount = async () => {
    if (!householdId) return;
    if (!form.nickname.trim()) { setError("Please enter a nickname."); return; }
    if (!form.bankName.trim()) { setError("Please enter a bank name."); return; }
    setSaving(true);
    setError("");
    const bankName = form.bankName.trim();
    const nickname = form.nickname.trim();
    const last4 = form.last4.replace(/\D/g, "").slice(0, 4);
    const ownerName = form.owner === "joint" ? "Joint" : memberNameByUid.get(form.owner) || form.ownerName || "Member";
    const accountData = {
      nickname, bankName, last4, type: form.type,
      creditLimit: form.type === "credit" ? parseFloat(form.creditLimit || "0") || 0 : null,
      owner: form.owner, ownerName, color: form.color || "#C9A84C",
      householdId, createdAt: serverTimestamp(),
    };
    try {
      if (editingAccount) {
        await updateDoc(doc(db, "households", householdId, "accounts", editingAccount.id), accountData);
      } else {
        await addDoc(collection(db, "households", householdId, "accounts"), accountData);
      }
      resetForm();
      setFormOpen(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save account.");
    } finally {
      setSaving(false);
    }
  };

  const deleteAccount = async (account: HouseholdAccount) => {
    if (!householdId) return;
    if (!window.confirm(`Delete "${account.nickname}"? Transactions will keep their data but lose the account link.`)) return;
    try {
      await deleteDoc(doc(db, "households", householdId, "accounts", account.id));
      if (editingAccount?.id === account.id) { resetForm(); setFormOpen(false); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete account.");
    }
  };

  const getTypeLabel = (type: AccountType) =>
    ACCOUNT_TYPE_OPTIONS.find((o) => o.value === type)?.label ?? type;

  if (authLoading || loadingContext) {
    return (
      <div className="flex flex-1 items-center justify-center bg-[#F4F6FA] p-8">
        <p className="text-sm text-[#1B2A4A]/60">Loading...</p>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex-1 overflow-y-auto bg-[#F4F6FA] px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="rounded-2xl border border-[#E8ECF0] bg-white p-5 shadow-sm md:p-6">
          <h1 className="text-2xl font-bold md:text-3xl">Accounts</h1>
          <p className="mt-1 text-sm text-[#1B2A4A]/70">
            Manage your accounts and set their type (savings, checking, credit, etc.)
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href="/dashboard" className="inline-block text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2 hover:text-[#1B2A4A]">
              ← Back to Overview
            </Link>
            <Link href="/settings/categories" className="inline-block text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2 hover:text-[#1B2A4A]">
              Categories
            </Link>
          </div>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-[#E8ECF0] bg-white p-5 shadow-sm md:p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Your accounts</h2>
            <button type="button" onClick={beginAdd} className="inline-flex h-10 items-center justify-center rounded-lg bg-[#C9A84C] px-4 text-sm font-semibold text-[#1B2A4A] transition hover:brightness-95">
              + Add account
            </button>
          </div>

          {loading ? (
            <p className="mt-6 text-sm text-[#9AA5B4]">Loading accounts...</p>
          ) : accounts.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-[#E8ECF0] bg-[#FAFBFC] p-8 text-center">
              <p className="text-sm font-medium text-[#1B2A4A]/75">No accounts yet</p>
              <p className="mt-1 text-xs text-[#9AA5B4]">Add your first account and set it as savings or checking</p>
              <button type="button" onClick={beginAdd} className="mt-4 inline-flex h-10 items-center justify-center rounded-lg border border-[#C9A84C] px-4 text-sm font-semibold text-[#1B2A4A] hover:bg-[#FFF8E8]">
                + Add account
              </button>
            </div>
          ) : (
            <ul className="mt-4 space-y-2">
              {accounts.map((acc) => (
                <li key={acc.id} className="flex items-center justify-between rounded-xl border border-[#E8ECF0] bg-[#FAFBFC] p-4 transition hover:bg-[#F4F6FA]">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 shrink-0 rounded-full" style={{ backgroundColor: acc.color || "#C9A84C" }} />
                    <div>
                      <p className="font-semibold text-[#1B2A4A]">{acc.nickname}</p>
                      <p className="text-xs text-[#9AA5B4]">{acc.bankName} ••{acc.last4}</p>
                    </div>
                    <span className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      acc.type === "savings" ? "bg-emerald-100 text-emerald-800" :
                      acc.type === "checking" ? "bg-blue-100 text-blue-800" :
                      acc.type === "credit" ? "bg-amber-100 text-amber-800" : "bg-[#E8ECF0] text-[#1B2A4A]/70"
                    }`}>
                      {getTypeLabel(acc.type)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => beginEdit(acc)} className="rounded-lg border border-[#E8ECF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]">Edit</button>
                    <button type="button" onClick={() => void deleteAccount(acc)} className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">Delete</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {formOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#1B2A4A]/40 p-4">
            <div className="w-full max-w-md rounded-2xl border border-[#E8ECF0] bg-white p-6 shadow-xl">
              <h3 className="text-lg font-bold text-[#1B2A4A]">{editingAccount ? "Edit account" : "Add account"}</h3>
              <div className="mt-4 space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Nickname</label>
                  <input value={form.nickname} onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} placeholder="e.g. Main Checking" className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Bank name</label>
                  <input value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. Chase, Wells Fargo" className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Last 4 digits</label>
                  <input value={form.last4} onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value.replace(/\D/g, "").slice(0, 4) }))} placeholder="1234" maxLength={4} className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none" />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Account type</label>
                  <select value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as AccountType }))} className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none">
                    {ACCOUNT_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                  </select>
                  <p className="mt-0.5 text-[10px] text-[#9AA5B4]">Savings & checking are used for liquid funds and emergency fund</p>
                </div>
                {form.type === "credit" && (
                  <div>
                    <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Credit limit</label>
                    <input type="number" value={form.creditLimit} onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))} placeholder="0" className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none" />
                  </div>
                )}
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Owner</label>
                  <select value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value, ownerName: e.target.value === "joint" ? "Joint" : memberNameByUid.get(e.target.value) || "Member" }))} className="h-10 w-full rounded-lg border border-[#E8ECF0] bg-white px-3 text-sm text-[#1B2A4A] focus:border-[#C9A84C] focus:outline-none">
                    <option value="joint">Joint</option>
                    {members.map((m) => <option key={m.uid} value={m.uid}>{m.firstName || m.displayName || "Member"}</option>)}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-[#9AA5B4]">Color</label>
                  <div className="flex gap-2">
                    {ACCOUNT_COLORS.map((c) => (
                      <button key={c} type="button" onClick={() => setForm((f) => ({ ...f, color: c }))} className={`h-8 w-8 rounded-full transition ${form.color === c ? "ring-2 ring-[#1B2A4A] ring-offset-2" : ""}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="mt-6 flex gap-3">
                <button type="button" onClick={() => { resetForm(); setFormOpen(false); }} className="flex-1 rounded-lg border border-[#E8ECF0] px-4 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]">Cancel</button>
                <button type="button" onClick={() => void saveAccount()} disabled={saving} className="flex-1 rounded-lg bg-[#C9A84C] px-4 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:brightness-95 disabled:opacity-60">{saving ? "Saving..." : editingAccount ? "Update" : "Add"}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
