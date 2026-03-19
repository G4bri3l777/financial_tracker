"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "../../hooks/useAuth";
import { db } from "../../lib/firebase";
import OnboardingProgressDots from "@/app/components/OnboardingProgressDots";

type HousingValue = "own" | "rent";
type DebtValue = "yes" | "no";

export default function OnboardingProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");
  const [ownsOrRents, setOwnsOrRents] = useState<HousingValue>("rent");
  const [hasDebt, setHasDebt] = useState<DebtValue>("no");
  const [fetchingProfile, setFetchingProfile] = useState(false);
  const [guardChecked, setGuardChecked] = useState(false);
  const [userRole, setUserRole] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const parsedDisplayName = useMemo(() => {
    const fullName = user?.displayName?.trim() ?? "";
    if (!fullName) {
      return { first: "", last: "" };
    }

    const nameParts = fullName.split(/\s+/);
    return {
      first: nameParts[0] ?? "",
      last: nameParts.slice(1).join(" "),
    };
  }, [user?.displayName]);

  useEffect(() => {
    if (!authLoading && !user) {
      setGuardChecked(true);
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    const loadExistingProfile = async () => {
      if (!user) {
        return;
      }

      setFetchingProfile(true);
      setError("");

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const onboardingStep = userSnap.data()?.onboardingStep as string | undefined;
        const role = userSnap.data()?.role as string | undefined;

        if (
          onboardingStep === "complete" ||
          (onboardingStep === "invite" && role === "member")
        ) {
          router.replace("/dashboard");
          return;
        }

        const data = userSnap.data();

        setFirstName(
          typeof data?.firstName === "string" && data.firstName.trim()
            ? data.firstName
            : parsedDisplayName.first,
        );
        setLastName(
          typeof data?.lastName === "string" && data.lastName.trim()
            ? data.lastName
            : parsedDisplayName.last,
        );
        setDateOfBirth(
          typeof data?.dateOfBirth === "string" ? data.dateOfBirth : "",
        );
        setMonthlyIncome(
          data?.monthlyIncome !== undefined && data?.monthlyIncome !== null
            ? String(data.monthlyIncome)
            : "",
        );
        setOwnsOrRents(data?.ownsOrRents === "own" ? "own" : "rent");
        setHasDebt(data?.hasDebt === "yes" ? "yes" : "no");
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Could not load your profile data.";
        setError(message);
      } finally {
        setFetchingProfile(false);
        setGuardChecked(true);
      }
    };

    if (!authLoading && user) {
      void loadExistingProfile();
    }
  }, [authLoading, user, parsedDisplayName.first, parsedDisplayName.last, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      setError("You need to be logged in to continue.");
      return;
    }

    try {
      setSaving(true);
      await setDoc(
        doc(db, "users", user.uid),
        {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          dateOfBirth,
          monthlyIncome: Number(monthlyIncome),
          ownsOrRents,
          hasDebt,
          onboardingStep: "household",
        },
        { merge: true },
      );

      const userSnap = await getDoc(doc(db, "users", user.uid));
      const role = userSnap.data()?.role as string | undefined;
      if (role === "admin") {
        router.push("/onboarding/household");
      } else {
        router.push("/onboarding/household");
      }
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "We could not save your profile. Please try again.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (authLoading || !guardChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F4F6FA]">
        <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-[#F4F6FA] text-[#1B2A4A]">
      {/* Header */}
      <div className="border-b border-kw-border bg-white px-4 py-4 sm:px-6 sm:py-5">
        <div className="mx-auto max-w-2xl">
          <OnboardingProgressDots currentStep="Profile" userRole={userRole} />
          <h1 className="text-xl font-bold text-kw-navy sm:text-2xl">Tell us about yourself</h1>
          <p className="mt-1 text-sm text-[#9AA5B4]">
            This helps us personalize your financial analysis
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-[#E4E8F0] bg-white p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">First name</label>
                <input
                  type="text"
                  name="firstName"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  disabled={fetchingProfile || saving}
                  required
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Last name</label>
                <input
                  type="text"
                  name="lastName"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  disabled={fetchingProfile || saving}
                  required
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Date of birth</label>
              <input
                type="date"
                name="dateOfBirth"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                disabled={fetchingProfile || saving}
                required
                className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Monthly take-home income</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">$</span>
                <input
                  type="number"
                  name="monthlyIncome"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                  disabled={fetchingProfile || saving}
                  required
                  className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white pl-6 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Own or Rent?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOwnsOrRents("own")}
                  disabled={fetchingProfile || saving}
                  className={`h-10 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                    ownsOrRents === "own"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:bg-[#F9FAFC]"
                  }`}
                >
                  I Own
                </button>
                <button
                  type="button"
                  onClick={() => setOwnsOrRents("rent")}
                  disabled={fetchingProfile || saving}
                  className={`h-10 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                    ownsOrRents === "rent"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:bg-[#F9FAFC]"
                  }`}
                >
                  I Rent
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">Any existing debt?</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHasDebt("yes")}
                  disabled={fetchingProfile || saving}
                  className={`h-10 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                    hasDebt === "yes"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:bg-[#F9FAFC]"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setHasDebt("no")}
                  disabled={fetchingProfile || saving}
                  className={`h-10 flex-1 rounded-xl border px-4 text-sm font-semibold transition ${
                    hasDebt === "no"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#E4E8F0] bg-white text-[#1B2A4A] hover:bg-[#F9FAFC]"
                  }`}
                >
                  No
                </button>
              </div>
            </div>

            {fetchingProfile && (
              <p className="text-sm text-[#9AA5B4]">Loading saved profile...</p>
            )}

            <button
              type="submit"
              disabled={saving || fetchingProfile}
              className="w-full rounded-xl bg-[#C9A84C] py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
