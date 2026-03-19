"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import OnboardingProgressDots from "@/app/components/OnboardingProgressDots";
import {
  Timestamp,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "../../hooks/useAuth";
import { db } from "@/app/lib/firebase";

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 12).toUpperCase();
}

export default function OnboardingInvitePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [loadingInvite, setLoadingInvite] = useState(true);
  const [guardChecked, setGuardChecked] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!authLoading && !user) {
      setGuardChecked(true);
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    const setupInvite = async () => {
      if (!user) {
        return;
      }

      setError("");
      setLoadingInvite(true);

      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data();
        const role = userData?.role as string | undefined;
        const onboardingStep = userData?.onboardingStep as string | undefined;

        if (
          onboardingStep === "complete" ||
          role === "member" ||
          (onboardingStep === "invite" && role === "member")
        ) {
          router.replace("/dashboard");
          return;
        }

        const householdId = userData?.householdId as string | undefined;

        if (!householdId) {
          throw new Error("No household found yet. Please complete Step 2 first.");
        }

        const code = generateInviteCode();
        const expiresAt = Timestamp.fromDate(
          new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        );

        await setDoc(doc(db, "invites", code), {
          code,
          householdId,
          createdBy: user.uid,
          createdAt: serverTimestamp(),
          used: false,
          expiresAt,
        });

        setInviteCode(code);
      } catch (setupError) {
        const message =
          setupError instanceof Error
            ? setupError.message
            : "Could not generate invite link. Please try again.";
        setError(message);
      } finally {
        setLoadingInvite(false);
        setGuardChecked(true);
      }
    };

    if (!authLoading && user) {
      void setupInvite();
    }
  }, [authLoading, user, router]);

  const inviteLink = useMemo(() => {
    if (!inviteCode || typeof window === "undefined") {
      return "";
    }

    return `${window.location.origin}/join?code=${inviteCode}`;
  }, [inviteCode]);

  const copyInviteLink = async () => {
    if (!inviteLink) {
      return;
    }

    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (!inviteLink) {
      return;
    }

    setError("");

    try {
      setSharing(true);
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: "Join my Kingdom Wealth household",
          text: "Use this link to join our shared Kingdom Wealth household.",
          url: inviteLink,
        });
      } else {
        await copyInviteLink();
      }
    } catch (shareError) {
      const message =
        shareError instanceof Error
          ? shareError.message
          : "Could not share invite link. Please try again.";
      setError(message);
    } finally {
      setSharing(false);
    }
  };

  const finishOnboarding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");

    if (!user) {
      setError("You need to be logged in to continue.");
      return;
    }

    try {
      setFinishing(true);
      await updateDoc(doc(db, "users", user.uid), {
        onboardingStep: "accounts",
      });
      router.push("/onboarding/accounts");
    } catch (finishError) {
      const message =
        finishError instanceof Error
          ? finishError.message
          : "Could not finish onboarding. Please try again.";
      setError(message);
    } finally {
      setFinishing(false);
    }
  };

  const handleSkip = async () => {
    setError("");

    if (!user) {
      setError("You need to be logged in to continue.");
      return;
    }

    try {
      setFinishing(true);
      await updateDoc(doc(db, "users", user.uid), {
        onboardingStep: "accounts",
      });
      router.push("/onboarding/accounts");
    } catch (skipError) {
      const message =
        skipError instanceof Error
          ? skipError.message
          : "Could not skip onboarding. Please try again.";
      setError(message);
    } finally {
      setFinishing(false);
    }
  };

  if (authLoading || loadingInvite || !guardChecked) {
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
          <OnboardingProgressDots currentStep="Invite" userRole="admin" />
          <h1 className="text-xl font-bold text-kw-navy sm:text-2xl">Invite your spouse</h1>
          <p className="mt-1 text-sm text-[#9AA5B4]">
            Kingdom Wealth works best when you both join
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl space-y-5 px-4 py-5 sm:px-6 sm:py-8">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <section className="rounded-2xl border border-[#E4E8F0] bg-white p-6 space-y-4">
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
              Invite link
            </label>
            <div className="flex items-center gap-2 rounded-xl border border-[#E4E8F0] bg-white p-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="h-10 flex-1 bg-transparent px-2 text-sm text-[#1B2A4A] outline-none"
              />
              <button
                type="button"
                onClick={copyInviteLink}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#E4E8F0] bg-[#F4F6FA] text-[#1B2A4A] hover:bg-[#E4E8F0] transition"
                aria-label="Copy invite link"
              >
                ⧉
              </button>
            </div>
            {copied ? <p className="mt-1 text-sm font-medium text-green-700">Copied!</p> : null}
          </div>

          <button
            type="button"
            onClick={handleShare}
            disabled={sharing || finishing || !inviteLink}
            className="w-full rounded-xl bg-[#C9A84C] py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
          >
            {sharing ? "Sharing..." : "Share Invite Link"}
          </button>

          <form onSubmit={finishOnboarding}>
            <button
              type="submit"
              disabled={finishing}
              className="w-full rounded-xl border border-[#C9A84C] bg-white py-2.5 text-sm font-bold text-[#1B2A4A] transition hover:bg-[#F9FAFC] disabled:opacity-50"
            >
              {finishing ? "Saving..." : "Continue to Accounts →"}
            </button>
          </form>
{/* 
          <button
            type="button"
            onClick={handleSkip}
            disabled={finishing}
            className="block w-full text-sm font-medium text-[#9AA5B4] hover:text-[#1B2A4A]"
          >
            Skip for now →
          </button> */}
        </section>

        <Link
          href="/onboarding/household"
          className="block text-sm font-semibold text-[#9AA5B4] hover:text-[#1B2A4A]"
        >
          ← Back
        </Link>
      </div>
    </div>
  );
}
