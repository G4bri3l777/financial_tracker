"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { confirmPasswordReset, verifyPasswordResetCode } from "firebase/auth";
import { auth } from "@/app/lib/firebase";

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oobCode = searchParams.get("oobCode");

  const [accountEmail, setAccountEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(true);
  const [success, setSuccess] = useState(false);
  const [validCode, setValidCode] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const validateCode = async () => {
      if (!oobCode) {
        setError("This password reset link is invalid or has expired.");
        setValidating(false);
        return;
      }

      try {
        const email = await verifyPasswordResetCode(auth, oobCode);
        setAccountEmail(email);
        setValidCode(true);
      } catch {
        setError("This password reset link is invalid or has expired.");
        setValidCode(false);
      } finally {
        setValidating(false);
      }
    };

    void validateCode();
  }, [oobCode]);

  useEffect(() => {
    if (!success) return;
    const timeout = window.setTimeout(() => {
      router.push("/login");
    }, 2000);
    return () => window.clearTimeout(timeout);
  }, [success, router]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!oobCode) {
      setError("This password reset link is invalid.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await confirmPasswordReset(auth, oobCode, password);
      setSuccess(true);
      setError("");
    } catch {
      setError("Could not reset password. Please request a new reset link.");
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
          <h1 className="mt-2 text-3xl font-bold">Set a new password</h1>
        </div>

        <main className="space-y-5 md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="space-y-2">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
              Kingdom Wealth
            </p>
            <h2 className="text-3xl font-bold md:text-2xl">Create new password</h2>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              Choose a secure password for your account.
            </p>
          </header>

          {validating ? <p className="text-sm text-[#1B2A4A]/75">Loading...</p> : null}

          {!validating && validCode && !success ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              {accountEmail ? (
                <p className="rounded-xl bg-[#F4F6FA] p-3 text-sm text-[#1B2A4A]/85">
                  Resetting password for <span className="font-semibold">{accountEmail}</span>
                </p>
              ) : null}

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">New password</span>
                <input
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Confirm new password</span>
                <input
                  type="password"
                  name="confirmPassword"
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>

              {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

              <button
                type="submit"
                disabled={loading || !oobCode}
                className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
              >
                {loading ? "Saving..." : "Update Password"}
              </button>
            </form>
          ) : null}

          {success ? (
            <div className="space-y-4">
              <p className="rounded-xl bg-[#F4F6FA] p-4 text-sm text-[#1B2A4A]/85">
                Password updated! Redirecting to login...
              </p>
            </div>
          ) : null}

          {!validating && !validCode ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-red-600">
                This password reset link is invalid or has expired.
              </p>
              <Link
                href="/forgot-password"
                className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#1B2A4A]/20 bg-white px-5 text-base font-semibold text-[#1B2A4A] transition hover:bg-[#F4F6FA]"
              >
                Request new reset link
              </Link>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-navy">Loading...</div>
        </div>
      }
    >
      <PageContent />
    </Suspense>
  );
}
