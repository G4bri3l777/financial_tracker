"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { CATEGORIES } from "@/app/lib/categories";
import { db } from "@/app/lib/firebase";

export type SubcategoryDoc = {
  id: string;
  name: string;
  parentCategory: string;
  createdBy: string;
  createdByName: string;
};

export function useSubcategories(householdId?: string) {
  const { user } = useAuth();
  const [subcategories, setSubcategories] = useState<SubcategoryDoc[]>([]);
  const [loading, setLoading] = useState(false);
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    const loadRole = async () => {
      if (!user) {
        setRole(null);
        return;
      }
      const userSnap = await getDoc(doc(db, "users", user.uid));
      const userRole = userSnap.data()?.role;
      setRole(typeof userRole === "string" ? userRole : null);
    };

    void loadRole();
  }, [user]);

  useEffect(() => {
    if (!householdId) {
      setSubcategories([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const q = query(
      collection(db, "households", householdId, "subcategories"),
      orderBy("name", "asc"),
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const parsed = snapshot.docs.map((docSnap) => {
          const data = docSnap.data();
          return {
            id: docSnap.id,
            name: String(data.name ?? ""),
            parentCategory: String(data.parentCategory ?? "Misc"),
            createdBy: String(data.createdBy ?? ""),
            createdByName: String(data.createdByName ?? "Unknown"),
          } satisfies SubcategoryDoc;
        });
        setSubcategories(parsed);
        setLoading(false);
      },
      () => {
        setSubcategories([]);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [householdId]);

  const subcatsByParent = useMemo(() => {
    const defaultsByParent: Record<string, SubcategoryDoc[]> = {};
    for (const category of CATEGORIES) {
      defaultsByParent[category.name] = category.subcategories.map((name) => ({
        id: `default-${category.name}-${name}`,
        name,
        parentCategory: category.name,
        createdBy: "system",
        createdByName: "Kingdom Wealth",
      }));
    }

    const customByParent: Record<string, SubcategoryDoc[]> = {};
    for (const subcat of subcategories) {
      if (!customByParent[subcat.parentCategory]) {
        customByParent[subcat.parentCategory] = [];
      }
      customByParent[subcat.parentCategory].push(subcat);
    }

    const merged: Record<string, SubcategoryDoc[]> = {};
    const allParents = new Set([
      ...Object.keys(defaultsByParent),
      ...Object.keys(customByParent),
    ]);
    for (const parent of Array.from(allParents)) {
      const defaults = defaultsByParent[parent] ?? [];
      const customs = customByParent[parent] ?? [];
      merged[parent] = [...defaults, ...customs];
    }

    return merged;
  }, [subcategories]);

  const addSubcategory = async (name: string, parentCategory: string) => {
    if (!householdId || !user) return;

    const trimmedName = name.trim();
    if (!trimmedName) return;

    await addDoc(collection(db, "households", householdId, "subcategories"), {
      name: trimmedName,
      parentCategory,
      createdBy: user.uid,
      createdByName: user.displayName || "Member",
      createdAt: serverTimestamp(),
    });
  };

  const deleteSubcategory = async (subcatId: string) => {
    if (!householdId || !user) return;

    const subcatRef = doc(db, "households", householdId, "subcategories", subcatId);
    const subcatSnap = await getDoc(subcatRef);
    const subcatData = subcatSnap.data();
    const createdBy = typeof subcatData?.createdBy === "string" ? subcatData.createdBy : "";

    const canDelete = createdBy === user.uid || role === "admin";
    if (!canDelete) {
      throw new Error("Only the creator or an admin can delete this subcategory.");
    }

    await deleteDoc(subcatRef);
  };

  const renameSubcategory = async (subcatId: string, nextName: string) => {
    if (!householdId || !user) return;

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      throw new Error("Subcategory name cannot be empty.");
    }

    const subcatRef = doc(db, "households", householdId, "subcategories", subcatId);
    const subcatSnap = await getDoc(subcatRef);
    const subcatData = subcatSnap.data();
    const createdBy = typeof subcatData?.createdBy === "string" ? subcatData.createdBy : "";

    const canRename = createdBy === user.uid || role === "admin";
    if (!canRename) {
      throw new Error("Only the creator or an admin can rename this subcategory.");
    }

    await updateDoc(subcatRef, { name: trimmedName });
  };

  return {
    subcategories,
    subcatsByParent,
    addSubcategory,
    deleteSubcategory,
    renameSubcategory,
    loading,
  };
}
