"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../hooks/useAuth";
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
  const [fetchingHousehold, setFetchingHousehold] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
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
        const existingHouseholdId = userSnap.data()?.householdId as
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
      }
    };

    if (!authLoading && user) {
      void loadExistingHousehold();
    }
  }, [authLoading, user]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      setError("You need to be logged in to continue.");
      return;
    }

    try {
      setSaving(true);

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
              <span>Step 2 of 3</span>
              <span className="text-[#1B2A4A]/70">Household</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
              <div className="h-2 w-2/3 rounded-full bg-[#C9A84C]" />
            </div>
          </section>

          <section className="space-y-2">
            <h1 className="text-3xl font-bold md:text-4xl">Set up your household</h1>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              This is your shared financial space
            </p>
          </section>

          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Household name</span>
              <input
                type="text"
                name="householdName"
                placeholder="e.g. Cofre-Wise Family"
                value={householdName}
                onChange={(event) => setHouseholdName(event.target.value)}
                disabled={fetchingHousehold || saving}
                required
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              />
            </label>

            <label className="block space-y-1.5">
              <span className="text-sm font-medium">Country</span>
              <select
                name="country"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
                disabled={fetchingHousehold || saving}
                className="h-12 w-full rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] px-3 text-sm outline-none ring-[#C9A84C] transition focus:ring-2"
              >
                {countries.map((countryOption) => (
                  <option key={countryOption} value={countryOption}>
                    {countryOption}
                  </option>
                ))}
              </select>
            </label>

            {fetchingHousehold ? (
              <p className="text-sm text-[#1B2A4A]/70">Loading saved household...</p>
            ) : null}

            {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={saving || fetchingHousehold}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
            >
              {saving ? "Saving..." : "Continue"}
            </button>
          </form>

          <footer>
            <Link
              href="/onboarding/profile"
              className="text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
            >
              ← Back
            </Link>
          </footer>
        </main>
      </div>
    </div>
  );
}
