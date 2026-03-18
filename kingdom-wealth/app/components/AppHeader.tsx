"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "@/app/lib/firebase";
import { useAuth } from "@/app/hooks/useAuth";
import Link from "next/link";

// Pages where the header should NOT appear
const HIDE_ON: string[] = ["/login", "/register", "/join"];

export default function AppHeader() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [profile, setProfile] = useState<{
    firstName: string;
    lastName: string;
    email: string;
    role: string;
  } | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load profile
  useEffect(() => {
    if (!user) return;
    getDoc(doc(db, "users", user.uid)).then((snap) => {
      if (!snap.exists()) return;
      const d = snap.data();
      setProfile({
        firstName: String(d.firstName ?? ""),
        lastName: String(d.lastName ?? ""),
        email: user.email ?? "",
        role: String(d.role ?? "member"),
      });
    });
  }, [user]);

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Don't render on auth pages
  const hide = HIDE_ON.some((p) => pathname === p || pathname.startsWith(p + "?"));
  if (loading || !user || hide) return null;

  const initials =
    [profile?.firstName, profile?.lastName]
      .filter(Boolean)
      .map((s) => s!.charAt(0).toUpperCase())
      .join("") || user.email?.charAt(0).toUpperCase() || "?";

  const displayName =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") ||
    user.email ||
    "User";

  async function handleSignOut() {
    setDropdownOpen(false);
    await signOut(auth);
    router.replace("/login");
  }

  return (
    <header className="sticky top-0 z-50 h-14 border-b border-[#E4E8F0] bg-white">
      <div className="flex h-full w-full items-center justify-between px-4">
        {/* ── LEFT: Logo ──────────────────────────────── */}
        <Link href="/dashboard" className="flex items-center gap-2.5">
          {/* <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1B2A4A]">
            <span className="text-sm font-black text-[#C9A84C]">KW</span>
          </div> */}
          <span className="hidden text-sm font-bold text-[#1B2A4A] sm:block">
            Kingdom Wealth
          </span>
        </Link>

        {/* ── RIGHT: Settings + Avatar ─────────────────── */}
        <div className="flex items-center gap-2">
          {/* Settings icon button */}
          <Link
            href="/settings"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#E4E8F0] bg-white text-[#9AA5B4] transition hover:border-[#1B2A4A] hover:text-[#1B2A4A]"
            title="Settings"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </Link>

          {/* Avatar + dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((p) => !p)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#C9A84C] text-sm font-bold text-[#1B2A4A] transition hover:opacity-90"
              title={displayName}
            >
              {initials}
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute right-0 top-11 w-56 overflow-hidden rounded-2xl border border-[#E4E8F0] bg-white shadow-xl">
                {/* User info */}
                <div className="border-b border-[#F4F6FA] px-4 py-3">
                  <p className="text-sm font-bold text-[#1B2A4A]">{displayName}</p>
                  <p className="text-[11px] text-[#9AA5B4]">{profile?.email}</p>
                  {profile?.role === "admin" && (
                    <span className="mt-1 inline-block rounded-full bg-[#C9A84C]/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#C9A84C]">
                      Admin
                    </span>
                  )}
                </div>

                {/* Menu items */}
                <div className="p-1.5">
                  <Link
                    href="/settings"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                  >
                    <span className="text-base">⚙️</span>
                    Settings
                  </Link>

                  <Link
                    href="/onboarding/profile"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                  >
                    <span className="text-base">👤</span>
                    Edit Profile
                  </Link>

                  <Link
                    href="/onboarding/accounts"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                  >
                    <span className="text-base">🏦</span>
                    Manage Accounts
                  </Link>

                  <Link
                    href="/onboarding/review"
                    onClick={() => setDropdownOpen(false)}
                    className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                  >
                    <span className="text-base">📋</span>
                    Review Transactions
                  </Link>
                </div>

                {/* Sign out */}
                <div className="border-t border-[#F4F6FA] p-1.5">
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-500 hover:bg-red-50"
                  >
                    <span className="text-base">🚪</span>
                    Sign out
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
