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
    <header className="sticky top-0 z-50 h-14 border-b border-kw-border bg-white">
      <div className="flex h-full w-full items-center justify-between px-4">
        {/* ── LEFT: Hamburger (mobile) + Logo ─────────── */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#1B2A4A] hover:bg-[#F4F6FA] lg:hidden"
            onClick={() => window.dispatchEvent(new Event("sidebar:open"))}
            aria-label="Open menu"
          >
            ☰
          </button>
        <Link href="/dashboard" className="flex items-center gap-2.5">
          {/* <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#1B2A4A]">
            <span className="text-sm font-black text-[#C9A84C]">KW</span>
          </div> */}
          <span className="hidden text-sm font-bold text-kw-navy sm:block">
            Kingdom Wealth
          </span>
        </Link>
        </div>

        {/* ── RIGHT: Settings + Avatar ─────────────────── */}
        <div className="flex items-center gap-2">
          {/* Settings icon button */}

          {/* Avatar + dropdown */}
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((p) => !p)}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-kw-gold text-sm font-bold text-kw-navy transition hover:opacity-90"
              title={displayName}
            >
              {initials}
            </button>

            {/* Dropdown */}
            {dropdownOpen && (
              <div className="absolute right-0 top-11 w-56 overflow-hidden rounded-2xl border border-kw-border bg-white shadow-xl">

                {/* Sign out */}
                <div className="border-t border-kw-bg p-1.5">
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="kw-btn-danger w-full gap-2.5"
                  >
                    <span className="text-base"></span>
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
