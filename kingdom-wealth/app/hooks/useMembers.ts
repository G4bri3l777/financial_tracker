"use client";

import { useEffect, useState } from "react";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "@/app/lib/firebase";

export type HouseholdMember = {
  uid: string;
  firstName: string;
  lastName: string;
  displayName: string;
};

export function useMembers(householdId?: string) {
  const [members, setMembers] = useState<HouseholdMember[]>([]);

  useEffect(() => {
    if (!householdId) {
      setMembers([]);
      return;
    }

    const householdRef = doc(db, "households", householdId);
    const unsubscribe = onSnapshot(
      householdRef,
      async (householdSnap) => {
        const memberIds = (householdSnap.data()?.members ?? []) as string[];
        if (!Array.isArray(memberIds) || memberIds.length === 0) {
          setMembers([]);
          return;
        }

        const memberDocs = await Promise.all(
          memberIds.map((uid) => getDoc(doc(db, "users", uid))),
        );

        const parsedMembers = memberDocs.map((memberSnap, index) => {
          const uid = memberIds[index];
          const data = memberSnap.data() ?? {};
          const firstName = typeof data.firstName === "string" ? data.firstName : "";
          const lastName = typeof data.lastName === "string" ? data.lastName : "";
          const displayName =
            typeof data.displayName === "string"
              ? data.displayName
              : [firstName, lastName].filter(Boolean).join(" ").trim();

          return {
            uid,
            firstName,
            lastName,
            displayName: displayName || "Member",
          };
        });

        setMembers(parsedMembers);
      },
      () => {
        setMembers([]);
      },
    );

    return unsubscribe;
  }, [householdId]);

  return members;
}
