import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/app/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

type TxData = {
  date: string;
  description: string;
  amount: number;
  direction: "debit" | "credit";
  type: "income" | "expense" | "transfer" | "refund";
  transferType?: string | null;
  merchantName?: string | null;
  category?: string | null;
  subcat?: string | null;
  isSubscription?: boolean;
  confidence?: number;
  needsReview?: boolean;
  flagReason?: string | null;
  transferPairHint?: string | null;
  subAccount?: string | null;
};

type ParsedStatement = {
  statement: {
    bankName: string;
    accountHolder: string;
    accountLast4: string;
    accountId?: string;
    accountLabel?: string;
    accountType: string;
    statementStart: string;
    statementEnd: string;
    openingBalance?: number;
    closingBalance?: number;
    creditLimit?: number | null;
    currency?: string;
    assignedTo?: string;
    subAccounts?: { id: string; label: string; type: string; openingBalance: number; closingBalance: number }[];
  };
  transactions: TxData[];
  parserNotes?: string;
};

function norm(s: unknown) { return String(s || "").toLowerCase(); }

function findAccount(
  accounts: { id: string; nickname: string; bankName: string; last4: string; cardLast4?: string; type: string; owner: string; ownerName: string; color?: string }[],
  stmt: ParsedStatement["statement"],
  subAccountId?: string | null,
) {
  const bank   = norm(stmt.bankName);
  const l4     = String(stmt.accountLast4 || "");
  const holder = norm(stmt.accountHolder || "");
  const joint  = stmt.assignedTo === "joint";
  const extId  = String(stmt.accountId || "");
  const type   = norm(stmt.accountType || "");

  const isGabriel  = holder.includes("gabriel");
  const isVictoria = holder.includes("victoria") || holder.includes("wise");

  if (bank.includes("pnc") && isGabriel)
    return accounts.find(a => a.last4 === "8376" || a.cardLast4 === "6910");

  if (bank.includes("credit one") && isGabriel) {
    if (l4 === "9427") return accounts.find(a => a.last4 === "9427");
    if (l4 === "7518") return accounts.find(a => a.last4 === "7518");
  }

  if (bank.includes("citadel")) {
    if (joint || extId.includes("S0000"))
      return accounts.find(a => a.last4 === "S000" && a.owner === "joint");
    if (joint || extId.includes("S0070") || l4 === "0070")
      return accounts.find(a => a.last4 === "0070" && a.owner === "joint");
    if (type === "credit" && isVictoria && !joint)
      return accounts.find(a => a.last4 === "4494");
    if (isVictoria && !joint) {
      if (subAccountId === "savings-0000" || (l4 === "0000" && !stmt.subAccounts))
        return accounts.find(a => a.last4 === "0000" && a.ownerName === "Victoria");
      if (subAccountId === "checking-0071" || l4 === "0071")
        return accounts.find(a => a.last4 === "0071");
    }
  }

  // Fallback: match by last4
  return accounts.find(a => a.last4 === l4 || a.cardLast4 === l4) ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const { jsonContent, householdId, fileName } = await req.json() as {
      jsonContent: ParsedStatement;
      householdId: string;
      fileName: string;
    };

    if (!householdId || !jsonContent?.statement || !Array.isArray(jsonContent.transactions)) {
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }

    const base = adminDb.collection("households").doc(householdId);

    // Load accounts
    const accSnap = await base.collection("accounts").get();
    const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() })) as Parameters<typeof findAccount>[0];

    const stmt = jsonContent.statement;
    const txns = jsonContent.transactions;

    // Check for duplicate (same fileName + householdId)
    const existingDocs = await base.collection("documents")
      .where("fileName", "==", fileName).get();
    if (!existingDocs.empty) {
      return NextResponse.json({
        error: `Statement "${fileName}" already imported. Delete it first to re-import.`,
        duplicate: true,
      }, { status: 409 });
    }

    // Build subAccount → account map
    const statementAccounts = new Map<string, (typeof accounts)[0] | null>();
    if (stmt.subAccounts?.length) {
      for (const sa of stmt.subAccounts) {
        statementAccounts.set(sa.id, findAccount(accounts, stmt, sa.id) ?? null);
      }
      statementAccounts.set("main", findAccount(accounts, stmt, null) ?? null);
    } else {
      statementAccounts.set("main", findAccount(accounts, stmt, null) ?? null);
    }

    const primaryAcc = statementAccounts.get("main") ?? statementAccounts.values().next().value;

    // Create document record
    const docRef = await base.collection("documents").add({
      fileName,
      bankName:         stmt.bankName,
      accountLast4:     stmt.accountLast4,
      accountId:        stmt.accountId ?? null,
      accountLabel:     stmt.accountLabel ?? null,
      accountType:      stmt.accountType,
      accountHolder:    stmt.accountHolder,
      statementStart:   stmt.statementStart,
      statementEnd:     stmt.statementEnd,
      openingBalance:   stmt.openingBalance ?? null,
      closingBalance:   stmt.closingBalance ?? null,
      creditLimit:      stmt.creditLimit ?? null,
      currency:         stmt.currency ?? "USD",
      assignedTo:       stmt.assignedTo ?? null,
      accountDocId:     primaryAcc?.id ?? null,
      transactionCount: txns.length,
      status:           "complete",
      parserNotes:      jsonContent.parserNotes ?? null,
      uploadedAt:       FieldValue.serverTimestamp(),
      parsedAt:         FieldValue.serverTimestamp(),
    });

    // Determine owner from primary account
    const ownerUid  = primaryAcc?.owner  ?? "joint";
    const ownerName = primaryAcc?.ownerName ?? "Joint";

    // Import transactions in batches of 400
    let imported = 0;
    let flagged  = 0;
    const chunks: TxData[][] = [];
    for (let i = 0; i < txns.length; i += 400) chunks.push(txns.slice(i, i + 400));

    for (const chunk of chunks) {
      const batch = adminDb.batch();
      for (const tx of chunk) {
        const subAccKey = tx.subAccount || "main";
        const acc = statementAccounts.get(subAccKey) ?? statementAccounts.get("main") ?? null;
        const accId = acc?.id ?? null;

        const txDoc: Record<string, unknown> = {
          householdId,
          sourceDocId:    docRef.id,
          date:           tx.date,
          month:          tx.date.slice(0, 7),
          desc:           tx.description,
          merchantName:   tx.merchantName ?? null,
          amount:         tx.amount,
          currency:       stmt.currency ?? "USD",
          type:           tx.type,
          direction:      tx.direction,
          transferType:   tx.transferType ?? null,
          category:       tx.category ?? null,
          subcat:         tx.subcat ?? null,
          isSubscription: tx.isSubscription ?? false,
          accountId:      accId,
          accountSnapshot: acc ? {
            nickname: acc.nickname,
            bankName: acc.bankName,
            last4:    acc.last4,
            type:     acc.type,
            color:    acc.color ?? "#9AA5B4",
          } : null,
          subAccountId:   tx.subAccount ?? null,
          assignedTo:     ownerUid,
          assignedToName: ownerName,
          transferPairId:        null,
          transferPairHint:      tx.transferPairHint ?? null,
          transferFromAccountId: null,
          transferToAccountId:   null,
          reviewed:    false,
          flagged:     tx.needsReview ?? false,
          flagReason:  tx.flagReason  ?? null,
          confidence:  tx.confidence  ?? 1.0,
          addedManually: false,
          createdAt:   FieldValue.serverTimestamp(),
          updatedAt:   FieldValue.serverTimestamp(),
          updatedBy:   ownerUid,
        };

        // Strip nulls
        Object.keys(txDoc).forEach(k => {
          if (txDoc[k] === null || txDoc[k] === undefined) delete txDoc[k];
        });

        batch.set(base.collection("transactions").doc(), txDoc);
        imported++;
        if (tx.needsReview) flagged++;
      }
      await batch.commit();
    }

    return NextResponse.json({ imported, flagged, docId: docRef.id, fileName });
  } catch (e) {
    console.error("[import-statement]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed" },
      { status: 500 }
    );
  }
}
