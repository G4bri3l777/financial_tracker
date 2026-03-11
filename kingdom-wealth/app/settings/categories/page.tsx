"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/app/hooks/useAuth";
import { useSubcategories } from "@/app/hooks/useSubcategories";
import { CATEGORIES, getCategoryColor } from "@/app/lib/categories";
import { db } from "@/app/lib/firebase";

export default function SettingsCategoriesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [householdId, setHouseholdId] = useState("");
  const [role, setRole] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>(CATEGORIES[0]?.name ?? "");
  const [newSubcatName, setNewSubcatName] = useState("");
  const [editingSubcatId, setEditingSubcatId] = useState("");
  const [editingSubcatName, setEditingSubcatName] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [loadingContext, setLoadingContext] = useState(true);
  const [error, setError] = useState("");

  const { subcategories, addSubcategory, deleteSubcategory, renameSubcategory, loading } =
    useSubcategories(
    householdId || undefined,
    );

  useEffect(() => {
    const loadContext = async () => {
      if (!user) return;

      setLoadingContext(true);
      setError("");
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const userData = userSnap.data();
        if (!userData) throw new Error("Could not load user profile.");

        const hid = typeof userData.householdId === "string" ? userData.householdId : "";
        if (!hid) throw new Error("No household found for your account.");

        setHouseholdId(hid);
        setRole(typeof userData.role === "string" ? userData.role : null);
      } catch (contextError) {
        const message =
          contextError instanceof Error ? contextError.message : "Could not load categories.";
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

  const selectedCategoryMeta = useMemo(
    () => CATEGORIES.find((category) => category.name === selectedCategory),
    [selectedCategory],
  );
  const defaultSubcats = useMemo(
    () => selectedCategoryMeta?.subcategories ?? [],
    [selectedCategoryMeta],
  );
  const customSubcatsForSelected = useMemo(
    () => subcategories.filter((subcat) => subcat.parentCategory === selectedCategory),
    [subcategories, selectedCategory],
  );
  const selectedSubcats = useMemo(
    () => [...defaultSubcats, ...customSubcatsForSelected.map((subcat) => subcat.name)],
    [defaultSubcats, customSubcatsForSelected],
  );

  const handleAddSubcategory = async () => {
    if (!newSubcatName.trim()) return;
    try {
      await addSubcategory(newSubcatName.trim(), selectedCategory);
      setNewSubcatName("");
      setShowAddForm(false);
    } catch (addError) {
      const message =
        addError instanceof Error ? addError.message : "Could not add subcategory.";
      setError(message);
    }
  };

  const handleDeleteSubcategory = async (subcatId: string) => {
    try {
      await deleteSubcategory(subcatId);
    } catch (deleteError) {
      const message =
        deleteError instanceof Error ? deleteError.message : "Could not delete subcategory.";
      setError(message);
    }
  };

  const handleRenameSubcategory = async () => {
    if (!editingSubcatId || !editingSubcatName.trim()) return;
    try {
      await renameSubcategory(editingSubcatId, editingSubcatName.trim());
      setEditingSubcatId("");
      setEditingSubcatName("");
    } catch (renameError) {
      const message =
        renameError instanceof Error ? renameError.message : "Could not rename subcategory.";
      setError(message);
    }
  };

  if (authLoading || loadingContext) {
    return (
      <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:px-6 lg:px-8">
        <div className="mx-auto max-w-6xl">Loading...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-white px-4 py-8 text-[#1B2A4A] md:bg-[#F4F6FA] md:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl bg-white p-5 shadow-md ring-1 ring-[#1B2A4A]/10 md:p-6">
          <h1 className="text-3xl font-bold md:text-4xl">Categories & Subcategories</h1>
          <p className="mt-2 text-sm text-[#1B2A4A]/75">Shared with your household</p>
          <Link
            href="/dashboard"
            className="mt-3 inline-block text-sm font-semibold text-[#1B2A4A]/80 underline underline-offset-2"
          >
            ← Back to Dashboard
          </Link>
        </section>

        {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}

        <section className="grid gap-4 md:grid-cols-3">
          <aside className="rounded-2xl bg-white p-4 shadow-md ring-1 ring-[#1B2A4A]/10 md:col-span-1">
            <h2 className="mb-3 text-sm font-semibold">Parent Categories</h2>
            <div className="flex gap-2 overflow-x-auto pb-2 md:block md:space-y-2 md:overflow-visible">
              {CATEGORIES.map((category) => {
                const count =
                  category.subcategories.length +
                  subcategories.filter((s) => s.parentCategory === category.name).length;
                const selected = selectedCategory === category.name;
                return (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => setSelectedCategory(category.name)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-full px-3 py-2 text-sm md:flex md:w-full md:justify-between md:rounded-xl ${
                      selected
                        ? "bg-[#C9A84C] text-[#1B2A4A]"
                        : "bg-[#F4F6FA] text-[#1B2A4A]/85 hover:bg-[#E9EDF5]"
                    }`}
                    style={{ borderLeft: `4px solid ${getCategoryColor(category.name)}` }}
                  >
                    <span className="text-left">
                      {category.emoji} {category.name}
                    </span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs">{count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="rounded-2xl bg-white p-4 shadow-md ring-1 ring-[#1B2A4A]/10 md:col-span-2">
            <h2 className="text-lg font-semibold">
              {selectedCategoryMeta?.emoji} {selectedCategory}
            </h2>
            <p className="mt-1 text-sm text-[#1B2A4A]/70">
              {selectedCategoryMeta?.description ? `${selectedCategoryMeta.description} • ` : ""}
              {loading ? "Syncing..." : `${selectedSubcats.length} subcategories`}
            </p>

            {selectedSubcats.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-[#1B2A4A]/20 p-4 text-sm text-[#1B2A4A]/75">
                <p>No subcategories yet for {selectedCategory}.</p>
                <p className="mt-1">Be the first to add one →</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {defaultSubcats.map((subcatName) => (
                  <li
                    key={`default-${selectedCategory}-${subcatName}`}
                    className="flex items-center justify-between rounded-xl bg-[#F4F6FA] p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-[#1B2A4A]/75">{subcatName}</p>
                      <p className="text-xs text-[#1B2A4A]/55">Default category set</p>
                    </div>
                    <span className="text-xs font-semibold text-[#1B2A4A]/50">Built-in</span>
                  </li>
                ))}

                {customSubcatsForSelected.map((subcat) => {
                  const canManage = subcat.createdBy === user.uid || role === "admin";
                  return (
                    <li
                      key={subcat.id}
                      className="flex items-center justify-between rounded-xl bg-[#F9FAFC] p-3"
                    >
                      <div>
                        {editingSubcatId === subcat.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={editingSubcatName}
                              onChange={(event) => setEditingSubcatName(event.target.value)}
                              className="h-8 rounded-lg border border-[#1B2A4A]/15 bg-white px-2 text-sm"
                            />
                            <button
                              type="button"
                              onClick={() => void handleRenameSubcategory()}
                              className="text-xs font-semibold text-[#1B2A4A] underline underline-offset-2"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingSubcatId("");
                                setEditingSubcatName("");
                              }}
                              className="text-xs font-semibold text-[#1B2A4A]/70 underline underline-offset-2"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm font-medium">{subcat.name}</p>
                        )}
                        <p className="text-xs text-[#1B2A4A]/65">Created by {subcat.createdByName}</p>
                      </div>
                      {canManage ? (
                        <div className="flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingSubcatId(subcat.id);
                              setEditingSubcatName(subcat.name);
                            }}
                            className="text-xs font-semibold text-[#1B2A4A] underline underline-offset-2"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSubcategory(subcat.id)}
                            className="text-xs font-semibold text-red-600 underline underline-offset-2"
                          >
                            Delete
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-4">
              {!showAddForm ? (
                <button
                  type="button"
                  onClick={() => setShowAddForm(true)}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-[#C9A84C] px-3 text-sm font-semibold text-[#1B2A4A] transition hover:bg-[#FFF8E8]"
                >
                  ➕ Add subcategory
                </button>
              ) : (
                <div className="flex flex-col gap-2 rounded-xl bg-[#FFF8E8] p-3 transition-all">
                  <input
                    value={newSubcatName}
                    onChange={(event) => setNewSubcatName(event.target.value)}
                    placeholder={`Add a ${selectedCategory} subcategory`}
                    className="h-10 rounded-lg border border-[#1B2A4A]/15 bg-white px-3 text-sm"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAddSubcategory()}
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-[#C9A84C] px-3 text-sm font-semibold text-[#1B2A4A]"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowAddForm(false);
                        setNewSubcatName("");
                      }}
                      className="inline-flex h-10 items-center justify-center rounded-lg border border-[#1B2A4A]/20 px-3 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <p className="text-xs text-[#1B2A4A]/55">
          Real-time sync active for {subcategories.length} household subcategories.
        </p>
      </div>
    </div>
  );
}
