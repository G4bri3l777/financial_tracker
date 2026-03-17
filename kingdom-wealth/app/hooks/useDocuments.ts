"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
} from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type HouseholdDocument = {
  id: string;
  uploadedBy?: string;
  uploadedByName?: string;
  fileName?: string;
  storagePath?: string;
  downloadURL?: string;
  status?: string;
  transactionCount?: number;
  error?: string | null;
  statementStart?: string;
  statementEnd?: string;
  accountDocId?: string;
  parserNotes?: string;
  bankName?: string;
  accountLast4?: string;
  openingBalance?: number | null;
  closingBalance?: number | null;
} & DocumentData;

export function useDocuments(householdId?: string) {
  const [documents, setDocuments] = useState<HouseholdDocument[]>([]);

  useEffect(() => {
    if (!householdId) {
      setDocuments([]);
      return;
    }

    const q = query(
      collection(db, "households", householdId, "documents"),
      orderBy("uploadedAt", "desc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setDocuments(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
        );
      },
      () => {
        setDocuments([]);
      },
    );

    return unsubscribe;
  }, [householdId]);

  return documents;
}
