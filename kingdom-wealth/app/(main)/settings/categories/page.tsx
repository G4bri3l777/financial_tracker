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
    useSubcategories(householdId || undefined);

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
        const message = contextError instanceof Error ? contextError.message : "Could not load categories.";
        setError(message);
      } finally {
        setLoadingContext(false);
      }
    };
    if (!authLoading && !user) {
      router.replace("/login");
      return;
    }
    if (!authLoading && user) void loadContext();
  }, [authLoading, user, router]);

  const selectedCategoryMeta = useMemo(() => CATEGORIES.find((c) => c.name === selectedCategory), [selectedCategory]);
  const defaultSubcats = useMemo(() => selectedCategoryMeta?.subcategories ?? [], [selectedCategoryMeta]);
  const customSubcatsForSelected = useMemo(() => subcategories.filter((s) => s.parentCategory === selectedCategory), [subcategories, selectedCategory]);
  const selectedSubcats = useMemo(() => [...defaultSubcats, ...customSubcatsForSelected.map((s) => s.name)], [defaultSubcats, customSubcatsForSelected]);

  const handleAddSubcategory = async () => {
    if (!newSubcatName.trim()) return;
    try {
      await addSubcategory(newSubcatName.trim(), selectedCategory);
      setNewSubcatName("");
      setShowAddForm(false);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : "Could not add subcategory.");
    }
  };

  const handleDeleteSubcategory = async (subcatId: string) => {
    try {
      await deleteSubcategory(subcatId);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete subcategory.");
    }
  };

  const handleRenameSubcategory = async () => {
    if (!editingSubcatId || !editingSubcatName.trim()) return;
    try {
      await renameSubcategory(editingSubcatId, editingSubcatName.trim());
      setEditingSubcatId("");
      setEditingSubcatName("");
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "Could not rename subcategory.");
    }
  };

  if (authLoading || loadingContext) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#F4F6FA]">
        <p className="text-sm text-[#1B2A4A]/40">Loading...</p>
      </div>
    );
  }
  if (!user) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#F4F6FA] text-[#1B2A4A]">
      {/* Header */}
      <div className="shrink-0 border-b border-[#E4E8F0] bg-white px-6 py-4">
        <div className="mx-auto flex max-w-4xl items-center gap-3">
          <Link href="/settings" className="text-xs text-[#9AA5B4] hover:text-[#1B2A4A]">← Settings</Link>
          <span className="text-[#E4E8F0]">/</span>
          <h1 className="text-xl font-bold text-[#1B2A4A]">Categories</h1>
        </div>
        <p className="mx-auto mt-1 max-w-4xl text-xs text-[#9AA5B4]">
          Edit spending categories. Shared with your household.
        </p>
      </div>

      <div className="mx-auto max-w-4xl flex-1 space-y-5 px-6 py-6">

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        <section className="grid gap-4 md:grid-cols-3">
          <aside className="rounded-2xl border border-[#E4E8F0] bg-white p-5 md:col-span-1">
            <h2 className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
              Parent Categories
            </h2>
            <div className="flex gap-2 overflow-x-auto pb-2 md:block md:space-y-2 md:overflow-visible">
              {CATEGORIES.map((category) => {
                const count = category.subcategories.length + subcategories.filter((s) => s.parentCategory === category.name).length;
                const selected = selectedCategory === category.name;
                return (
                  <button
                    key={category.name}
                    type="button"
                    onClick={() => setSelectedCategory(category.name)}
                    className={`inline-flex shrink-0 w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm md:flex ${
                      selected ? "bg-[#C9A84C] font-bold text-[#1B2A4A]" : "bg-[#F4F6FA] font-semibold text-[#1B2A4A]/85 hover:bg-[#E9EDF5]"
                    }`}
                    style={{ borderLeftWidth: 4, borderLeftStyle: "solid", borderLeftColor: getCategoryColor(category.name) }}
                  >
                    <span className="text-left">{category.emoji} {category.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${selected ? "bg-white/70 text-[#1B2A4A]" : "bg-[#E4E8F0]/80 text-[#9AA5B4]"}`}>{count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="rounded-2xl border border-[#E4E8F0] bg-white p-6 md:col-span-2">
            <h2 className="text-sm font-bold text-[#1B2A4A]">
              {selectedCategoryMeta?.emoji} {selectedCategory}
            </h2>
            <p className="mt-1 text-[10px] text-[#9AA5B4]">
              {selectedCategoryMeta?.description ? `${selectedCategoryMeta.description} • ` : ""}
              {loading ? "Syncing..." : `${selectedSubcats.length} subcategories`}
            </p>

            {selectedSubcats.length === 0 ? (
              <div className="mt-4 rounded-xl border-2 border-dashed border-[#E4E8F0] bg-[#F9FAFC] p-6 text-center">
                <p className="text-sm font-semibold text-[#1B2A4A]">No subcategories yet for {selectedCategory}.</p>
                <p className="mt-1 text-[10px] text-[#9AA5B4]">Be the first to add one</p>
              </div>
            ) : (
              <ul className="mt-4 space-y-2">
                {defaultSubcats.map((subcatName) => (
                  <li
                    key={`default-${selectedCategory}-${subcatName}`}
                    className="flex items-center justify-between rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] p-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-[#1B2A4A]">{subcatName}</p>
                      <p className="text-[10px] text-[#9AA5B4]">Default category set</p>
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#9AA5B4]">Built-in</span>
                  </li>
                ))}
                {customSubcatsForSelected.map((subcat) => {
                  const canManage = subcat.createdBy === user.uid || role === "admin";
                  return (
                    <li
                      key={subcat.id}
                      className="flex items-center justify-between rounded-xl border border-[#E4E8F0] bg-[#F9FAFC] p-3"
                    >
                      <div>
                        {editingSubcatId === subcat.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={editingSubcatName}
                              onChange={(e) => setEditingSubcatName(e.target.value)}
                              className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() => void handleRenameSubcategory()}
                              className="rounded-xl bg-[#C9A84C] px-3 py-1.5 text-xs font-bold text-[#1B2A4A]"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => { setEditingSubcatId(""); setEditingSubcatName(""); }}
                              className="rounded-xl border border-[#E4E8F0] px-3 py-1.5 text-xs font-semibold text-[#9AA5B4]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm font-semibold text-[#1B2A4A]">{subcat.name}</p>
                        )}
                        <p className="text-[10px] text-[#9AA5B4]">Created by {subcat.createdByName}</p>
                      </div>
                      {canManage && editingSubcatId !== subcat.id ? (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => { setEditingSubcatId(subcat.id); setEditingSubcatName(subcat.name); }}
                            className="rounded-xl border border-[#E4E8F0] bg-white px-3 py-1.5 text-xs font-semibold text-[#1B2A4A] hover:bg-[#F4F6FA]"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleDeleteSubcategory(subcat.id)}
                            className="rounded-xl border border-red-100 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
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
                  className="rounded-xl border border-[#C9A84C] bg-white px-4 py-2.5 text-sm font-bold text-[#1B2A4A] hover:bg-[#FFF8E8]"
                >
                  + Add subcategory
                </button>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-[#C9A84C] bg-[#FFF8E8] p-4">
                  <input
                    value={newSubcatName}
                    onChange={(e) => setNewSubcatName(e.target.value)}
                    placeholder={`Add a ${selectedCategory} subcategory`}
                    className="h-10 rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleAddSubcategory()}
                      className="rounded-xl bg-[#C9A84C] px-4 py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowAddForm(false); setNewSubcatName(""); }}
                      className="rounded-xl border border-[#E4E8F0] px-4 py-2.5 text-sm font-semibold text-[#9AA5B4] hover:bg-[#F4F6FA]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        <p className="text-[10px] text-[#9AA5B4]">
          Real-time sync active for {subcategories.length} household subcategories.
        </p>
      </div>
    </div>
  );
}
