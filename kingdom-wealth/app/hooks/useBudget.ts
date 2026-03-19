"use client";

import { useEffect, useState } from "react";
import {
  collection, onSnapshot, query,
  where, orderBy, limit,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type BudgetStatus = "draft" | "pending_approval" | "approved";

export type Budget = {
  id:            string;
  version:       number;
  month:         string;
  income:        number;
  // Flat key format: "Category" or "Category:Subcategory"
  categories:    Record<string, number>;
  historicalAvg: Record<string, number>;
  drGuidelines:  Record<string, number>;
  comments:      Record<string, string>;
  owners:        Record<string, string>;  // category key -> uid or "joint"
  status:        BudgetStatus;
  proposedBy:    string;
  proposedAt:    unknown;
  approvedBy:    string[];
  approvedAt:    unknown;
  createdAt:     unknown;
  updatedAt:     unknown;
};

// Load budget for a specific month
export function useBudget(householdId?: string, month?: string) {
  const [budget,  setBudget]  = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId) { setLoading(false); return; }

    let q;
    if (month) {
      // Specific month
      q = query(
        collection(db, "households", householdId, "budgets"),
        where("month", "==", month),
        limit(1),
      );
    } else {
      // Latest budget
      q = query(
        collection(db, "households", householdId, "budgets"),
        orderBy("createdAt", "desc"),
        limit(1),
      );
    }

    return onSnapshot(q, snap => {
      if (snap.empty) setBudget(null);
      else {
        const d = snap.docs[0];
        setBudget({ id: d.id, ...d.data() } as Budget);
      }
      setLoading(false);
    });
  }, [householdId, month]);

  return { budget, loading };
}

// Load the most recent budget before a given month (for structure template)
export function useTemplateBudget(householdId?: string, beforeMonth?: string) {
  const [budget,  setBudget]  = useState<Budget | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!householdId || !beforeMonth) { setLoading(false); return; }
    const q = query(
      collection(db, "households", householdId, "budgets"),
      where("month", "<", beforeMonth),
      orderBy("month", "desc"),
      limit(1),
    );
    return onSnapshot(q, snap => {
      setBudget(snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() } as Budget);
      setLoading(false);
    });
  }, [householdId, beforeMonth]);

  return { budget, loading };
}
