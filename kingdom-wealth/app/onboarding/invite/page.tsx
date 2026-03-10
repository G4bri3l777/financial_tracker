"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
  }, [authLoading, user]);

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
        onboardingStep: "complete",
      });
      router.push("/dashboard");
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
        onboardingStep: "complete",
      });
      router.push("/dashboard");
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
              <span>Step 3 of 3</span>
              <span className="text-[#1B2A4A]/70">Invite</span>
            </div>
            <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
              <div className="h-2 w-full rounded-full bg-[#C9A84C]" />
            </div>
          </section>

          <section className="space-y-2">
            <h1 className="text-3xl font-bold md:text-4xl">Invite your spouse</h1>
            <p className="text-sm text-[#1B2A4A]/75 md:text-base">
              Kingdom Wealth works best when you both join
            </p>
          </section>

          <section className="space-y-2">
            <p className="text-sm font-medium">Invite link</p>
            <div className="flex items-center gap-2 rounded-xl border border-[#1B2A4A]/15 bg-[#F4F6FA] p-2">
              <input
                type="text"
                value={inviteLink}
                readOnly
                className="h-10 flex-1 bg-transparent px-2 text-sm text-[#1B2A4A] outline-none"
              />
              <button
                type="button"
                onClick={copyInviteLink}
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[#1B2A4A]/15 bg-white text-[#1B2A4A]"
                aria-label="Copy invite link"
              >
                ⧉
              </button>
            </div>
            {copied ? <p className="text-sm font-medium text-green-700">Copied!</p> : null}
          </section>

          {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

          <button
            type="button"
            onClick={handleShare}
            disabled={sharing || finishing || !inviteLink}
            className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95"
          >
            {sharing ? "Sharing..." : "Share Invite Link"}
          </button>

          <form onSubmit={finishOnboarding} className="space-y-4">
            <button
              type="submit"
              disabled={finishing}
              className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-[#C9A84C] bg-white px-5 text-base font-semibold text-[#1B2A4A] transition hover:bg-[#F4F6FA]"
            >
              {finishing ? "Saving..." : "Continue to Dashboard →"}
            </button>
          </form>

          <div className="space-y-4">
            <button
              type="button"
              onClick={handleSkip}
              disabled={finishing}
              className="text-sm font-medium text-[#1B2A4A]/55 underline underline-offset-2"
            >
              Skip for now →
            </button>

            <div>
              <Link
                href="/onboarding/household"
                className="text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
              >
                ← Back
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
