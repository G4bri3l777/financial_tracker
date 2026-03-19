"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { db } from "@/app/lib/firebase";

export default function SettingsProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(snap => {
      const data = snap.data() ?? {};
      const hid = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setFirstName(String(data.firstName ?? ""));
      setLastName(String(data.lastName ?? ""));
      setMonthlyIncome(String(data.monthlyIncome ?? ""));
      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

  async function saveProfile() {
    if (!user || !householdId) return;
    setSavingProfile(true);
    try {
      await updateDoc(doc(db, "users", user.uid), {
        firstName,
        lastName,
        monthlyIncome: Number(monthlyIncome) || 0,
        displayName: `${firstName} ${lastName}`.trim(),
      });
      setToast("Profile saved ✅");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setToast("Error: " + (e instanceof Error ? e.message : "unknown"));
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSavingProfile(false);
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
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <Link href="/settings" className="text-xs text-[#9AA5B4] hover:text-[#1B2A4A]">← Settings</Link>
          <span className="text-[#E4E8F0]">/</span>
          <h1 className="text-xl font-bold text-[#1B2A4A]">My Profile</h1>
        </div>
      </div>
      <div className="mx-auto max-w-2xl flex-1 space-y-5 px-4 py-4 sm:px-6 sm:py-6">
        <section className="rounded-2xl border border-[#E4E8F0] bg-white p-6">
          <h2 className="mb-4 text-sm font-bold text-[#1B2A4A]">Modify your profile</h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">First Name</label>
                <input
                  value={firstName}
                  onChange={e => setFirstName(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Last Name</label>
                <input
                  value={lastName}
                  onChange={e => setLastName(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Monthly Income</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">$</span>
                <input
                  type="number"
                  value={monthlyIncome}
                  onChange={e => setMonthlyIncome(e.target.value)}
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white pl-6 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <p className="mt-1 text-[10px] text-[#9AA5B4]">Used to compute Dave Ramsey targets in the budget.</p>
            </div>
            <button
              type="button"
              disabled={savingProfile}
              onClick={() => void saveProfile()}
              className="w-full rounded-xl bg-[#C9A84C] py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
            >
              {savingProfile ? "Saving..." : "Save Profile"}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
