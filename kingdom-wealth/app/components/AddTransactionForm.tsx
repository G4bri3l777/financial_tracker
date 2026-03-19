"use client";

import { useEffect, useRef, useState } from "react";
import {
  addDoc,
  collection,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";
import type { User } from "firebase/auth";
import type { HouseholdAccount } from "@/app/hooks/useAccounts";
import type { HouseholdMember } from "@/app/hooks/useMembers";
import type { SubcategoryDoc } from "@/app/hooks/useSubcategories";
import { CATEGORIES } from "@/app/lib/categories";
import { db, storage } from "@/app/lib/firebase";

export type AddTransactionFormType = "income" | "expense" | "transfer" | "refund";

export type AddTransactionFormState = {
  date: string;
  desc: string;
  amount: string;
  type: AddTransactionFormType;
  category: string;
  subcat: string;
  accountId: string;
  assignedTo: string;
  comment: string;
  isCash: boolean;
  cashReason: string;
  receiptFile: File | null;
  transferFromAccountId: string;
  transferToAccountId: string;
};

function toYmd(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);

export function defaultAddTransactionForm(assignedTo = ""): AddTransactionFormState {
  return {
    date: toYmd(),
    desc: "",
    amount: "",
    type: "expense",
    category: "",
    subcat: "",
    accountId: "",
    assignedTo,
    comment: "",
    isCash: false,
    cashReason: "",
    receiptFile: null,
    transferFromAccountId: "",
    transferToAccountId: "",
  };
}

export type AddTransactionFormResult = {
  success: boolean;
  message: string;
};

type AddTransactionFormProps = {
  householdId: string;
  user: User;
  accounts: HouseholdAccount[];
  members: HouseholdMember[];
  subcatsByParent: Record<string, SubcategoryDoc[]>;
  defaultAssignedTo?: string;
  onSaved: (result: AddTransactionFormResult) => void;
  onCancel: () => void;
};

export default function AddTransactionForm({
  householdId,
  user,
  accounts,
  members,
  subcatsByParent,
  defaultAssignedTo = "",
  onSaved,
  onCancel,
}: AddTransactionFormProps) {
  const [form, setForm] = useState<AddTransactionFormState>(
    () => defaultAddTransactionForm(defaultAssignedTo || user.uid)
  );
  const [saving, setSaving] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [dropdownOpen, setDropdownOpen] = useState<null | "type" | "account" | "transferFrom" | "transferTo">(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!form.assignedTo && (defaultAssignedTo || user.uid)) {
      setForm((p) => ({ ...p, assignedTo: defaultAssignedTo || user.uid }));
    }
  }, [form.assignedTo, defaultAssignedTo, user?.uid]);

  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  async function uploadReceipt(file: File, txId: string): Promise<string> {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `households/${householdId}/receipts/${txId}.${ext}`;
    const fileRef = storageRef(storage, path);
    setUploadPct(10);
    await uploadBytes(fileRef, file);
    setUploadPct(80);
    const url = await getDownloadURL(fileRef);
    setUploadPct(100);
    setTimeout(() => setUploadPct(0), 1000);
    return url;
  }

  async function saveTransaction() {
    if (!householdId || !user) return;
    const amount = Math.abs(parseFloat(form.amount || "0"));
    if (!form.date || !form.desc.trim() || !(amount > 0)) {
      onSaved({ success: false, message: "Date, merchant, and amount are required." });
      return;
    }

    if (form.type === "transfer") {
      if (!form.transferFromAccountId || !form.transferToAccountId) {
        onSaved({ success: false, message: "Please select both FROM and TO accounts for a transfer." });
        return;
      }
      if (form.transferFromAccountId === form.transferToAccountId) {
        onSaved({ success: false, message: "FROM and TO accounts must be different." });
        return;
      }
    }

    setSaving(true);
    try {
      const mem = members.find((m) => m.uid === form.assignedTo);
      const assignedToName =
        mem?.firstName || mem?.displayName || user.displayName || "Member";

      const pairId =
        form.type === "transfer"
          ? `pair_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
          : null;

      const basePayload = {
        date: form.date,
        month: form.date.slice(0, 7),
        desc: form.desc.trim(),
        merchantName: form.desc.trim(),
        amount,
        type: form.type,
        category: form.category || null,
        subcat: form.subcat || null,
        assignedTo: form.assignedTo || user.uid,
        assignedToName,
        comment: form.comment.trim() || null,
        isCash: form.isCash,
        cashReason: form.isCash ? form.cashReason.trim() : null,
        reviewed: false,
        flagged: false,
        addedManually: true,
        createdAt: serverTimestamp(),
      };

      if (form.type !== "transfer") {
        const acc = form.accountId ? accounts.find((a) => a.id === form.accountId) : null;
        const direction =
          form.type === "income" || form.type === "refund" ? "credit" : "debit";
        const docRef = await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction,
            accountId: acc?.id ?? null,
            accountLabel: acc ? `${acc.bankName} ••${acc.last4}` : null,
          }
        );
        if (form.receiptFile) {
          const url = await uploadReceipt(form.receiptFile, docRef.id);
          await updateDoc(docRef, { receiptUrl: url });
        }
      } else {
        const fromId =
          form.transferFromAccountId === "__external__"
            ? null
            : form.transferFromAccountId;
        const toId =
          form.transferToAccountId === "__external__"
            ? null
            : form.transferToAccountId;

        const fromAcc = fromId ? accounts.find((a) => a.id === fromId) : null;
        const toAcc = toId ? accounts.find((a) => a.id === toId) : null;

        const isCardPayment = toAcc?.type === "credit";
        const transferType = isCardPayment
          ? "card-payment"
          : fromId && toId
            ? "internal"
            : fromId
              ? "external-own"
              : "external-third-party";

        const debitRef = await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction: "debit",
            accountId: fromId,
            accountLabel: fromAcc ? `${fromAcc.bankName} ••${fromAcc.last4}` : "External",
            transferPairId: pairId,
            transferType,
            transferFromAccountId: fromId,
            transferToAccountId: toId,
          }
        );

        await addDoc(
          collection(db, "households", householdId, "transactions"),
          {
            ...basePayload,
            direction: "credit",
            accountId: toId,
            accountLabel: toAcc ? `${toAcc.bankName} ••${toAcc.last4}` : "External",
            transferPairId: pairId,
            transferType,
            transferFromAccountId: fromId,
            transferToAccountId: toId,
          }
        );

        if (form.receiptFile) {
          const url = await uploadReceipt(form.receiptFile, debitRef.id);
          await updateDoc(debitRef, { receiptUrl: url });
        }
      }

      onSaved({ success: true, message: `✅ ${form.desc.trim()} — ${fmt(amount)} saved` });
    } catch (e) {
      onSaved({ success: false, message: "Error: " + (e instanceof Error ? e.message : "unknown") });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={dropdownRef} className="space-y-4">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Date
          </label>
          <input
            type="date"
            value={form.date}
            onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
            className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Merchant / Description
          </label>
          <input
            type="text"
            value={form.desc}
            onChange={(e) => setForm((p) => ({ ...p, desc: e.target.value }))}
            placeholder="e.g. Wegmans, Amazon"
            className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[#9AA5B4]">
              $
            </span>
            <input
              type="number"
              min={0}
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
              placeholder="0.00"
              className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white pl-6 pr-3 text-sm focus:border-[#C9A84C] focus:outline-none"
            />
          </div>
        </div>
        <div className="relative">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Type
          </label>
          <button
            type="button"
            onClick={() =>
              setDropdownOpen((d) => (d === "type" ? null : "type"))
            }
            className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
          >
            <span className="capitalize">{form.type || "— Select"}</span>
            <span className="text-[10px] text-[#9AA5B4]">
              {dropdownOpen === "type" ? "▲" : "▾"}
            </span>
          </button>
          {dropdownOpen === "type" && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
              {(["expense", "income", "transfer", "refund"] as const).map(
                (t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setForm((p) => ({
                        ...p,
                        type: t,
                        category: "",
                        transferFromAccountId: "",
                        transferToAccountId: "",
                      }));
                      setDropdownOpen(null);
                    }}
                    className={`flex w-full items-center px-3 py-2 text-left text-sm capitalize ${
                      form.type === t
                        ? "bg-[#C9A84C]/15 font-semibold text-[#1B2A4A]"
                        : "text-[#1B2A4A] hover:bg-[#F9FAFC]"
                    }`}
                  >
                    {t}
                  </button>
                )
              )}
            </div>
          )}
        </div>
        {form.type !== "transfer" && (
          <div>
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
              Category
            </label>
            <select
              value={form.category}
              onChange={(e) =>
                setForm((p) => ({ ...p, category: e.target.value, subcat: "" }))
              }
              className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
            >
              <option value="">— Select</option>
              {CATEGORIES.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.emoji} {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {form.category &&
          (subcatsByParent[form.category] ?? []).length > 0 && (
            <div>
              <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                Subcategory
              </label>
              <select
                value={form.subcat}
                onChange={(e) =>
                  setForm((p) => ({ ...p, subcat: e.target.value }))
                }
                className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
              >
                <option value="">— Select</option>
                {(subcatsByParent[form.category] ?? []).map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        {form.type !== "transfer" && (
          <div className="relative">
            <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
              Account / Card
            </label>
            <button
              type="button"
              onClick={() =>
                setDropdownOpen((d) =>
                  d === "account" ? null : "account"
                )
              }
              className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
            >
              {form.accountId ? (
                <span className="flex items-center gap-1.5">
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{
                      backgroundColor:
                        accounts.find((a) => a.id === form.accountId)?.color ??
                        "#9AA5B4",
                    }}
                  />
                  {accounts.find((a) => a.id === form.accountId)?.nickname} ••
                  {accounts.find((a) => a.id === form.accountId)?.last4}
                </span>
              ) : (
                <span className="text-[#9AA5B4]">— Select</span>
              )}
              <span className="text-[10px] text-[#9AA5B4]">
                {dropdownOpen === "account" ? "▲" : "▾"}
              </span>
            </button>
            {dropdownOpen === "account" && (
              <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                {accounts.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setForm((p) => ({ ...p, accountId: a.id }));
                      setDropdownOpen(null);
                    }}
                    className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                      form.accountId === a.id
                        ? "bg-[#C9A84C]/15 font-semibold text-[#1B2A4A]"
                        : "text-[#1B2A4A] hover:bg-[#F9FAFC]"
                    }`}
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: a.color ?? "#9AA5B4" }}
                    />
                    {a.nickname}
                    <span className="text-[9px] opacity-60">
                      ••{a.last4}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {form.type === "transfer" && (
          <div className="col-span-2 sm:col-span-3 space-y-3">
            <div className="rounded-2xl border border-[#E4E8F0] bg-[#F9FAFC] p-4">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
                Transfer Direction
              </p>
              <div className="relative mb-3">
                <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-orange-500">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-orange-100 text-orange-600 text-[9px] font-black">
                    ↑
                  </span>
                  From (money leaves)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDropdownOpen((d) =>
                      d === "transferFrom" ? null : "transferFrom"
                    )
                  }
                  className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                >
                  {form.transferFromAccountId ? (
                    form.transferFromAccountId === "__external__" ? (
                      <span className="text-[#1B2A4A]">External</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              accounts.find(
                                (a) => a.id === form.transferFromAccountId
                              )?.color ?? "#9AA5B4",
                          }}
                        />
                        {accounts.find(
                          (a) => a.id === form.transferFromAccountId
                        )?.nickname}{" "}
                        ••
                        {accounts.find(
                          (a) => a.id === form.transferFromAccountId
                        )?.last4}
                      </span>
                    )
                  ) : (
                    <span className="text-[#9AA5B4]">— Select</span>
                  )}
                  <span className="text-[10px] text-[#9AA5B4]">
                    {dropdownOpen === "transferFrom" ? "▲" : "▾"}
                  </span>
                </button>
                {dropdownOpen === "transferFrom" && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setForm((p) => ({
                            ...p,
                            transferFromAccountId: a.id,
                            accountId: a.id,
                          }));
                          setDropdownOpen(null);
                        }}
                        className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                          form.transferFromAccountId === a.id
                            ? "bg-[#C9A84C]/15 font-semibold"
                            : "hover:bg-[#F9FAFC]"
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: a.color ?? "#9AA5B4" }}
                        />
                        {a.nickname}
                        <span className="text-[10px] opacity-60">
                          ••{a.last4}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setForm((p) => ({
                          ...p,
                          transferFromAccountId: "__external__",
                        }));
                        setDropdownOpen(null);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                        form.transferFromAccountId === "__external__"
                          ? "bg-[#C9A84C]/15 font-semibold"
                          : "hover:bg-[#F9FAFC]"
                      }`}
                    >
                      External
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <label className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-green-600">
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-100 text-green-600 text-[9px] font-black">
                    ↓
                  </span>
                  To (money arrives)
                </label>
                <button
                  type="button"
                  onClick={() =>
                    setDropdownOpen((d) =>
                      d === "transferTo" ? null : "transferTo"
                    )
                  }
                  className="flex h-9 w-full items-center justify-between rounded-xl border border-[#E4E8F0] bg-white px-3 text-left text-sm focus:border-[#C9A84C] focus:outline-none"
                >
                  {form.transferToAccountId ? (
                    form.transferToAccountId === "__external__" ? (
                      <span className="text-[#1B2A4A]">External</span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <span
                          className="h-2 w-2 rounded-full shrink-0"
                          style={{
                            backgroundColor:
                              accounts.find(
                                (a) => a.id === form.transferToAccountId
                              )?.color ?? "#9AA5B4",
                          }}
                        />
                        {accounts.find(
                          (a) => a.id === form.transferToAccountId
                        )?.nickname}{" "}
                        ••
                        {accounts.find(
                          (a) => a.id === form.transferToAccountId
                        )?.last4}
                      </span>
                    )
                  ) : (
                    <span className="text-[#9AA5B4]">— Select</span>
                  )}
                  <span className="text-[10px] text-[#9AA5B4]">
                    {dropdownOpen === "transferTo" ? "▲" : "▾"}
                  </span>
                </button>
                {dropdownOpen === "transferTo" && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-48 overflow-auto rounded-xl border border-[#E4E8F0] bg-white py-1 shadow-lg">
                    {accounts.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => {
                          setForm((p) => ({
                            ...p,
                            transferToAccountId: a.id,
                          }));
                          setDropdownOpen(null);
                        }}
                        className={`flex w-full items-center gap-1.5 px-3 py-2 text-left text-sm ${
                          form.transferToAccountId === a.id
                            ? "bg-[#C9A84C]/15 font-semibold"
                            : "hover:bg-[#F9FAFC]"
                        }`}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: a.color ?? "#9AA5B4" }}
                        />
                        {a.nickname}
                        <span className="text-[10px] opacity-60">
                          ••{a.last4}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setForm((p) => ({
                          ...p,
                          transferToAccountId: "__external__",
                        }));
                        setDropdownOpen(null);
                      }}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm ${
                        form.transferToAccountId === "__external__"
                          ? "bg-[#C9A84C]/15 font-semibold"
                          : "hover:bg-[#F9FAFC]"
                      }`}
                    >
                      External
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div>
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Person
          </label>
          <div className="flex flex-wrap gap-1">
            {members.map((m) => (
              <button
                key={m.uid}
                type="button"
                onClick={() =>
                  setForm((p) => ({ ...p, assignedTo: m.uid }))
                }
                className={`rounded-xl border px-3 py-1.5 text-xs font-semibold ${
                  form.assignedTo === m.uid
                    ? "border-[#1B2A4A] bg-[#1B2A4A] text-white"
                    : "border-[#E4E8F0] bg-white text-[#1B2A4A]"
                }`}
              >
                {m.firstName || m.displayName}
              </button>
            ))}
          </div>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Comment
          </label>
          <input
            type="text"
            value={form.comment}
            onChange={(e) =>
              setForm((p) => ({ ...p, comment: e.target.value }))
            }
            placeholder="Optional note..."
            className="h-9 w-full rounded-xl border border-[#E4E8F0] bg-white px-3 text-sm focus:border-[#C9A84C] focus:outline-none"
          />
        </div>
        <div className="col-span-2 sm:col-span-3">
          <label
            className="flex cursor-pointer items-center gap-2"
            onClick={() => setForm((p) => ({ ...p, isCash: !p.isCash }))}
          >
            <div
              className={`relative h-5 w-9 rounded-full transition-colors ${
                form.isCash ? "bg-[#C9A84C]" : "bg-[#E4E8F0]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  form.isCash ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </div>
            <span className="text-xs font-semibold text-[#1B2A4A]">
              This was a cash expense
            </span>
          </label>
          {form.isCash && (
            <input
              type="text"
              value={form.cashReason}
              onChange={(e) =>
                setForm((p) => ({ ...p, cashReason: e.target.value }))
              }
              placeholder="Why cash? (e.g. vendor only accepts cash)"
              className="mt-2 h-9 w-full rounded-xl border border-amber-200 bg-amber-50 px-3 text-sm focus:border-amber-400 focus:outline-none"
            />
          )}
        </div>
        <div className="col-span-2 sm:col-span-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-[#9AA5B4]">
            Receipt Photo (optional)
          </label>
          <div className="flex items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-[#C9A84C] bg-[#FFFBF0] px-4 py-2.5 text-xs font-semibold text-[#C9A84C] hover:bg-[#FFF8E8]">
              📷 {form.receiptFile ? form.receiptFile.name : "Attach receipt"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    receiptFile: e.target.files?.[0] ?? null,
                  }))
                }
              />
            </label>
            {form.receiptFile && (
              <>
                <img
                  src={URL.createObjectURL(form.receiptFile)}
                  alt="Receipt preview"
                  className="h-12 w-12 rounded-lg border border-[#E4E8F0] object-cover"
                />
                <button
                  type="button"
                  onClick={() =>
                    setForm((p) => ({ ...p, receiptFile: null }))
                  }
                  className="text-xs text-[#9AA5B4] hover:text-red-400"
                >
                  ✕ Remove
                </button>
              </>
            )}
          </div>
          {uploadPct > 0 && uploadPct < 100 && (
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#F4F6FA]">
              <div
                className="h-1.5 rounded-full bg-[#C9A84C] transition-all"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveTransaction()}
          className="rounded-xl bg-[#C9A84C] px-6 py-2.5 text-sm font-bold text-[#1B2A4A] disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Transaction"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-xl border border-[#E4E8F0] px-4 py-2.5 text-sm font-semibold text-[#9AA5B4]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
