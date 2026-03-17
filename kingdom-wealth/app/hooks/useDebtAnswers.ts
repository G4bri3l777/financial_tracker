"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type DebtAnswers = Record<string, string | number>;

export function useDebtAnswers(userId?: string) {
  const [debtAnswers, setDebtAnswers] = useState<DebtAnswers>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setDebtAnswers({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, "users", userId),
      (snap) => {
        const data = snap.data();
        const answers = (data?.debtAnswers as DebtAnswers | undefined) ?? {};
        setDebtAnswers(typeof answers === "object" ? answers : {});
        setLoading(false);
      },
      () => {
        setDebtAnswers({});
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [userId]);

  const updateDebtAnswers = async (patch: Partial<DebtAnswers>) => {
    if (!userId) return;
    const merged: DebtAnswers = {};
    for (const [k, v] of Object.entries({ ...debtAnswers, ...patch })) {
      if (v !== undefined && v !== null) merged[k] = v as string | number;
    }
    await updateDoc(doc(db, "users", userId), { debtAnswers: merged });
    setDebtAnswers(merged);
  };

  // Student loan helpers
  const hasStudentLoans = debtAnswers.has_student_loans === "yes";
  const studentBalance = hasStudentLoans && typeof debtAnswers.student_balance === "number"
    ? debtAnswers.student_balance
    : 0;
  const studentRate = hasStudentLoans && typeof debtAnswers.student_rate === "number"
    ? debtAnswers.student_rate
    : 0;
  const studentNotes = typeof debtAnswers.student_loan_notes === "string"
    ? debtAnswers.student_loan_notes
    : "";

  return {
    debtAnswers,
    loading,
    updateDebtAnswers,
    hasStudentLoans,
    studentBalance,
    studentRate,
    studentNotes,
  };
}
