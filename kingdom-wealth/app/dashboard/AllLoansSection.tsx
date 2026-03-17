"use client";

import { useMemo, useState } from "react";
import { doc, getDoc, writeBatch, updateDoc } from "firebase/firestore";
import { db } from "@/app/lib/firebase";
import type { LoanItem, DebtAnswers } from "@/app/hooks/useHouseholdDebt";
import { getSubcategoriesByParent } from "@/app/lib/categories";

type Tx = { id: string; date: string; desc: string; merchantName: string; amount: number; category: string; subcat: string; type: string; direction: string };

const fmtFull = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const LOAN_TO_SUBCAT: Record<LoanItem["type"], string> = {
  student: "Student Loan",
  car: "Car Loan",
  medical: "Medical Debt",
  personal: "Personal Loan",
  credit: "Credit Card",
};

const LOAN_LABELS: Record<LoanItem["type"], string> = {
  student: "Student Loan",
  car: "Car Loan",
  medical: "Medical Debt",
  personal: "Personal Loan",
  credit: "Credit Card",
};

const LOAN_EMOJI: Record<LoanItem["type"], string> = {
  student: "🎓",
  car: "🚗",
  medical: "🏥",
  personal: "📋",
  credit: "💳",
};

function getSubcatForLoan(loan: LoanItem): string {
  const name = loan.name?.trim();
  return name ? name : LOAN_TO_SUBCAT[loan.type];
}

function LoanCard({
  loan,
  payments,
  householdId,
  memberDebtAnswers,
  members,
  fmt: fmtProp,
  onDropPayment,
  onRename,
  onLoanAdded,
  dragOver,
  onDragOver,
  onDragLeave,
}: {
  loan: LoanItem;
  payments: Tx[];
  householdId: string;
  memberDebtAnswers: Record<string, DebtAnswers>;
  members: { uid: string; displayName: string }[];
  fmt: (n: number) => string;
  onDropPayment: (txId: string) => void;
  onRename?: (loan: LoanItem, newName: string) => Promise<void>;
  onLoanAdded?: () => void;
  dragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editing, setEditing] = useState(false);
  const [manualEditType, setManualEditType] = useState<LoanItem["type"]>("personal");
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(loan.source === "manual" ? (loan.name ?? "") : (loan.name?.trim() ?? ""));
  const [savingName, setSavingName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    balance: String(loan.balance),
    rate: loan.rate !== undefined ? String(loan.rate) : "",
    payment: loan.payment !== undefined ? String(loan.payment) : "",
    notes: loan.notes ?? "",
    name: loan.name ?? "",
    nickname: loan.nickname ?? "",
    bankName: loan.bankName ?? "",
    last4: loan.last4 ?? "",
    dueDate: loan.dueDate ?? "",
    creditLimit: loan.creditLimit !== undefined ? String(loan.creditLimit) : "",
    color: loan.color ?? "#9AA5B4",
    ownerUid: "",
  });

  async function handleSaveName() {
    if (!onRename) return;
    const trimmed = nameValue.trim();
    const current = loan.source === "manual" ? (loan.name ?? "") : (loan.name?.trim() ?? "");
    if (trimmed === current) {
      setEditingName(false);
      return;
    }
    if (!trimmed) {
      setEditingName(false);
      setNameValue(current);
      return;
    }
    setSavingName(true);
    try {
      await onRename(loan, trimmed);
      setEditingName(false);
    } finally {
      setSavingName(false);
    }
  }

  async function saveDebtAnswers(ownerUid: string, patch: DebtAnswers) {
    const snap = await getDoc(doc(db, "users", ownerUid));
    const existing = (snap.data()?.debtAnswers as DebtAnswers | undefined) ?? memberDebtAnswers[ownerUid] ?? {};
    const merged: DebtAnswers = {};
    for (const [k, v] of Object.entries({ ...existing, ...patch })) {
      if (v !== undefined && v !== null) merged[k] = v as string | number;
    }
    await updateDoc(doc(db, "users", ownerUid), { debtAnswers: merged });
  }

  async function removeLoanFromOwner(ownerUid: string, type: LoanItem["type"]) {
    const keys: string[] = {
      student: ["has_student_loans", "student_balance", "student_rate", "student_loan_notes", "student_loan_name"],
      car: ["has_car_loan", "car_balance", "car_payment", "car_loan_notes", "car_loan_name"],
      medical: ["has_medical_debt", "medical_balance", "medical_debt_notes", "medical_debt_name"],
      personal: ["has_personal_loan", "personal_loan_balance", "personal_loan_rate", "personal_loan_notes", "personal_loan_name"],
      credit: [],
    }[type];
    const snap = await getDoc(doc(db, "users", ownerUid));
    const existing = (snap.data()?.debtAnswers as DebtAnswers | undefined) ?? {};
    const merged: DebtAnswers = {};
    for (const [k, v] of Object.entries(existing)) {
      if (!keys.includes(k) && v !== undefined && v !== null) merged[k] = v as string | number;
    }
    await updateDoc(doc(db, "users", ownerUid), { debtAnswers: merged });
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (loan.source === "debtAnswers") {
        const balance = Number(form.balance.replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(balance) || balance < 0) return;
        const patch: DebtAnswers = {};
        if (loan.type === "student") {
          patch.has_student_loans = "yes";
          patch.student_balance = balance;
          if (form.rate.trim()) {
            const r = Number(form.rate.replace(/[^0-9.-]/g, ""));
            if (Number.isFinite(r) && r >= 0 && r <= 100) patch.student_rate = r;
          } else (patch as Record<string, unknown>).student_rate = null;
          patch.student_loan_notes = form.notes.trim();
          patch.student_loan_name = form.name.trim();
        } else if (loan.type === "car") {
          patch.has_car_loan = "yes";
          patch.car_balance = balance;
          if (form.payment.trim()) {
            const p = Number(form.payment.replace(/[^0-9.-]/g, ""));
            if (Number.isFinite(p) && p >= 0) patch.car_payment = p;
          } else (patch as Record<string, unknown>).car_payment = null;
          patch.car_loan_notes = form.notes.trim();
          patch.car_loan_name = form.name.trim();
        } else if (loan.type === "medical") {
          patch.has_medical_debt = "yes";
          patch.medical_balance = balance;
          patch.medical_debt_notes = form.notes.trim();
          patch.medical_debt_name = form.name.trim();
        } else if (loan.type === "personal") {
          patch.has_personal_loan = "yes";
          patch.personal_loan_balance = balance;
          if (form.rate.trim()) {
            const r = Number(form.rate.replace(/[^0-9.-]/g, ""));
            if (Number.isFinite(r) && r >= 0 && r <= 100) patch.personal_loan_rate = r;
          } else (patch as Record<string, unknown>).personal_loan_rate = null;
          patch.personal_loan_notes = form.notes.trim();
          patch.personal_loan_name = form.name.trim();
        }
        const targetUid = (form.ownerUid || loan.ownerUid).trim();
        if (!targetUid) return;
        if (targetUid !== loan.ownerUid) {
          await removeLoanFromOwner(loan.ownerUid, loan.type);
        }
        await saveDebtAnswers(targetUid, patch);
        onLoanAdded?.();
      } else if (loan.source === "account" && loan.accountId) {
        const accPatch: Record<string, unknown> = {};
        if (form.nickname !== (loan.nickname ?? "")) accPatch.nickname = form.nickname.trim();
        if (form.bankName !== (loan.bankName ?? "")) accPatch.bankName = form.bankName.trim();
        if (form.last4 !== (loan.last4 ?? "")) accPatch.last4 = form.last4.trim();
        if (form.dueDate !== (loan.dueDate ?? "")) accPatch.dueDate = form.dueDate.trim() || null;
        if (form.color !== (loan.color ?? "")) accPatch.color = form.color;
        const cl = Number(form.creditLimit.replace(/[^0-9.-]/g, ""));
        if (Number.isFinite(cl) && cl >= 0 && form.creditLimit !== String(loan.creditLimit ?? "")) {
          accPatch.creditLimit = cl;
        }
        if (Object.keys(accPatch).length > 0) {
          await updateDoc(doc(db, "households", householdId, "accounts", loan.accountId), accPatch);
        }
      } else if (loan.source === "manual") {
        const ownerUid = form.ownerUid.trim();
        if (!ownerUid) return;
        const balance = Number(form.balance.replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(balance) || balance < 0) return;
        const name = (form.name || (loan.name ?? "")).trim() || "Manual loan";
        const patch: DebtAnswers = {};
        if (manualEditType === "student") {
          patch.has_student_loans = "yes";
          patch.student_balance = balance;
          const r = form.rate ? Number(form.rate.replace(/[^0-9.-]/g, "")) : undefined;
          if (r !== undefined && Number.isFinite(r) && r >= 0 && r <= 100) patch.student_rate = r;
          patch.student_loan_notes = form.notes.trim();
          patch.student_loan_name = name;
        } else if (manualEditType === "car") {
          patch.has_car_loan = "yes";
          patch.car_balance = balance;
          const p = form.payment ? Number(form.payment.replace(/[^0-9.-]/g, "")) : undefined;
          if (p !== undefined && Number.isFinite(p) && p >= 0) patch.car_payment = p;
          patch.car_loan_notes = form.notes.trim();
          patch.car_loan_name = name;
        } else if (manualEditType === "medical") {
          patch.has_medical_debt = "yes";
          patch.medical_balance = balance;
          patch.medical_debt_notes = form.notes.trim();
          patch.medical_debt_name = name;
        } else {
          patch.has_personal_loan = "yes";
          patch.personal_loan_balance = balance;
          const r = form.rate ? Number(form.rate.replace(/[^0-9.-]/g, "")) : undefined;
          if (r !== undefined && Number.isFinite(r) && r >= 0 && r <= 100) patch.personal_loan_rate = r;
          patch.personal_loan_notes = form.notes.trim();
          patch.personal_loan_name = name;
        }
        await saveDebtAnswers(ownerUid, patch);
        onLoanAdded?.();
      }
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  const inputCls = "h-8 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A] focus:outline-none";
  const labelCls = "text-[10px] font-medium text-[#9AA5B4]";

  return (
    <div className="flex items-start gap-3 rounded-xl border border-[#E8ECF0] bg-white p-4 shadow-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="shrink-0 rounded p-0.5 text-[#9AA5B4] transition hover:bg-[#F4F6FA] hover:text-[#1B2A4A]"
            title={expanded ? "Collapse" : "Expand"}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <span className={`inline-block transition-transform ${expanded ? "rotate-90" : ""}`}>▶</span>
          </button>
          <span className="text-lg">{LOAN_EMOJI[loan.type]}</span>
          <div className="min-w-0 flex-1">
            {loan.source === "account" ? (
              <p className="truncate font-bold text-[#1B2A4A]">{loan.nickname || "Credit card"}</p>
            ) : editingName && onRename ? (
              <div className="flex items-center gap-2">
                <input
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleSaveName();
                    if (e.key === "Escape") { setEditingName(false); setNameValue(loan.source === "manual" ? (loan.name ?? "") : (loan.name?.trim() ?? "")); }
                  }}
                  onBlur={() => void handleSaveName()}
                  placeholder={LOAN_LABELS[loan.type]}
                  className="h-7 min-w-[120px] rounded border border-[#C9A84C] px-2 text-xs font-bold text-[#1B2A4A] focus:outline-none"
                  autoFocus
                />
                {savingName && <span className="text-[10px] text-[#9AA5B4]">Saving…</span>}
              </div>
            ) : (
              <p
                className={`truncate font-bold text-[#1B2A4A] ${(loan.source === "debtAnswers" || loan.source === "manual") && onRename ? "cursor-pointer hover:text-[#C9A84C]" : ""}`}
                title={(loan.source === "debtAnswers" || loan.source === "manual") && onRename ? "Click to rename subcategory" : undefined}
                onClick={() => { if ((loan.source === "debtAnswers" || loan.source === "manual") && onRename) { setEditingName(true); setNameValue(loan.source === "manual" ? (loan.name ?? "") : (loan.name?.trim() ?? "")); } }}
              >
                {loan.source === "manual"
                  ? loan.name || "Manual"
                  : loan.name?.trim() || LOAN_LABELS[loan.type]}
                {(loan.source === "debtAnswers" || loan.source === "manual") && onRename && (
                  <span className="ml-1 text-[10px] font-normal text-[#9AA5B4]">✎</span>
                )}
              </p>
            )}
            <p className="text-[10px] text-[#9AA5B4]">
              {loan.source === "manual" ? "Created manually (from transactions)" : loan.ownerName}
              {loan.source === "account" && loan.bankName && ` · ${loan.bankName} ·•${loan.last4}`}
            </p>
          </div>
          <span className="shrink-0 text-sm font-bold text-[#1B2A4A]">
            {loan.source === "manual" ? "—" : fmtProp(loan.balance)}
          </span>
          {!expanded && payments.length > 0 && (
            <span className="shrink-0 text-[10px] text-[#9AA5B4]">
              {payments.length} payment{payments.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        {/* Progress bar: paid vs remaining (debtAnswers with balance) — always visible */}
        {loan.source === "debtAnswers" && loan.balance > 0 && (
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-[10px]">
              <span className="text-[#9AA5B4]">Paid: {fmtProp(payments.reduce((s, t) => s + t.amount, 0))}</span>
              <span className="font-semibold text-[#1B2A4A]">
                Remaining: {fmtProp(Math.max(0, loan.balance - payments.reduce((s, t) => s + t.amount, 0)))}
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-[#E8ECF0]">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{
                  width: `${Math.min(100, (payments.reduce((s, t) => s + t.amount, 0) / loan.balance) * 100)}%`,
                }}
              />
            </div>
          </div>
        )}

        {expanded && (
        <>
        {/* Associated payments + drop zone */}
        <div
          className={`mt-3 rounded-lg border-2 border-dashed p-3 text-xs transition ${
            dragOver ? "border-[#C9A84C] bg-[#FFFDF5]" : "border-[#E8ECF0] bg-[#F9FAFC]"
          }`}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(e); }}
          onDragLeave={onDragLeave}
          onDrop={(e) => {
            e.preventDefault();
            onDragLeave();
            const txId = e.dataTransfer.getData("text/plain");
            if (txId) onDropPayment(txId);
          }}
        >
          <p className="mb-2 text-[10px] font-semibold text-[#9AA5B4]">Associated payments — drag to reassign, drop here</p>
          {payments.length === 0 ? (
            <p className="text-[10px] text-[#9AA5B4]">No payments yet. Drag from below or from another loan.</p>
          ) : (
            <div className="space-y-1">
              {payments.slice(0, 6).map((tx) => (
                <div
                  key={tx.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/plain", tx.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="flex cursor-grab justify-between rounded border border-transparent text-[#1B2A4A] transition hover:border-[#C9A84C] hover:bg-[#FFFDF5] active:cursor-grabbing"
                >
                  <span className="truncate">{tx.date} · {tx.merchantName || tx.desc}</span>
                  <span className="shrink-0 font-semibold text-red-600">−{fmtProp(tx.amount)}</span>
                </div>
              ))}
              {payments.length > 6 && <p className="text-[10px] text-[#9AA5B4]">+{payments.length - 6} more</p>}
              <p className="mt-1 border-t border-[#E4E8F0] pt-1 font-semibold text-[#1B2A4A]">
                Total paid: {fmtProp(payments.reduce((s, t) => s + t.amount, 0))}
              </p>
            </div>
          )}
        </div>

        {editing ? (
          <div className="mt-4 space-y-3">
            {/* Manual loan: add details to convert to tracked */}
            {loan.source === "manual" && (
              <>
                <div>
                  <label className={labelCls}>Person</label>
                  <select
                    value={form.ownerUid}
                    onChange={(e) => setForm((f) => ({ ...f, ownerUid: e.target.value }))}
                    className={`mt-0.5 w-full ${inputCls}`}
                  >
                    <option value="">Select person</option>
                    {members.map((m) => (
                      <option key={m.uid} value={m.uid}>{m.displayName}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Loan type</label>
                  <select
                    value={manualEditType}
                    onChange={(e) => setManualEditType(e.target.value as LoanItem["type"])}
                    className={`mt-0.5 w-full ${inputCls}`}
                  >
                    <option value="student">Student Loan</option>
                    <option value="car">Car Loan</option>
                    <option value="medical">Medical Debt</option>
                    <option value="personal">Personal Loan</option>
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Subcategory name</label>
                  <input
                    value={form.name || loan.name || ""}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={`mt-0.5 w-full ${inputCls}`}
                    placeholder="e.g. Sallie Mae"
                  />
                </div>
              </>
            )}
            {/* Person / Owner (debtAnswers only) */}
            {loan.source === "debtAnswers" && (
              <div>
                <label className={labelCls}>Who is associated with this loan</label>
                <select
                  value={form.ownerUid || loan.ownerUid}
                  onChange={(e) => setForm((f) => ({ ...f, ownerUid: e.target.value }))}
                  className={`mt-0.5 w-full ${inputCls}`}
                >
                  {members.map((m) => (
                    <option key={m.uid} value={m.uid}>{m.displayName}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Loan name (debtAnswers only) */}
            {loan.source === "debtAnswers" && (
              <div>
                <label className={labelCls}>Subcategory name (used when associating payments)</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className={`mt-0.5 w-full ${inputCls}`}
                  placeholder={LOAN_LABELS[loan.type]}
                />
              </div>
            )}
            {/* Balance */}
            <div>
              <label className={labelCls}>
                Balance {loan.source === "manual" ? "" : `(DB: ${loan.type === "student" ? "student_balance" : loan.type === "car" ? "car_balance" : loan.type === "medical" ? "medical_balance" : "personal_loan_balance"})`}
              </label>
              {loan.source === "account" ? (
                <span className="mt-0.5 block text-xs text-[#9AA5B4]">{fmtProp(loan.balance)}</span>
              ) : (
                <input
                  type="number"
                  min={0}
                  value={form.balance}
                  onChange={(e) => setForm((f) => ({ ...f, balance: e.target.value }))}
                  className={`mt-0.5 w-28 ${inputCls}`}
                />
              )}
            </div>
            {/* Rate (student, personal) */}
            {(loan.type === "student" || loan.type === "personal" || (loan.source === "manual" && (manualEditType === "student" || manualEditType === "personal"))) && (
              <div>
                <label className={labelCls}>Interest rate %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={form.rate}
                  onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
                  className={`mt-0.5 w-20 ${inputCls}`}
                />
              </div>
            )}
            {/* Payment (car) */}
            {(loan.type === "car" || (loan.source === "manual" && manualEditType === "car")) && (
              <div>
                <label className={labelCls}>Monthly payment</label>
                <input
                  type="number"
                  min={0}
                  value={form.payment}
                  onChange={(e) => setForm((f) => ({ ...f, payment: e.target.value }))}
                  className={`mt-0.5 w-24 ${inputCls}`}
                />
              </div>
            )}
            {/* Notes */}
            {(loan.source === "debtAnswers" || loan.source === "manual" || (loan.source === "account" && false)) && (
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  rows={2}
                  className={`mt-0.5 w-full resize-y ${inputCls} py-1.5`}
                  placeholder="Servicer, due date, etc."
                />
              </div>
            )}
            {/* Account fields (credit card) */}
            {loan.source === "account" && (
              <>
                <div>
                  <label className={labelCls}>Nickname (DB: accounts.nickname)</label>
                  <input
                    value={form.nickname}
                    onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))}
                    className={`mt-0.5 w-full ${inputCls}`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Bank name (DB: accounts.bankName)</label>
                  <input
                    value={form.bankName}
                    onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))}
                    className={`mt-0.5 w-full ${inputCls}`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Last 4 (DB: accounts.last4)</label>
                  <input
                    value={form.last4}
                    onChange={(e) => setForm((f) => ({ ...f, last4: e.target.value }))}
                    className={`mt-0.5 w-20 ${inputCls}`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Due date (DB: accounts.dueDate)</label>
                  <input
                    type="date"
                    value={form.dueDate}
                    onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
                    className={`mt-0.5 ${inputCls}`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Credit limit (DB: accounts.creditLimit)</label>
                  <input
                    type="number"
                    min={0}
                    value={form.creditLimit}
                    onChange={(e) => setForm((f) => ({ ...f, creditLimit: e.target.value }))}
                    className={`mt-0.5 w-24 ${inputCls}`}
                  />
                </div>
                <div>
                  <label className={labelCls}>Color (DB: accounts.color)</label>
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))}
                    className="mt-0.5 h-8 w-14 cursor-pointer rounded border border-[#E8ECF0]"
                  />
                </div>
              </>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleSave()}
                className="h-8 rounded-lg bg-[#C9A84C] px-3 text-xs font-bold text-[#1B2A4A] disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="h-8 rounded-lg border border-[#E8ECF0] px-2 text-xs text-[#9AA5B4]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#9AA5B4]">
            {loan.rate !== undefined && loan.rate > 0 && <span>{loan.rate}% APR</span>}
            {loan.payment !== undefined && loan.payment > 0 && <span>Payment: {fmtFull(loan.payment)}/mo</span>}
            {loan.notes && <span className="truncate max-w-[180px]" title={loan.notes}>📝 {loan.notes}</span>}
            <button
              type="button"
              onClick={() => {
                setForm({
                  balance: String(loan.balance),
                  rate: loan.rate !== undefined ? String(loan.rate) : "",
                  payment: loan.payment !== undefined ? String(loan.payment) : "",
                  notes: loan.notes ?? "",
                  name: loan.name ?? "",
                  nickname: loan.nickname ?? "",
                  bankName: loan.bankName ?? "",
                  last4: loan.last4 ?? "",
                  dueDate: loan.dueDate ?? "",
                  creditLimit: loan.creditLimit !== undefined ? String(loan.creditLimit) : "",
                  color: loan.color ?? "#9AA5B4",
                  ownerUid: loan.source === "debtAnswers" ? loan.ownerUid : (members[0]?.uid ?? ""),
                });
                setManualEditType(loan.source === "manual" ? "personal" : loan.type);
                setEditing(true);
              }}
              className="text-[#C9A84C] hover:underline"
            >
              {loan.source === "manual" ? "Add details (balance, interest, payment)" : "Edit all fields"}
            </button>
          </div>
        )}
        </>
        )}
      </div>
    </div>
  );
}

const SUBCAT_TO_SLOT: Record<string, LoanItem["type"]> = {
  "Student Loan": "student",
  "Car Loan": "car",
  "Medical Debt": "medical",
  "Personal Loan": "personal",
};

export function AllLoansSection({
  loans,
  transactions,
  householdId,
  memberDebtAnswers,
  members,
  fmt,
  onLoanAdded,
  debtSubcategories = [],
}: {
  loans: LoanItem[];
  transactions: Tx[];
  householdId: string;
  memberDebtAnswers: Record<string, DebtAnswers>;
  members: { uid: string; displayName: string }[];
  fmt: (n: number) => string;
  onLoanAdded?: () => void;
  debtSubcategories?: { id: string; name: string }[];
}) {
  const [dragOverLoanId, setDragOverLoanId] = useState<string | null>(null);

  const loansWithoutCreditCards = loans.filter((l) => l.type !== "credit");

  const manualLoans = useMemo(() => {
    const existingSubcats = new Set(
      loansWithoutCreditCards.map((l) => getSubcatForLoan(l)),
    );
    const manualSubcats = new Set<string>();
    for (const t of transactions) {
      if (
        t.category !== "Debt" ||
        !t.subcat?.trim() ||
        t.subcat === "Credit Card" ||
        existingSubcats.has(t.subcat.trim())
      )
        continue;
      if (t.type !== "expense" && t.type !== "transfer") continue;
      if (t.direction !== "debit") continue;
      manualSubcats.add(t.subcat.trim());
    }
    return Array.from(manualSubcats).map(
      (subcat): LoanItem => ({
        id: `manual-${subcat.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
        source: "manual",
        ownerUid: "",
        ownerName: "",
        type: "personal",
        name: subcat,
        balance: 0,
      }),
    );
  }, [loansWithoutCreditCards, transactions]);

  const allLoans = [...loansWithoutCreditCards, ...manualLoans];

  const paymentsByLoan = Object.fromEntries(
    allLoans.map((loan) => {
      const subcat = getSubcatForLoan(loan);
      const payments = transactions.filter(
        (t) =>
          t.category === "Debt" &&
          t.subcat === subcat &&
          (t.type === "expense" || t.type === "transfer") &&
          t.direction === "debit",
      );
      return [loan.id, payments] as const;
    }),
  );

  const associatedIds = new Set(
    Object.values(paymentsByLoan).flatMap((p) => p.map((t) => t.id)),
  );
  const availablePayments = transactions
    .filter((t) => {
      if (associatedIds.has(t.id)) return false;
      if (t.category !== "Debt") return false;
      if (t.type !== "expense" && t.type !== "transfer") return false;
      if (t.direction !== "debit") return false;
      if (t.amount === 0) return false;
      return true;
    })
    .slice(0, 30);

  async function handleAssociatePayment(txId: string, loanId: string) {
    const loan = allLoans.find((l) => l.id === loanId);
    if (!loan || !householdId) return;
    await updateDoc(doc(db, "households", householdId, "transactions", txId), {
      category: "Debt",
      subcat: getSubcatForLoan(loan),
    });
  }

  async function handleRenameLoan(loan: LoanItem, newName: string) {
    if (loan.source === "debtAnswers") {
      const existing = memberDebtAnswers[loan.ownerUid] ?? {};
      const patch: DebtAnswers = {};
      if (loan.type === "student") {
        patch.student_loan_name = newName;
      } else if (loan.type === "car") {
        patch.car_loan_name = newName;
      } else if (loan.type === "medical") {
        patch.medical_debt_name = newName;
      } else if (loan.type === "personal") {
        patch.personal_loan_name = newName;
      }
      const merged = { ...existing, ...patch };
      await updateDoc(doc(db, "users", loan.ownerUid), { debtAnswers: merged });
    } else if (loan.source === "manual" && loan.name) {
      const oldName = loan.name;
      const txIds = transactions
        .filter((t) => t.category === "Debt" && t.subcat === oldName)
        .map((t) => t.id);
      if (txIds.length === 0) return;
      const batch = writeBatch(db);
      for (const txId of txIds) {
        batch.update(doc(db, "households", householdId, "transactions", txId), {
          category: "Debt",
          subcat: newName,
        });
      }
      await batch.commit();
    }
  }

  const totalDebt = allLoans.reduce((s, l) => s + l.balance, 0);
  const loanTypeOptions = useMemo(() => {
    const list = debtSubcategories.length > 0
      ? debtSubcategories
      : getSubcategoriesByParent("Debt").map((name) => ({ id: `default-Debt-${name}`, name }));
    return list.filter((s) => s.name !== "Credit Card");
  }, [debtSubcategories]);
  const defaultType = loanTypeOptions.find((s) => s.name === "Student Loan")?.name ?? loanTypeOptions[0]?.name ?? "Student Loan";
  const [adding, setAdding] = useState(false);
  const [addType, setAddType] = useState<string>(defaultType);
  const [addOwnerUid, setAddOwnerUid] = useState("");
  const [addName, setAddName] = useState("");
  const [addBalance, setAddBalance] = useState("");
  const [addRate, setAddRate] = useState("");
  const [addPayment, setAddPayment] = useState("");
  const [addNotes, setAddNotes] = useState("");
  const [addSaving, setAddSaving] = useState(false);

  function resetAddForm() {
    setAddOwnerUid("");
    setAddType(defaultType);
    setAddName("");
    setAddBalance("");
    setAddRate("");
    setAddPayment("");
    setAddNotes("");
  }

  async function handleAddLoan() {
    if (!addOwnerUid) return;
    const balance = addBalance.trim() === "" ? 0 : Number(addBalance.replace(/[^0-9.-]/g, ""));
    if (!Number.isFinite(balance) || balance < 0) return;
    const rate = addRate.trim() ? Number(addRate.replace(/[^0-9.-]/g, "")) : undefined;
    if (rate !== undefined && (!Number.isFinite(rate) || rate < 0 || rate > 100)) return;
    const payment = addPayment.trim() ? Number(addPayment.replace(/[^0-9.-]/g, "")) : undefined;
    if (payment !== undefined && (!Number.isFinite(payment) || payment < 0)) return;

    const slot = SUBCAT_TO_SLOT[addType];
    const effectiveName = addName.trim() || addType;

    setAddSaving(true);
    try {
      const existing = memberDebtAnswers[addOwnerUid] ?? {};
      const patch: DebtAnswers = {};
      if (slot === "student") {
        patch.has_student_loans = "yes";
        patch.student_balance = balance;
        if (rate !== undefined) patch.student_rate = rate;
        patch.student_loan_notes = addNotes.trim();
        patch.student_loan_name = effectiveName;
      } else if (slot === "car") {
        patch.has_car_loan = "yes";
        patch.car_balance = balance;
        if (payment !== undefined) patch.car_payment = payment;
        patch.car_loan_notes = addNotes.trim();
        patch.car_loan_name = effectiveName;
      } else if (slot === "medical") {
        patch.has_medical_debt = "yes";
        patch.medical_balance = balance;
        patch.medical_debt_notes = addNotes.trim();
        patch.medical_debt_name = effectiveName;
      } else {
        patch.has_personal_loan = "yes";
        patch.personal_loan_balance = balance;
        if (rate !== undefined) patch.personal_loan_rate = rate;
        patch.personal_loan_notes = addNotes.trim();
        patch.personal_loan_name = effectiveName;
      }
      const merged: DebtAnswers = {};
      for (const [k, v] of Object.entries({ ...existing, ...patch })) {
        if (v !== undefined && v !== null) merged[k] = v as string | number;
      }
      await updateDoc(doc(db, "users", addOwnerUid), { debtAnswers: merged });
      setAdding(false);
      resetAddForm();
      onLoanAdded?.();
    } finally {
      setAddSaving(false);
    }
  }

  const memberNames = members.map((m) => m.displayName).join(" & ");

  function handlePrintToConsole() {
    const report = {
      household: memberNames || "Household",
      totalDebt: fmt(totalDebt),
      printedAt: new Date().toISOString(),
      memberDebtAnswers,
      loans: allLoans.map((loan) => ({
        id: loan.id,
        name: loan.source === "manual" ? loan.name : (loan.name?.trim() || LOAN_LABELS[loan.type]),
        type: loan.type,
        source: loan.source,
        ownerUid: loan.ownerUid,
        ownerName: loan.ownerName,
        subcategory: getSubcatForLoan(loan),
        balance: loan.balance,
        rate: loan.rate,
        payment: loan.payment,
        notes: loan.notes,
        payments: (paymentsByLoan[loan.id] ?? []).map((t) => ({ id: t.id, date: t.date, desc: t.merchantName || t.desc, amount: t.amount })),
      })),
    };
    console.log("Loans & Subcategories (from database)", report);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#1B2A4A]">All loans — {memberNames || "Household"}</h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handlePrintToConsole}
            className="rounded-lg border border-[#E8ECF0] px-2 py-1 text-xs font-medium text-[#1B2A4A] hover:bg-[#F4F6FA]"
          >
            Log loans to console
          </button>
          <span className="text-sm font-bold text-[#1B2A4A]">Total: {fmt(totalDebt)}</span>
        </div>
      </div>
      <p className="text-[11px] text-[#9AA5B4]">
        Click a loan name to rename. Drag payments between loans to reassign, or from below to associate.
      </p>

      {/* Available payments to associate — drag onto a loan */}
      {availablePayments.length > 0 && (
        <div className="rounded-xl border border-[#E8ECF0] bg-[#F9FAFC] p-4">
          <p className="mb-3 text-xs font-semibold text-[#1B2A4A]">Debt payments to associate — drag onto a loan above (only Debt-category)</p>
          <div className="flex flex-wrap gap-2">
            {availablePayments.map((tx) => (
              <div
                key={tx.id}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", tx.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                className="cursor-grab rounded-lg border border-[#E8ECF0] bg-white px-3 py-2 text-xs shadow-sm transition hover:border-[#C9A84C] active:cursor-grabbing"
              >
                <span className="font-medium text-[#1B2A4A]">{tx.merchantName || tx.desc}</span>
                <span className="ml-2 text-red-600">−{fmt(tx.amount)}</span>
                <span className="ml-1 text-[#9AA5B4]">{tx.date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="space-y-3">
        {adding ? (
          <div className="rounded-xl border border-[#E8ECF0] bg-[#F9FAFC] p-4">
            <p className="mb-3 text-xs font-semibold text-[#1B2A4A]">Add loan</p>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-medium text-[#9AA5B4]">Type</label>
                <select
                  value={addType}
                  onChange={(e) => setAddType(e.target.value)}
                  className="h-8 min-w-[160px] rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A]"
                >
                  {loanTypeOptions.map((s) => (
                    <option key={s.id} value={s.name}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-medium text-[#9AA5B4]">Person</label>
                <select
                  value={addOwnerUid}
                  onChange={(e) => setAddOwnerUid(e.target.value)}
                  className="h-8 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A]"
                >
                  <option value="">Select person</option>
                  {members.map((m) => (
                    <option key={m.uid} value={m.uid}>{m.displayName}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-medium text-[#9AA5B4]">Loan name (optional)</label>
                <input
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  placeholder={addType}
                  className="h-8 min-w-[140px] rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A] placeholder:text-[#9AA5B4]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[10px] font-medium text-[#9AA5B4]">Balance</label>
                <input
                  type="number"
                  min={0}
                  value={addBalance}
                  onChange={(e) => setAddBalance(e.target.value)}
                  placeholder="0"
                  className="h-8 w-24 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A]"
                />
              </div>
              {(SUBCAT_TO_SLOT[addType] === "student" || SUBCAT_TO_SLOT[addType] === "personal" || !SUBCAT_TO_SLOT[addType]) && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[10px] font-medium text-[#9AA5B4]">Interest rate %</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={addRate}
                    onChange={(e) => setAddRate(e.target.value)}
                    placeholder="e.g. 5.5"
                    className="h-8 w-20 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A]"
                  />
                </div>
              )}
              {SUBCAT_TO_SLOT[addType] === "car" && (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[10px] font-medium text-[#9AA5B4]">Monthly payment</label>
                  <input
                    type="number"
                    min={0}
                    value={addPayment}
                    onChange={(e) => setAddPayment(e.target.value)}
                    placeholder="Optional"
                    className="h-8 w-24 rounded-lg border border-[#C9A84C] bg-white px-2 text-xs text-[#1B2A4A]"
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-medium text-[#9AA5B4]">Notes</label>
                <textarea
                  value={addNotes}
                  onChange={(e) => setAddNotes(e.target.value)}
                  placeholder="Servicer, due date, payment plan, etc."
                  rows={2}
                  className="w-full max-w-xs resize-y rounded-lg border border-[#C9A84C] bg-white px-2 py-1.5 text-xs text-[#1B2A4A] placeholder:text-[#9AA5B4]"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={addSaving || !addOwnerUid}
                  onClick={() => void handleAddLoan()}
                  className="h-8 rounded-lg bg-[#C9A84C] px-3 text-xs font-bold text-[#1B2A4A] disabled:opacity-50"
                >
                  {addSaving ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => { setAdding(false); resetAddForm(); }}
                  className="h-8 rounded-lg border border-[#E8ECF0] px-2 text-xs text-[#9AA5B4]"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : allLoans.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[#E8ECF0] bg-[#F9FAFC] p-6 text-center text-sm text-[#9AA5B4]">
            No loans yet. Add from the Questions onboarding, connect credit card accounts, or add a loan below.
          </p>
        ) : null}
        {allLoans.length > 0 && allLoans.map((loan) => (
              <LoanCard
                key={loan.id}
                loan={loan}
                payments={paymentsByLoan[loan.id] ?? []}
                householdId={householdId}
                memberDebtAnswers={memberDebtAnswers}
                members={members}
                fmt={fmt}
                onDropPayment={(txId) => void handleAssociatePayment(txId, loan.id)}
                onRename={handleRenameLoan}
                onLoanAdded={onLoanAdded}
                dragOver={dragOverLoanId === loan.id}
                onDragOver={() => setDragOverLoanId(loan.id)}
                onDragLeave={() => setDragOverLoanId(null)}
              />
          ))}
        {!adding && (
          <button
            type="button"
            onClick={() => { setAdding(true); setAddType(defaultType); }}
            className="mt-2 w-full rounded-lg border border-dashed border-[#E8ECF0] py-2 text-xs text-[#9AA5B4] hover:border-[#C9A84C] hover:text-[#C9A84C]"
          >
            + Add loan (student, car, medical, personal)
          </button>
        )}
      </div>
    </div>
  );
}
