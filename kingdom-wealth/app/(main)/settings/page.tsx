"use client";

import Link from "next/link";
import { signOut } from "firebase/auth";
import { auth } from "@/app/lib/firebase";
import { useAuth } from "@/app/hooks/useAuth";

export default function SettingsPage() {
  const { user } = useAuth();

  async function handleSignOut() {
    await signOut(auth);
    window.location.href = "/login";
  }

  return (
    <div className="flex-1 overflow-y-auto bg-[#F4F6FA] p-6 md:p-8">
      <div className="mx-auto max-w-xl">
        <h1 className="mb-6 text-2xl font-bold text-[#1B2A4A]">Settings</h1>

        <div className="space-y-3">
          <Link
            href="/onboarding/profile"
            className="flex items-center justify-between rounded-2xl border border-[#E8ECF0] bg-white px-5 py-4 hover:border-[#C9A84C]"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">👤</span>
              <div>
                <p className="font-bold text-[#1B2A4A]">Profile</p>
                <p className="text-xs text-[#9AA5B4]">Name, date of birth, income</p>
              </div>
            </div>
            <span className="text-[#9AA5B4]">→</span>
          </Link>

          <Link
            href="/onboarding/household"
            className="flex items-center justify-between rounded-2xl border border-[#E8ECF0] bg-white px-5 py-4 hover:border-[#C9A84C]"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏠</span>
              <div>
                <p className="font-bold text-[#1B2A4A]">Household</p>
                <p className="text-xs text-[#9AA5B4]">Household name and country</p>
              </div>
            </div>
            <span className="text-[#9AA5B4]">→</span>
          </Link>

          <Link
            href="/settings/accounts"
            className="flex items-center justify-between rounded-2xl border border-[#E8ECF0] bg-white px-5 py-4 hover:border-[#C9A84C]"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">🏦</span>
              <div>
                <p className="font-bold text-[#1B2A4A]">Accounts & Cards</p>
                <p className="text-xs text-[#9AA5B4]">
                  Bank accounts, credit cards, statements
                </p>
              </div>
            </div>
            <span className="text-[#9AA5B4]">→</span>
          </Link>

          <Link
            href="/onboarding/invite"
            className="flex items-center justify-between rounded-2xl border border-[#E8ECF0] bg-white px-5 py-4 hover:border-[#C9A84C]"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">💌</span>
              <div>
                <p className="font-bold text-[#1B2A4A]">Invite Partner</p>
                <p className="text-xs text-[#9AA5B4]">
                  Share invite link with your spouse
                </p>
              </div>
            </div>
            <span className="text-[#9AA5B4]">→</span>
          </Link>

          <Link
            href="/onboarding/review"
            className="flex items-center justify-between rounded-2xl border border-[#E8ECF0] bg-white px-5 py-4 hover:border-[#C9A84C]"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl">📋</span>
              <div>
                <p className="font-bold text-[#1B2A4A]">Review Transactions</p>
                <p className="text-xs text-[#9AA5B4]">
                  Classify and categorize transactions
                </p>
              </div>
            </div>
            <span className="text-[#9AA5B4]">→</span>
          </Link>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="flex w-full items-center gap-3 rounded-2xl border border-red-100 bg-white px-5 py-4 hover:bg-red-50"
          >
            <span className="text-2xl">🚪</span>
            <div className="text-left">
              <p className="font-bold text-red-500">Sign Out</p>
              <p className="text-xs text-[#9AA5B4]">{user?.email}</p>
            </div>
          </button>
        </div>

        <Link
          href="/dashboard"
          className="mt-6 block text-center text-sm font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
        >
          ← Back to Overview
        </Link>
      </div>
    </div>
  );
}
