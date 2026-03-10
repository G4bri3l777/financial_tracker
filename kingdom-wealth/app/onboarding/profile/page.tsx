"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "../../hooks/useAuth";
import { db } from "../../lib/firebase";

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
      }
    };

    if (!authLoading && user) {
      void loadExistingProfile();
    }
  }, [authLoading, user, parsedDisplayName.first, parsedDisplayName.last]);

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
      router.push("/onboarding/household");
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-lg">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-lg">
        <main className="space-y-6 md:rounded-2xl md:bg-white md:p-8 md:shadow-xl">
          <section className="space-y-3">
            <div className="flex items-center justify-between text-sm font-medium">
              <span>Step 1 of 3</span>
              <span className="text-[#1B2A4A]/70">Profile</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
              <div className="h-2 w-1/3 rounded-full bg-[#C9A84C]" />
            </div>
          </section>

          <section className="space-y-2">
            <h1 className="text-3xl font-bold md:text-4xl">Tell us about yourself</h1>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              This helps us personalize your financial analysis
            </p>
          </section>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">First name</span>
              <input
                type="text"
                name="firstName"
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
                disabled={fetchingProfile || saving}
                required
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Last name</span>
              <input
                type="text"
                name="lastName"
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
                disabled={fetchingProfile || saving}
                required
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Date of birth</span>
              <input
                type="date"
                name="dateOfBirth"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
                disabled={fetchingProfile || saving}
                required
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Monthly take-home income</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#1B2A4A]/60">
                  $
                </span>
                <input
                  type="number"
                  name="monthlyIncome"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  value={monthlyIncome}
                  onChange={(event) => setMonthlyIncome(event.target.value)}
                  disabled={fetchingProfile || saving}
                  required
                  className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] pl-8 pr-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
                />
              </div>
            </label>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Own or Rent?</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOwnsOrRents("own")}
                  disabled={fetchingProfile || saving}
                  className={`h-11 flex-1 rounded-full border px-4 text-sm font-semibold transition ${
                    ownsOrRents === "own"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#1B2A4A]/15 bg-white text-[#1B2A4A]"
                  }`}
                >
                  I Own
                </button>
                <button
                  type="button"
                  onClick={() => setOwnsOrRents("rent")}
                  disabled={fetchingProfile || saving}
                  className={`h-11 flex-1 rounded-full border px-4 text-sm font-semibold transition ${
                    ownsOrRents === "rent"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#1B2A4A]/15 bg-white text-[#1B2A4A]"
                  }`}
                >
                  I Rent
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-sm font-medium">Any existing debt?</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setHasDebt("yes")}
                  disabled={fetchingProfile || saving}
                  className={`h-11 flex-1 rounded-full border px-4 text-sm font-semibold transition ${
                    hasDebt === "yes"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#1B2A4A]/15 bg-white text-[#1B2A4A]"
                  }`}
                >
                  Yes
                </button>
                <button
                  type="button"
                  onClick={() => setHasDebt("no")}
                  disabled={fetchingProfile || saving}
                  className={`h-11 flex-1 rounded-full border px-4 text-sm font-semibold transition ${
                    hasDebt === "no"
                      ? "border-[#C9A84C] bg-[#C9A84C] text-[#1B2A4A]"
                      : "border-[#1B2A4A]/15 bg-white text-[#1B2A4A]"
                  }`}
                >
                  No
                </button>
              </div>
            </div>

            {fetchingProfile ? (
              <p className="text-sm text-[#1B2A4A]/70">Loading saved profile...</p>
            ) : null}

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={saving || fetchingProfile}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </form>
        </main>
      </div>
    </div>
  );
}
