"use client";
import { useEffect, useState } from "react";
import {
  collection, onSnapshot, orderBy, query,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type Loan = {
  id:             string;
  name:           string;
  type:           "student" | "personal" | "car" | "medical" | "credit_card" | "other";
  subtype:        string;
  balance:        number;
  rate:           number;
  minimumPayment: number;
  assignedTo:     string;
  assignedToName: string;
  notes:          string;
  active:         boolean;
  flagged?:       boolean;
  householdId:    string;
};

export type LoanDraft = Omit<Loan, "id" | "householdId">;

const LOAN_TYPE_LABELS: Record<Loan["type"], string> = {
  student:     "🎓 Student Loan",
  personal:    "👤 Personal Loan",
  car:         "🚗 Car Loan",
  medical:     "🏥 Medical Debt",
  credit_card: "💳 Credit Card",
  other:       "📋 Other",
};

const LOAN_TYPE_COLORS: Record<Loan["type"], string> = {
  student:     "#3B82F6",
  personal:    "#8B5CF6",
  car:         "#F97316",
  medical:     "#EF4444",
  credit_card: "#1B2A4A",
  other:       "#9AA5B4",
};

export { LOAN_TYPE_LABELS, LOAN_TYPE_COLORS };

export function useLoans(householdId?: string) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) {
      setLoans([]);
      setLoading(false);
      return;
    }
    const q = query(
      collection(db, "households", householdId, "loans"),
      orderBy("balance", "asc"),
    );
    const unsubscribe = onSnapshot(q, (snap) => {
      setLoans(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name:           String(data.name ?? ""),
          type:           (data.type as Loan["type"]) ?? "other",
          subtype:        String(data.subtype ?? ""),
          balance:        Number(data.balance ?? 0),
          rate:           Number(data.rate ?? 0),
          minimumPayment: Number(data.minimumPayment ?? 0),
          assignedTo:     String(data.assignedTo ?? ""),
          assignedToName: String(data.assignedToName ?? ""),
          notes:          String(data.notes ?? ""),
          active:         Boolean(data.active ?? true),
          flagged:        Boolean(data.flagged ?? false),
          householdId,
        };
      }));
      setLoading(false);
    });
    return unsubscribe;
  }, [householdId]);

  return { loans, loading };
}
