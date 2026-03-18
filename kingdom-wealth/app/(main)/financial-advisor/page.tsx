"use client";

import Link from "next/link";

export default function FinancialAdvisorPage() {
  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <h1 className="mb-6 text-2xl font-bold text-[#1B2A4A]">Financial Advisor</h1>
      <p className="mb-6 text-[#9AA5B4]">
        AI-powered insights and recommendations for your finances.
      </p>
      <div className="rounded-2xl border border-[#E8ECF0] bg-white p-8 text-center">
        <p className="text-[#9AA5B4]">Financial advisor features coming soon.</p>
        <Link
          href="/dashboard"
          className="mt-4 inline-block text-sm font-semibold text-[#C9A84C] hover:text-[#1B2A4A]"
        >
          ← Back to Overview
        </Link>
      </div>
    </div>
  );
}
