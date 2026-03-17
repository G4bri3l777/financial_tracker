"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { db } from "@/app/lib/firebase";

const STEPS = [
  { id: "reading", label: "Reading your transactions..." },
  { id: "categorizing", label: "Categorizing your spending..." },
  { id: "calculating", label: "Calculating your health score..." },
  { id: "insights", label: "Generating personalized insights..." },
  { id: "report", label: "Building your report..." },
];

export default function OnboardingAnalyzingPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const didRunRef = useRef(false);

  const [householdId, setHouseholdId] = useState("");
  const [stepIndex, setStepIndex] = useState(0);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadContext = async () => {
      if (!user) return;

      setLoadingContext(true);
      setError("");
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data() ?? {};
        const hid = typeof userData.householdId === "string" ? userData.householdId : "";
        if (!hid) throw new Error("No household found for your account.");
        setHouseholdId(hid);
      } catch (contextError) {
        const message =
          contextError instanceof Error ? contextError.message : "Could not load analysis context.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };

    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }

    if (!authLoading && user) {
      void loadContext();
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!householdId || didRunRef.current) return;
    didRunRef.current = true;
    setError("");

    const interval = window.setInterval(() => {
      setStepIndex((prev) => (prev < STEPS.length - 1 ? prev + 1 : prev));
    }, 8000);

    const runAnalysis = async () => {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ householdId }),
        });
        const data = (await response.json()) as {
          success: boolean;
          reportId?: string;
          error?: string;
        };

        if (!response.ok || !data.success || !data.reportId) {
          throw new Error(data.error || "Could not generate your report.");
        }

        router.push(`/onboarding/report?reportId=${data.reportId}`);
      } catch (analysisError) {
        const message =
          analysisError instanceof Error ? analysisError.message : "Could not complete analysis.";
        setError(message);
      } finally {
        window.clearInterval(interval);
      }
    };

    void runAnalysis();

    return () => window.clearInterval(interval);
  }, [householdId, router]);

  if (authLoading || loadingContext) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  const progress = ((stepIndex + 1) / STEPS.length) * 100;

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[85vh] w-full max-w-3xl flex-col items-center justify-between">
        <header className="pt-4 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#C9A84C]">
            Kingdom Wealth
          </p>
        </header>

        <main className="w-full max-w-xl space-y-8 text-center">
          <div className="mx-auto h-40 w-40 animate-pulse rounded-full bg-[#C9A84C]/20 ring-8 ring-[#C9A84C]/30" />

          <div className="space-y-2">
            <p className="text-xl font-medium text-[#1B2A4A]">{STEPS[stepIndex].label}</p>
            <p className="text-sm text-[#1B2A4A]/60">This usually takes 30–60 seconds</p>
          </div>

          <ul className="space-y-2 text-sm text-[#1B2A4A]/80">
            {STEPS.map((step, index) => (
              <li key={step.id}>
                {index < stepIndex ? "✅ " : ""} {step.label}
              </li>
            ))}
          </ul>

          <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
            <div
              className="h-2 rounded-full bg-[#C9A84C] transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>

          {error ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-flex h-12 items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
              >
                Try Again
              </button>
            </div>
          ) : null}
        </main>

        <footer className="pb-6 text-center text-sm italic text-[#C9A84C]">
          &quot;Commit your plans to the Lord and he will establish them&quot; — Prov 16:3
        </footer>
      </div>
    </div>
  );
}
