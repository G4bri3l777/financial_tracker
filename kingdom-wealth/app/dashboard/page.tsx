"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../hooks/useAuth";
import { logoutUser } from "../lib/auth";

export default function DashboardPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return <div className="p-6">Loading...</div>;
  }

  if (!user) {
    return null;
  }

  const handleSignOut = async () => {
    await logoutUser();
    router.replace("/login");
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col items-center justify-center px-4 text-center md:px-6 lg:px-8">
      <h1 className="text-3xl font-bold text-[#1B2A4A] md:text-4xl">
        Welcome to Kingdom Wealth, {user.displayName || "Friend"}!
      </h1>
      <button
        type="button"
        onClick={handleSignOut}
        className="mt-6 inline-flex h-12 items-center justify-center rounded-xl bg-[#C9A84C] px-6 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
      >
        Sign Out
      </button>
    </main>
  );
}
