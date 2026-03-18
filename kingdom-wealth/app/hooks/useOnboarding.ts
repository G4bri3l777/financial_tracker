"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type OnboardingStep =
  | "profile"
  | "household"
  | "invite"
  | "accounts"
  | "review"
  | "loans"
  | "questions"
  | "analyzing"
  | "complete";

export function useOnboarding(uid?: string) {
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) {
      setOnboardingStep(null);
      setRole(null);
      setLoading(false);
      return;
    }

    const userRef = doc(db, "users", uid);
    const unsubscribe = onSnapshot(
      userRef,
      (snap) => {
        const data = snap.data();
        setOnboardingStep((data?.onboardingStep as OnboardingStep | undefined) ?? null);
        setRole((data?.role as string | undefined) ?? null);
        setLoading(false);
      },
      () => {
        setOnboardingStep(null);
        setRole(null);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [uid]);

  return { onboardingStep, role, loading };
}
