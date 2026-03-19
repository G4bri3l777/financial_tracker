"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
  signOut,
} from "firebase/auth";
import {
  collection, doc, getDoc,
  onSnapshot, orderBy, query, updateDoc,
} from "firebase/firestore";
import { useAuth }      from "@/app/hooks/useAuth";
import { useAccounts }  from "@/app/hooks/useAccounts";
import { useMembers }   from "@/app/hooks/useMembers";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useBudget }    from "@/app/hooks/useBudget";
import { auth, db }     from "@/app/lib/firebase";

function toYM(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return new Date(Number(y), Number(m)-1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdId,   setHouseholdId]   = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode,    setInviteCode]    = useState("");
  const [userRole,      setUserRole]      = useState("");
  const [loadingCtx,    setLoadingCtx]    = useState(true);

  // Profile fields
  const [firstName,      setFirstName]      = useState("");
  const [lastName,       setLastName]       = useState("");
  const [monthlyIncome,  setMonthlyIncome]  = useState("");
  const [savingProfile,  setSavingProfile]  = useState(false);

  // Household name (admin only)
  const [editingHHName,  setEditingHHName]  = useState(false);
  const [newHHName,      setNewHHName]      = useState("");
  const [savingHHName,   setSavingHHName]   = useState(false);

  // Re-auth modal state
  const [reAuthAction,   setReAuthAction]   = useState<"email" | "password" | null>(null);
  const [reAuthPassword, setReAuthPassword] = useState("");
  const [reAuthError,    setReAuthError]    = useState("");
  const [reAuthLoading,  setReAuthLoading]  = useState(false);

  // New email / password
  const [newEmail,       setNewEmail]       = useState("");
  const [newPassword,    setNewPassword]    = useState("");
  const [confirmPwd,     setConfirmPwd]     = useState("");

  // Transaction stats
  const [txStats,        setTxStats]        = useState({
    total: 0, unreviewed: 0, noCategory: 0,
    earliest: "", latest: "",
  });

  const [toast, setToast] = useState("");

  const currentYM = toYM();
  const { accounts }   = useAccounts(householdId || undefined);
  const members         = useMembers(householdId || undefined);
  const documents       = useDocuments(householdId || undefined);
  const { budget }      = useBudget(householdId || undefined, currentYM);

  const isAdmin = userRole === "admin";

  // Load user + household
  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(async snap => {
      const data = snap.data() ?? {};
      const hid  = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setUserRole(String(data.role ?? "member"));
      setFirstName(String(data.firstName ?? ""));
      setLastName(String(data.lastName   ?? ""));
      setMonthlyIncome(String(data.monthlyIncome ?? ""));

      // Load household name + invite code
      const hhSnap = await getDoc(doc(db, "households", hid));
      const hhData = hhSnap.data() ?? {};
      setHouseholdName(String(hhData.name ?? ""));
      setInviteCode(String(hhData.inviteCode ?? ""));
      setNewHHName(String(hhData.name ?? ""));

      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

  // Load transaction stats
  useEffect(() => {
    if (!householdId) return;
    const q = query(
      collection(db, "households", householdId, "transactions"),
      orderBy("date", "asc"),
    );
    return onSnapshot(q, snap => {
      const docs = snap.docs.map(d => d.data());
      const total      = docs.length;
      const unreviewed = docs.filter(d => !d.reviewed).length;
      const noCategory = docs.filter(d => !d.category).length;
      const dates      = docs.map(d => String(d.date ?? "")).filter(Boolean).sort();
      setTxStats({
        total,
        unreviewed,
        noCategory,
        earliest: dates[0]       ?? "",
        latest:   dates[dates.length-1] ?? "",
      });
    });
  }, [householdId]);

  // Documents per account
  const docsByAccount = useMemo(() => {
    const map: Record<string, number> = {};
    documents.forEach(d => {
      const key = d.accountDocId || "__none__";
      map[key] = (map[key] ?? 0) + 1;
    });
    return map;
  }, [documents]);

  async function saveProfile() {
    if (!user || !householdId) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        firstName,
        lastName,
        monthlyIncome: Number(monthlyIncome) || 0,
        displayName:   `${firstName} ${lastName}`.trim(),
      });
      showToast("Profile saved ✅");
    } catch (e) {
      showToast("Error: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveHouseholdName() {
    if (!householdId || !newHHName.trim()) return;
    setSavingHHName(true);
    try {
      await updateDoc(doc(db, "households", householdId), {
        name: newHHName.trim(),
      });
      setHouseholdName(newHHName.trim());
      setEditingHHName(false);
      showToast("Household name updated ✅");
    } catch (e) {
      showToast("Error: " + (e instanceof Error ? e.message : "unknown"));
    } finally {
      setSavingHHName(false);
    }
  }

  // Re-authenticate then perform the sensitive action
  async function handleReAuth() {
    if (!user?.email || !reAuthPassword) return;
    setReAuthLoading(true);
    setReAuthError("");
    try {
      const credential = EmailAuthProvider.credential(user.email, reAuthPassword);
      await reauthenticateWithCredential(user, credential);

      if (reAuthAction === "email") {
        if (!newEmail.trim()) throw new Error("New email is required.");
        await updateEmail(user, newEmail.trim());
        await updateDoc(doc(db, "users", user.uid), { email: newEmail.trim() });
        showToast("Email updated ✅");
        setNewEmail("");
      }

      if (reAuthAction === "password") {
        if (!newPassword || newPassword.length < 6)
          throw new Error("Password must be at least 6 characters.");
        if (newPassword !== confirmPwd)
          throw new Error("Passwords do not match.");
        await updatePassword(user, newPassword);
        showToast("Password updated ✅");
        setNewPassword("");
        setConfirmPwd("");
      }

      setReAuthAction(null);
      setReAuthPassword("");
    } catch (e) {
      setReAuthError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setReAuthLoading(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  }

  const inviteLink = inviteCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/join?code=${inviteCode}`
    : "";

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    showToast("Invite link copied!");
  }

  if (authLoading || loadingCtx) return (
    <div className="kw-page flex items-center justify-center">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">

      {/* Toast */}
      {toast && (
        <div className="kw-toast">
          {toast}
        </div>
      )}

      {/* Re-auth modal */}
      {reAuthAction && (
        <div className="kw-modal-backdrop">
          <div className="kw-modal">
            <h3 className="mb-1 text-lg font-bold text-[#1B2A4A]">
              Confirm your password
            </h3>
            <p className="mb-4 kw-caption">
              For security, enter your current password to continue.
            </p>
            <input
              type="password"
              value={reAuthPassword}
              onChange={e => setReAuthPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void handleReAuth()}
              placeholder="Current password"
              className="kw-input"
            />
            {reAuthError && (
              <p className="mt-2 text-xs font-semibold text-red-600">{reAuthError}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                disabled={reAuthLoading}
                onClick={() => void handleReAuth()}
                className="flex-1 rounded-xl bg-[#1B2A4A] py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {reAuthLoading ? "Verifying..." : "Confirm"}
              </button>
              <button
                type="button"
                onClick={() => { setReAuthAction(null); setReAuthPassword(""); setReAuthError(""); }}
                className="kw-btn-secondary flex-1"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <div className="flex items-center gap-3">
           
            <span className="text-[#E4E8F0]">/</span>
            <h1 className="text-xl font-bold text-[#1B2A4A]">Settings</h1>
          </div>
          {isAdmin && (
            <span className="rounded-full bg-[#C9A84C]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#C9A84C]">
              Admin
            </span>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl flex-1 space-y-5 px-6 py-6">

        {/* ── APP NAVIGATION ───────────────────────────────── */}
        <section className="kw-card">
          <p className="kw-label mb-3">
            Go to
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              { emoji: "💳", label: "Accounts & Cards", href: "/settings/accounts",     desc: "Manage your bank accounts" },
              { emoji: "📂", label: "Categories",       href: "/settings/categories",   desc: "Edit spending categories" },
              { emoji: "💳", label: "Loans & Debt",      href: "/settings/loans",      desc: "Track loans and payoff" },
              { emoji: "👤", label: "My Profile",       href: "/settings/profile",      desc: "Modify your profile information" },
              { emoji: "🏠", label: "My Household",     href: "/settings/household",    desc: "Modify information about your household" },
              { emoji: "🔒", label: "Security",         href: "/settings/password",     desc: "Modify your password" },
            ].map(link => (
              <Link
                key={link.label}
                href={link.href}
                className="kw-card-compact flex flex-col gap-1 hover:border-[#C9A84C] hover:bg-[#FFF8E8] transition-colors"
              >
                <span className="text-xl">{link.emoji}</span>
                <span className="kw-section-title text-xs">{link.label}</span>
                <span className="kw-caption text-[10px]">{link.desc}</span>
              </Link>
            ))}
          </div>
        </section>

      
      </div>
    </div>
  );
}
