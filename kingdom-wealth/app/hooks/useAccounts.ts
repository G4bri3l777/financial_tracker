"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type AccountType = "credit" | "debit" | "checking" | "savings" | "cash";
export type AccountSubtype =
  | "checking"
  | "savings"
  | "growth"
  | "emergency"
  | "investment"
  | "other"
  | "";

export type HouseholdAccount = {
  id: string;
  nickname: string;
  bankName: string;
  last4: string;
  cardLast4?: string;
  type: AccountType;
  subtype: AccountSubtype;
  owner: string;
  ownerName: string;
  color: string;
  householdId: string;
  creditLimit: number;
  dueDate?: string;
};

export function useAccounts(householdId?: string) {
  const [accounts, setAccounts] = useState<HouseholdAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) {
      setAccounts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsub = onSnapshot(
      collection(db, "households", householdId, "accounts"),
      (snap) => {
        setAccounts(
          snap.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              nickname: String(data.nickname ?? ""),
              bankName: String(data.bankName ?? ""),
              last4: String(data.last4 ?? ""),
              cardLast4: data.cardLast4 ? String(data.cardLast4) : undefined,
              type: (data.type as AccountType | undefined) ?? "credit",
              subtype: (data.subtype as AccountSubtype | undefined) ?? "",
              owner: String(data.owner ?? ""),
              ownerName: String(data.ownerName ?? "Unknown"),
              color: String(data.color ?? "#C9A84C"),
              householdId: String(data.householdId ?? householdId),
              creditLimit: Number(data.creditLimit ?? 0),
              dueDate: data.dueDate ? String(data.dueDate) : undefined,
            } satisfies HouseholdAccount;
          }),
        );
        setLoading(false);
      },
      () => {
        setAccounts([]);
        setLoading(false);
      },
    );

    return unsub;
  }, [householdId]);

  return { accounts, loading };
}
