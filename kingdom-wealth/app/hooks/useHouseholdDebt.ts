"use client";

import { useEffect, useMemo, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/firebase";
import type { HouseholdMember } from "./useMembers";

export type DebtAnswers = Record<string, string | number>;

export type LoanSource = "debtAnswers" | "account" | "manual";

export type LoanItem = {
  id: string;
  source: LoanSource;
  ownerUid: string;
  ownerName: string;
  type: "student" | "car" | "medical" | "personal" | "credit";
  name?: string;
  balance: number;
  rate?: number;
  payment?: number;
  notes?: string;
  accountId?: string;
  nickname?: string;
  bankName?: string;
  last4?: string;
  color?: string;
  dueDate?: string;
  creditLimit?: number;
};

function loansFromDebtAnswers(m: HouseholdMember, answers: DebtAnswers): LoanItem[] {
  const items: LoanItem[] = [];
  if (answers.has_student_loans === "yes") {
    const bal = typeof answers.student_balance === "number" ? answers.student_balance : 0;
    items.push({
      id: `${m.uid}_student`,
      source: "debtAnswers",
      ownerUid: m.uid,
      ownerName: m.displayName,
      type: "student",
      name: typeof answers.student_loan_name === "string" ? answers.student_loan_name.trim() || undefined : undefined,
      balance: bal,
      rate: typeof answers.student_rate === "number" ? answers.student_rate : undefined,
      notes: typeof answers.student_loan_notes === "string" ? answers.student_loan_notes : undefined,
    });
  }
  if (answers.has_car_loan === "yes") {
    const bal = typeof answers.car_balance === "number" ? answers.car_balance : 0;
    items.push({
      id: `${m.uid}_car`,
      source: "debtAnswers",
      ownerUid: m.uid,
      ownerName: m.displayName,
      type: "car",
      name: typeof answers.car_loan_name === "string" ? answers.car_loan_name.trim() || undefined : undefined,
      balance: bal,
      payment: typeof answers.car_payment === "number" ? answers.car_payment : undefined,
      notes: typeof answers.car_loan_notes === "string" ? answers.car_loan_notes : undefined,
    });
  }
  if (answers.has_medical_debt === "yes") {
    const bal = typeof answers.medical_balance === "number" ? answers.medical_balance : 0;
    items.push({
      id: `${m.uid}_medical`,
      source: "debtAnswers",
      ownerUid: m.uid,
      ownerName: m.displayName,
      type: "medical",
      name: typeof answers.medical_debt_name === "string" ? answers.medical_debt_name.trim() || undefined : undefined,
      balance: bal,
      notes: typeof answers.medical_debt_notes === "string" ? answers.medical_debt_notes : undefined,
    });
  }
  if (answers.has_personal_loan === "yes") {
    const bal = typeof answers.personal_loan_balance === "number" ? answers.personal_loan_balance : 0;
    items.push({
      id: `${m.uid}_personal`,
      source: "debtAnswers",
      ownerUid: m.uid,
      ownerName: m.displayName,
      type: "personal",
      name: typeof answers.personal_loan_name === "string" ? answers.personal_loan_name.trim() || undefined : undefined,
      balance: bal,
      rate: typeof answers.personal_loan_rate === "number" ? answers.personal_loan_rate : undefined,
      notes: typeof answers.personal_loan_notes === "string" ? answers.personal_loan_notes : undefined,
    });
  }
  return items;
}

export function useHouseholdDebt(
  householdId: string | undefined,
  members: HouseholdMember[],
) {
  const [memberDebtAnswers, setMemberDebtAnswers] = useState<Record<string, DebtAnswers>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId || members.length === 0) {
      setMemberDebtAnswers({});
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubs = members.map((m) =>
      onSnapshot(doc(db, "users", m.uid), (snap) => {
        const data = snap.data();
        const answers = (data?.debtAnswers as DebtAnswers | undefined) ?? {};
        setMemberDebtAnswers((prev) => ({
          ...prev,
          [m.uid]: typeof answers === "object" ? answers : {},
        }));
      }),
    );

    return () => unsubs.forEach((u) => u());
  }, [householdId, members]);

  useEffect(() => {
    setLoading(false);
  }, [memberDebtAnswers]);

  const loans = useMemo(() => {
    const list: LoanItem[] = [];
    for (const m of members) {
      const answers = memberDebtAnswers[m.uid] ?? {};
      list.push(...loansFromDebtAnswers(m, answers));
    }
    return list;
  }, [members, memberDebtAnswers]);

  return {
    loans,
    loading,
    memberDebtAnswers,
  };
}
