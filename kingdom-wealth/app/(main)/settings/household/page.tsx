"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useDocuments } from "@/app/hooks/useDocuments";
import { useMembers } from "@/app/hooks/useMembers";
import { db } from "@/app/lib/firebase";

export default function SettingsHouseholdPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [householdName, setHouseholdName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [userRole, setUserRole] = useState("");
  const [loadingCtx, setLoadingCtx] = useState(true);
  const [editingHHName, setEditingHHName] = useState(false);
  const [newHHName, setNewHHName] = useState("");
  const [savingHHName, setSavingHHName] = useState(false);
  const [toast, setToast] = useState("");

  const members = useMembers(householdId || undefined);
  const documents = useDocuments(householdId || undefined);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.replace("/login"); return; }
    getDoc(doc(db, "users", user.uid)).then(async snap => {
      const data = snap.data() ?? {};
      const hid = String(data.householdId ?? "");
      if (!hid) { router.replace("/onboarding/profile"); return; }
      setHouseholdId(hid);
      setUserRole(String(data.role ?? "member"));
      const hhSnap = await getDoc(doc(db, "households", hid));
      const hhData = hhSnap.data() ?? {};
      setHouseholdName(String(hhData.name ?? ""));
      setInviteCode(String(hhData.inviteCode ?? ""));
      setNewHHName(String(hhData.name ?? ""));
      setLoadingCtx(false);
    });
  }, [authLoading, user, router]);

  async function saveHouseholdName() {
    if (!householdId || !newHHName.trim()) return;
    setSavingHHName(true);
    try {
      await updateDoc(doc(db, "households", householdId), { name: newHHName.trim() });
      setHouseholdName(newHHName.trim());
      setEditingHHName(false);
      setToast("Household name updated ✅");
      setTimeout(() => setToast(""), 3000);
    } catch (e) {
      setToast("Error: " + (e instanceof Error ? e.message : "unknown"));
      setTimeout(() => setToast(""), 3000);
    } finally {
      setSavingHHName(false);
    }
  }

  const inviteLink = inviteCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/join?code=${inviteCode}`
    : "";

  async function copyInviteLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setToast("Invite link copied!");
    setTimeout(() => setToast(""), 3000);
  }

  const isAdmin = userRole === "admin";

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
          <h1 className="text-xl font-bold text-[#1B2A4A]">My Household</h1>
          {isAdmin && (
            <span className="rounded-full bg-[#C9A84C]/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[#C9A84C]">Admin</span>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-2xl flex-1 space-y-5 px-6 py-6">
        <section className="rounded-2xl border border-[#E4E8F0] bg-white p-6">
          <h2 className="mb-4 text-sm font-bold text-[#1B2A4A]">Modify household information</h2>
          <div className="mb-4">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Household Name</label>
            {isAdmin && editingHHName ? (
              <div className="flex gap-2">
                <input
                  value={newHHName}
                  onChange={e => setNewHHName(e.target.value)}
                  className="h-10 flex-1 rounded-xl border border-[#C9A84C] bg-white px-3 text-sm focus:outline-none"
                />
                <button type="button" disabled={savingHHName} onClick={() => void saveHouseholdName()} className="rounded-xl bg-[#C9A84C] px-4 text-xs font-bold text-[#1B2A4A] disabled:opacity-50">
                  {savingHHName ? "..." : "Save"}
                </button>
                <button type="button" onClick={() => { setEditingHHName(false); setNewHHName(householdName); }} className="rounded-xl border border-[#E4E8F0] px-3 text-xs text-[#9AA5B4]">Cancel</button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-[#1B2A4A]">{householdName || "—"}</p>
                {isAdmin && (
                  <button type="button" onClick={() => setEditingHHName(true)} className="text-xs font-semibold text-[#C9A84C] hover:text-[#1B2A4A]">Edit</button>
                )}
              </div>
            )}
          </div>
          {isAdmin && inviteLink && (
            <div className="mb-4">
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Invite Link</label>
              <div className="flex items-center gap-2 rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-3 py-2">
                <p className="flex-1 truncate text-xs text-[#9AA5B4]">{inviteLink}</p>
                <button type="button" onClick={() => void copyInviteLink()} className="shrink-0 rounded-lg bg-[#1B2A4A] px-3 py-1.5 text-[10px] font-bold text-white">Copy</button>
              </div>
            </div>
          )}
          <div>
            <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Members</label>
            <div className="space-y-2">
              {members.map(m => {
                const memberDocCount = documents.filter(d => d.uploadedBy === m.uid).length;
                return (
                  <div key={m.uid} className="flex items-center justify-between rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#C9A84C] text-sm font-bold text-[#1B2A4A]">
                        {(m.firstName || m.displayName || "?").charAt(0)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[#1B2A4A]">
                          {m.firstName || m.displayName}
                          {m.uid === user?.uid && <span className="ml-1.5 text-[10px] text-[#9AA5B4]">(you)</span>}
                        </p>
                        <p className="text-[10px] text-[#9AA5B4]">{memberDocCount} doc{memberDocCount !== 1 ? "s" : ""}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
