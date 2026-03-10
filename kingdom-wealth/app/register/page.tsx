"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { registerUser } from "../lib/auth";

export default function RegisterPage() {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!agreedToTerms) {
      setError("Please agree to Terms of Service.");
      return;
    }

    try {
      setLoading(true);
      await registerUser(email, password, firstName, lastName);
      router.push("/onboarding/profile");
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "Registration failed. Please try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8 md:bg-[#F4F6FA]">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 hidden flex-col items-center text-center md:flex">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
          <h1 className="mt-2 text-3xl font-bold">Create your account</h1>
        </div>

        <main className="md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <header className="mb-8 space-y-2 md:mb-6">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C] md:hidden">
              Kingdom Wealth
            </p>
            <h2 className="text-3xl font-bold md:text-2xl">Create your account</h2>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              Start building wealth together with clear goals and shared visibility.
            </p>
          </header>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-sm font-medium">First name</span>
                <input
                  type="text"
                  name="firstName"
                  autoComplete="given-name"
                  placeholder="John"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-sm font-medium">Last name</span>
                <input
                  type="text"
                  name="lastName"
                  autoComplete="family-name"
                  placeholder="Doe"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                  required
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </label>
            </div>

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

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Password</span>
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
              <span className="text-sm font-medium">Confirm password</span>
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

            <label className="flex items-start gap-2 rounded-xl border border-[#1B2A4A]/10 bg-[#F4F6FA] p-3">
              <input
                type="checkbox"
                name="terms"
                checked={agreedToTerms}
                onChange={(event) => setAgreedToTerms(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-[#1B2A4A]/30 accent-[#C9A84C]"
              />
              <span className="text-sm text-[#1B2A4A]/85">
                I agree to Terms of Service
              </span>
            </label>

            {error ? (
              <p className="text-sm font-medium text-red-600">{error}</p>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              {loading ? "Creating Account..." : "Create Account"}
            </button>
          </form>

          <footer className="pt-6 text-center text-sm">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-[#1B2A4A] underline">
              Log in
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
