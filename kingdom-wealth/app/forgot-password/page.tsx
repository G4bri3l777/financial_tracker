"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { resetPassword } from "../lib/auth";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    try {
      setLoading(true);
      const redirectUrl = `${window.location.origin}/reset-password`;
      await resetPassword(email.trim(), redirectUrl);
      router.push(`/forgot-password/sent?email=${encodeURIComponent(email.trim())}`);
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Could not send reset email. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 hidden flex-col items-center text-center md:flex">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
          <h1 className="mt-2 text-3xl font-bold">Reset your password</h1>
        </div>

        <main className="md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="mb-8 space-y-2 md:mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
              Kingdom Wealth
            </p>
            <h2 className="text-3xl font-bold md:text-2xl">Forgot password?</h2>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              Enter your email and we will send you a link to reset your password.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Email</span>
              <input
                type="email"
                name="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={loading}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              {loading ? "Sending..." : "Send Reset Link"}
            </button>
          </form>

          <footer className="pt-6 text-center text-sm">
            Remember your password?{" "}
            <Link href="/login" className="font-semibold text-[#1B2A4A] underline">
              Back to login
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
