"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

export default function ForgotPasswordSentPage() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 hidden flex-col items-center text-center md:flex">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
          <h1 className="mt-2 text-3xl font-bold">Check your email</h1>
        </div>

        <main className="space-y-5 md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
              Kingdom Wealth
            </p>
            <h2 className="text-3xl font-bold md:text-2xl">Reset link sent</h2>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              We sent a password reset link{email ? ` to ${email}` : ""}. Open your
              email and follow the instructions to set a new password.
            </p>
          </header>

          <div className="rounded-xl bg-[#F4F6FA] p-4 text-sm text-[#1B2A4A]/85">
            If you do not see it, check your spam/junk folder and try again.
          </div>

          <div className="space-y-3">
            <Link
              href="/login"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              Back to login
            </Link>
            <Link
              href="/forgot-password"
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#1B2A4A]/20 bg-white px-5 text-base font-semibold text-[#1B2A4A] transition hover:bg-[#F4F6FA]"
            >
              Send another link
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
