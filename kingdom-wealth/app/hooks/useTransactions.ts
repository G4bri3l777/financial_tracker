"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type HouseholdTransaction = {
  id: string;
  date: string;
  desc: string;
  amount: number;
  type: "income" | "expense" | "transfer" | "refund";
  category: string;
  subcat: string;
  account: string;
};

export function useTransactions(householdId?: string) {
  const [transactions, setTransactions] = useState<HouseholdTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!householdId) {
      setTransactions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(collection(db, "households", householdId, "transactions"), orderBy("date", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const parsed = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            date: String(data.date ?? ""),
            desc: String(data.desc ?? "Unknown"),
            amount: Math.abs(Number(data.amount ?? 0)),
            type: (data.type as HouseholdTransaction["type"] | undefined) ?? "expense",
            category: String(data.category ?? "Misc"),
            subcat: String(data.subcat ?? ""),
            account: String(data.account ?? "Unknown"),
          } satisfies HouseholdTransaction;
        });
        setTransactions(parsed);
        setLoading(false);
      },
      () => {
        setTransactions([]);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [householdId]);

  return { transactions, loading };
}
