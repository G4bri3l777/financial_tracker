/* eslint-disable @typescript-eslint/no-unused-vars */
"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { db } from "@/app/lib/firebase";

type AnswerMap = Record<string, string | number>;
type QuestionType = "yesno" | "currency" | "percent";

type Question = {
  id: string;
  text: string;
  subtitle?: string;
  type: QuestionType;
  showIf?: (answers: AnswerMap) => boolean;
};

const QUESTIONS: Question[] = [
  {
    id: "has_student_loans",
    text: "Do you have student loans?",
    subtitle: "Include both federal and private loans",
    type: "yesno",
  },
  {
    id: "student_balance",
    text: "What is the total student loan balance?",
    type: "currency",
    showIf: (a) => a.has_student_loans === "yes",
  },
  {
    id: "student_rate",
    text: "What is the average interest rate on your student loans?",
    subtitle: "Approximate is fine",
    type: "percent",
    showIf: (a) => a.has_student_loans === "yes",
  },
  {
    id: "has_car_loan",
    text: "Do you have a car loan?",
    type: "yesno",
  },
  {
    id: "car_balance",
    text: "What is the remaining car loan balance?",
    type: "currency",
    showIf: (a) => a.has_car_loan === "yes",
  },
  {
    id: "car_payment",
    text: "What is your monthly car payment?",
    type: "currency",
    showIf: (a) => a.has_car_loan === "yes",
  },
  {
    id: "has_credit_card_debt",
    text: "Do you carry a balance on any credit cards?",
    subtitle: "Not counting cards you pay off monthly",
    type: "yesno",
  },
  {
    id: "credit_card_balance",
    text: "What is the total credit card balance you carry?",
    type: "currency",
    showIf: (a) => a.has_credit_card_debt === "yes",
  },
  {
    id: "credit_card_rate",
    text: "What is the average interest rate on your credit cards?",
    type: "percent",
    showIf: (a) => a.has_credit_card_debt === "yes",
  },
  {
    id: "has_medical_debt",
    text: "Do you have any medical debt?",
    type: "yesno",
  },
  {
    id: "medical_balance",
    text: "What is the total medical debt balance?",
    type: "currency",
    showIf: (a) => a.has_medical_debt === "yes",
  },
  {
    id: "has_personal_loan",
    text: "Do you have any personal loans?",
    type: "yesno",
  },
  {
    id: "personal_loan_balance",
    text: "What is the total personal loan balance?",
    type: "currency",
    showIf: (a) => a.has_personal_loan === "yes",
  },
  {
    id: "personal_loan_rate",
    text: "What is the interest rate on your personal loan?",
    type: "percent",
    showIf: (a) => a.has_personal_loan === "yes",
  },
  {
    id: "has_savings",
    text: "Do you have an emergency fund?",
    subtitle: "3-6 months of expenses saved",
    type: "yesno",
  },
  {
    id: "savings_amount",
    text: "How much do you have in your emergency fund?",
    type: "currency",
    showIf: (a) => a.has_savings === "yes",
  },
  {
    id: "monthly_savings",
    text: "How much does your household save per month?",
    subtitle: "Include all savings and investments",
    type: "currency",
  },
];

export default function OnboardingQuestionsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [loadingContext, setLoadingContext] = useState(true);
  const [householdId, setHouseholdId] = useState("");
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inputValue, setInputValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadContext = async () => {
      if (!user) return;

      setLoadingContext(true);
      setError("");
      try {
        const userRef = doc(db, "users", user.uid);
        const userSnap = await getDoc(userRef);
        const userData = userSnap.data() ?? {};
        const hid = typeof userData.householdId === "string" ? userData.householdId : "";
        if (!hid) throw new Error("No household found for your account.");
        setHouseholdId(hid);
        setAnswers((userData.debtAnswers as AnswerMap | undefined) ?? {});
      } catch (contextError) {
        const message =
          contextError instanceof Error ? contextError.message : "Could not load questionnaire.";
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

  const visibleQuestions = useMemo(
    () => QUESTIONS.filter((q) => (q.showIf ? q.showIf(answers) : true)),
    [answers],
  );

  useEffect(() => {
    if (currentIndex >= visibleQuestions.length && visibleQuestions.length > 0) {
      setCurrentIndex(visibleQuestions.length - 1);
    }
  }, [currentIndex, visibleQuestions.length]);

  const currentQuestion = visibleQuestions[currentIndex];
  const totalQuestions = visibleQuestions.length;

  useEffect(() => {
    if (!currentQuestion || currentQuestion.type === "yesno") {
      setInputValue("");
      return;
    }
    const existing = answers[currentQuestion.id];
    setInputValue(typeof existing === "number" ? String(existing) : "");
  }, [currentQuestion, answers]);

  const goToIndex = (nextIndex: number) => {
    setTransitioning(true);
    window.setTimeout(() => {
      setCurrentIndex(nextIndex);
      setTransitioning(false);
    }, 180);
  };

  const saveAnswer = async (questionId: string, value: string | number, nextAnswers?: AnswerMap) => {
    if (!user) return;
    const mergedAnswers = nextAnswers ?? { ...answers, [questionId]: value };
    setSaving(true);
    setError("");
    try {
      await setDoc(
        doc(db, "users", user.uid),
        {
          debtAnswers: mergedAnswers,
        },
        { merge: true },
      );
    } catch (saveError) {
      const message =
        saveError instanceof Error ? saveError.message : "Could not save your answer.";
      setError(message);
      throw saveError;
    } finally {
      setSaving(false);
    }
  };

  const finishQuestionnaire = async () => {
    if (!user) return;
    setCompleting(true);
    setError("");
    try {
      await setDoc(
        doc(db, "users", user.uid),
        { onboardingStep: "analyzing" },
        { merge: true },
      );
      window.setTimeout(() => {
        router.push("/onboarding/analyzing");
      }, 1200);
    } catch (finishError) {
      const message =
        finishError instanceof Error ? finishError.message : "Could not continue to analysis.";
      setError(message);
      setCompleting(false);
    }
  };

  const handleYesNo = async (value: "yes" | "no") => {
    if (!currentQuestion) return;
    const nextAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(nextAnswers);
    await saveAnswer(currentQuestion.id, value, nextAnswers);
    const nextIndex = currentIndex + 1;
    if (nextIndex >= QUESTIONS.length) {
      await finishQuestionnaire();
      return;
    }
    if (nextIndex >= QUESTIONS.filter((q) => (q.showIf ? q.showIf(nextAnswers) : true)).length) {
      await finishQuestionnaire();
      return;
    }
    goToIndex(nextIndex);
  };

  const handleContinue = async () => {
    if (!currentQuestion) return;
    const parsed = Number(inputValue);
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError("Please enter a valid number.");
      return;
    }
    const nextAnswers = { ...answers, [currentQuestion.id]: parsed };
    setAnswers(nextAnswers);
    await saveAnswer(currentQuestion.id, parsed, nextAnswers);

    if (currentIndex >= visibleQuestions.length - 1) {
      await finishQuestionnaire();
      return;
    }
    goToIndex(currentIndex + 1);
  };

  const handleSkip = async () => {
    if (!currentQuestion) return;
    if (currentIndex >= visibleQuestions.length - 1) {
      await finishQuestionnaire();
      return;
    }
    goToIndex(currentIndex + 1);
  };

  if (authLoading || loadingContext) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-md">Loading...</div>
      </div>
    );
  }

  if (!user || !householdId) return null;

  if (completing) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70vh] w-full max-w-md items-center justify-center rounded-2xl bg-white p-8 text-center shadow-xl">
          <p className="text-2xl font-semibold">Great work! We&apos;re building your financial picture now...</p>
        </div>
      </div>
    );
  }

  if (!currentQuestion) {
    return null;
  }

  const progress = totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0;

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto w-full max-w-md space-y-5">
        <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-6">
          <div className="mb-4 flex items-center justify-between text-sm font-medium">
            <button
              type="button"
              onClick={() => (currentIndex > 0 ? goToIndex(currentIndex - 1) : router.push("/onboarding/review"))}
              className="text-[#1B2A4A]/80"
            >
              ← Back
            </button>
            <span>
              {currentIndex + 1} of {totalQuestions}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-[#F4F6FA]">
            <div
              className="h-2 rounded-full bg-[#C9A84C] transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </section>

        <section className="rounded-2xl bg-white p-6 shadow-xl">
          <div
            className={`space-y-5 transition-all duration-300 ${
              transitioning ? "translate-y-2 opacity-0" : "translate-y-0 opacity-100"
            }`}
          >
            <header className="space-y-2 text-center">
              <h1 className="text-2xl font-bold text-[#1B2A4A]">{currentQuestion.text}</h1>
              {currentQuestion.subtitle ? (
                <p className="text-sm text-[#1B2A4A]/70">{currentQuestion.subtitle}</p>
              ) : null}
            </header>

            {currentQuestion.type === "yesno" ? (
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleYesNo("yes")}
                  className="inline-flex h-14 items-center justify-center rounded-2xl bg-[#C9A84C] text-base font-semibold text-[#1B2A4A] transition hover:brightness-95 disabled:opacity-60"
                >
                  Yes
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleYesNo("no")}
                  className="inline-flex h-14 items-center justify-center rounded-2xl border border-[#1B2A4A]/15 bg-white text-base font-semibold text-[#1B2A4A] transition hover:bg-[#F4F6FA] disabled:opacity-60"
                >
                  No
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-2xl text-[#1B2A4A]/60">
                    {currentQuestion.type === "currency" ? "$" : ""}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    className={`h-16 w-full rounded-2xl border border-[#1B2A4A]/15 bg-[#F4F6FA] text-center text-2xl font-semibold outline-none ring-[#C9A84C] transition focus:ring-2 ${
                      currentQuestion.type === "currency" ? "pl-10 pr-10" : "px-10"
                    }`}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-2xl text-[#1B2A4A]/60">
                    {currentQuestion.type === "percent" ? "%" : ""}
                  </span>
                </div>

                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleContinue()}
                  className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-[#C9A84C] px-5 text-base font-semibold text-[#1B2A4A] transition hover:brightness-95 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Continue →"}
                </button>
              </div>
            )}

            {error ? <p className="text-center text-sm font-medium text-red-600">{error}</p> : null}

            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => void handleSkip()}
                className="text-xs font-medium text-[#1B2A4A]/55 underline underline-offset-2"
              >
                Skip this question
              </button>
            </div>
          </div>
        </section>

        <footer className="text-center text-xs text-[#1B2A4A]/55">
          Your responses are saved automatically.
        </footer>
      </div>
    </div>
  );
}
