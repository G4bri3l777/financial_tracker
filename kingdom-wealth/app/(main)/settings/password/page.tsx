/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updateEmail,
  updatePassword,
} from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { auth, db } from "@/app/lib/firebase";

export default function SettingsPasswordPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [reAuthAction, setReAuthAction] = useState<"email" | "password" | null>(null);
  const [reAuthPassword, setReAuthPassword] = useState("");
  const [reAuthError, setReAuthError] = useState("");
  const [reAuthLoading, setReAuthLoading] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const data = snap.data() ?? {};
      const hid = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

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
        setToast("Email updated ✅");
        setNewEmail("");
      }
      if (reAuthAction === "password") {
        if (!newPassword || newPassword.length < 6) throw new Error("Password must be at least 6 characters.");
        if (newPassword !== confirmPwd) throw new Error("Passwords do not match.");
        await updatePassword(user, newPassword);
        setToast("Password updated ✅");
        setNewPassword("");
        setConfirmPwd("");
      }
      setReAuthAction(null);
      setReAuthPassword("");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setReAuthError(e instanceof Error ? e.message : "Authentication failed.");
    } finally {
      setReAuthLoading(false);
    }
  }

  if (authLoading || loadingCtx) return (
    <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
      <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full border border-[#E4E8F0] bg-white px-5 py-2.5 text-sm font-semibold text-[#1B2A4A] shadow-lg">
          {toast}
        </div>
      )}
      {reAuthAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-1 text-lg font-bold text-[#1B2A4A]">Confirm your password</h3>
            <p className="mb-4 text-xs text-[#9AA5B4]">For security, enter your current password to continue.</p>
            <input
              type="password"
              value={reAuthPassword}
              onChange={e => setReAuthPassword(e.target.value)}
              onKeyDown={e => e.key === "Enter" && void handleReAuth()}
              placeholder="Current password"
              className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
            />
            {reAuthError && <p className="mt-2 text-xs font-semibold text-red-600">{reAuthError}</p>}
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
                className="flex-1 rounded-xl border border-[#E4E8F0] py-2.5 text-sm font-semibold text-[#9AA5B4]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link href="/settings" className="text-xs text-[#9AA5B4] hover:text-[#1B2A4A]">← Settings</Link>
          <span className="text-[#E4E8F0]">/</span>
          <h1 className="text-xl font-bold text-[#1B2A4A]">Security</h1>
        </div>
      </div>
      <div className="mx-auto max-w-2xl flex-1 space-y-5 px-6 py-6">
        <section className="rounded-2xl border border-[#E4E8F0] bg-white p-6">
          <h2 className="mb-1 text-sm font-bold text-[#1B2A4A]">Modify your password</h2>
          <p className="mb-4 text-xs text-[#9AA5B4]">{user?.email}</p>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">New Email</label>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={newEmail}
                  onChange={e => setNewEmail(e.target.value)}
                  placeholder="new@email.com"
                  className="h-10 flex-1 rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newEmail.trim()}
                  onClick={() => setReAuthAction("email")}
                  className="rounded-xl border border-[#E4E8F0] bg-white px-4 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA] disabled:opacity-40"
                >
                  Update
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">New Password</label>
              <div className="space-y-2">
                <input
                  type="password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
                <input
                  type="password"
                  value={confirmPwd}
                  onChange={e => setConfirmPwd(e.target.value)}
                  placeholder="Confirm new password"
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
                <button
                  type="button"
                  disabled={!newPassword || newPassword !== confirmPwd}
                  onClick={() => setReAuthAction("password")}
                  className="w-full rounded-xl border border-[#E4E8F0] bg-white py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA] disabled:opacity-40"
                >
                  Change Password
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
