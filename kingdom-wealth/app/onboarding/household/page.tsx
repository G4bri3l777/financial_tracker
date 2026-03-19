"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
import OnboardingProgressDots from "@/app/components/OnboardingProgressDots";
import { db } from "@/app/lib/firebase";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

const countries = [
  "United States",
  "Canada",
  "United Kingdom",
  "Australia",
  "New Zealand",
  "Mexico",
  "Colombia",
  "Argentina",
  "Spain",
  "Ecuador",
  "Panama",
  "Other",
];

export default function OnboardingHouseholdPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [householdName, setHouseholdName] = useState("");
  const [country, setCountry] = useState("United States");
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [role, setRole] = useState<"admin" | "member" | null>(null);
  const [fetchingHousehold, setFetchingHousehold] = useState(false);
  const [guardChecked, setGuardChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      setGuardChecked(true);
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    const loadExistingHousehold = async () => {
      if (!user) {
        return;
      }

      setFetchingHousehold(true);
      setError("");

      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();
        const userRole = userData?.role as "admin" | "member" | undefined;
        const onboardingStep = userData?.onboardingStep as string | undefined;
        setRole(userRole ?? null);

        if (
          onboardingStep === "complete" ||
          (onboardingStep === "invite" && userRole === "member")
        ) {
          router.replace("/dashboard");
          return;
        }

        const existingHouseholdId = userData?.householdId as
          | string
          | null
          | undefined;

        if (!existingHouseholdId) {
          setHouseholdId(null);
          return;
        }

        const householdSnap = await getDoc(doc(db, "households", existingHouseholdId));
        if (!householdSnap.exists()) {
          setHouseholdId(null);
          return;
        }

        const householdData = householdSnap.data();
        setHouseholdId(existingHouseholdId);
        setHouseholdName(
          typeof householdData?.name === "string" ? householdData.name : "",
        );
        setCountry(
          typeof householdData?.country === "string"
            ? householdData.country
            : "United States",
        );
      } catch (loadError) {
        const message =
          loadError instanceof Error
            ? loadError.message
            : "Could not load household data.";
        setError(message);
      } finally {
        setFetchingHousehold(false);
        setGuardChecked(true);
      }
    };

    if (!authLoading && user) {
      void loadExistingHousehold();
    }
  }, [authLoading, user, router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      setError("You need to be logged in to continue.");
      return;
    }

    try {
      setSaving(true);

      if (role === "member") {
        if (!householdId) {
          throw new Error("No household found for your account.");
        }

        await updateDoc(doc(db, "households", householdId), {
          name: householdName.trim(),
          country,
        });

        await updateDoc(doc(db, "users", user.uid), {
          onboardingStep: "accounts",
        });

        router.push("/onboarding/accounts");
        return;
      }

      if (householdId) {
        await updateDoc(doc(db, "households", householdId), {
          name: householdName.trim(),
          country,
        });

        await updateDoc(doc(db, "users", user.uid), {
          onboardingStep: "invite",
        });
      } else {
        const householdRef = await addDoc(collection(db, "households"), {
          name: householdName.trim(),
          country,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          members: [user.uid],
          budget: null,
        });

        await updateDoc(doc(db, "users", user.uid), {
          householdId: householdRef.id,
          role: "admin",
          onboardingStep: "invite",
        });
      }

      router.push("/onboarding/invite");
    } catch (submitError) {
      const message =
        submitError instanceof Error
          ? submitError.message
          : "We could not save your household setup. Please try again.";
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
          <OnboardingProgressDots currentStep="Household" userRole={role ?? ""} />
          <h1 className="text-xl font-bold text-kw-navy sm:text-2xl">
            {role === "member" ? "Your household" : "Set up your household"}
          </h1>
          <p className="mt-1 text-sm text-[#9AA5B4]">
            {role === "member"
              ? `You're joining ${householdName || "your household"}`
              : "This is your shared financial space"}
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
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                Household name
              </label>
              <input
                type="text"
                name="householdName"
                placeholder="e.g. Cofre-Wise Family"
                value={householdName}
                onChange={(event) => setHouseholdName(event.target.value)}
                disabled={fetchingHousehold || saving}
                required
                className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                Country
              </label>
              <select
                name="country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                disabled={fetchingHousehold || saving}
                className="h-10 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
              >
                {countries.map((countryOption) => (
                  <option key={countryOption} value={countryOption}>
                    {countryOption}
                  </option>
                ))}
              </select>
            </div>

            {fetchingHousehold && (
              <p className="text-sm text-[#9AA5B4]">Loading saved household...</p>
            )}

            <button
              type="submit"
              disabled={saving || fetchingHousehold}
              className="w-full rounded-xl bg-[#C9A84C] py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </form>
        </section>

        <Link
          href="/onboarding/profile"
          className="block text-sm font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
        >
          ← Back
        </Link>
      </div>
    </div>
  );
}
