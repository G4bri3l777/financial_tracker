"use client";

import Link from "next/link";

export default function TransactionsPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-[#1B2A4A]">Transactions</h1>
      <p className="mb-6 text-[#9AA5B4]">
        Add and manage your transactions.
      </p>
      <div className="rounded-2xl border border-[#E8ECF0] bg-white p-8">
        <div className="space-y-4">
          <p className="text-[#9AA5B4]">Add transactions manually or import from statements.</p>
          <div className="flex gap-3">
            <Link
              href="/onboarding/review"
              className="rounded-xl bg-[#C9A84C] px-5 py-2.5 text-sm font-bold text-[#1B2A4A] hover:opacity-90"
            >
              Review & categorize transactions
            </Link>
            <Link
              href="/onboarding/upload"
              className="rounded-xl border border-[#E8ECF0] px-5 py-2.5 text-sm font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
            >
              Import statement
            </Link>
          </div>
        </div>
        <Link
          href="/dashboard"
          className="mt-6 block text-sm font-semibold text-[#C9A84C] hover:text-[#1B2A4A]"
        >
          ← Back to Overview
        </Link>
      </div>
    </div>
  );
}
