export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { callClaude } from "@/app/lib/claude";
import { parseCSV } from "@/app/lib/parseCSV";
import { adminDb, adminStorage } from "@/app/lib/firebaseAdmin";
import * as admin from "firebase-admin";

type ParseRequestBody = {
  storagePath?: string;
  householdId?: string;
  docId?: string;
  fileName?: string;
};

type ParsedTransaction = {
  date: string;
  desc: string;
  amount: number;
  category:
    | "Food"
    | "Dining"
    | "Coffee"
    | "Transport"
    | "Housing"
    | "Utilities"
    | "Insurance"
    | "Healthcare"
    | "Education"
    | "Entertainment"
    | "Personal"
    | "Misc"
    | "Debt"
    | "Savings";
  account: string;
};

async function parseChunk(
  chunkText: string,
  chunkIndex: number,
): Promise<Array<Record<string, unknown>>> {
  const claudeResponse = await callClaude(
    [
      {
        role: "user",
        content: `Extract ALL transactions from this bank statement chunk ${chunkIndex}.
Return ONLY a valid JSON array. No explanation, no markdown, no preamble.
Each item must have exactly:
{ "date": "YYYY-MM-DD", "desc": "string", "amount": number, "category": "string", "account": "string" }

Categories must be one of: Food, Dining, Coffee, Transport, Housing, Utilities,
Insurance, Healthcare, Education, Entertainment, Personal, Misc, Debt, Savings, Income

Bank statement text:
${chunkText}`,
      },
    ],
    "You are a financial document parser. Return ONLY valid JSON arrays. Never truncate. Never add explanation.",
  );

  let rawText = claudeResponse;
  rawText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const arrayStart = rawText.indexOf("[");
  const arrayEnd = rawText.lastIndexOf("]");
  if (arrayStart === -1 || arrayEnd === -1) return [];
  rawText = rawText.substring(arrayStart, arrayEnd + 1);

  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
  } catch {
    const partialMatches = rawText.match(/\{[^{}]+\}/g) || [];
    return partialMatches
      .map((m) => {
        try {
          return JSON.parse(m) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => Boolean(item));
  }
}

export async function POST(request: Request) {
  let householdId = "";
  let docId = "";

  try {
    const body = (await request.json()) as ParseRequestBody;
    const storagePath = body.storagePath ?? "";
    householdId = body.householdId ?? "";
    docId = body.docId ?? "";
    const fileName = body.fileName ?? "";

    if (!storagePath || !householdId || !docId || !fileName) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields." },
        { status: 400 },
      );
    }

    const documentRef = adminDb
      .collection("households")
      .doc(householdId)
      .collection("documents")
      .doc(docId);

    // FIX 1 — check current status and lock before parsing.
    const docSnap = await documentRef.get();
    const currentStatus = docSnap.data()?.status;
    if (currentStatus === "complete" || currentStatus === "parsing") {
      return NextResponse.json({
        success: true,
        message: "Already parsed or currently parsing",
        skipped: true,
      });
    }

    await documentRef.update({ status: "parsing" });

    const documentData = docSnap.data() ?? {};
    const assignedTo =
      typeof documentData.assignedTo === "string" ? documentData.assignedTo : "";
    const assignedToName =
      typeof documentData.assignedToName === "string" ? documentData.assignedToName : "Unknown";

    const [fileBuffer] = await adminStorage.bucket().file(storagePath).download();

    const lowerName = fileName.toLowerCase();
    let extractedText = "";

    if (lowerName.endsWith(".csv")) {
      extractedText = parseCSV(fileBuffer.toString("utf-8"));
    } else if (lowerName.endsWith(".pdf")) {
      const rawText = fileBuffer.toString("latin1");
      const textMatches = rawText.match(/[\x20-\x7E]{4,}/g) || [];
      extractedText = textMatches.join(" ");
    } else {
      throw new Error("Unsupported file type. Please upload CSV or PDF.");
    }

    // Split text into chunks of 30000 characters with 500 char overlap.
    const CHUNK_SIZE = 30000;
    const OVERLAP = 500;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += CHUNK_SIZE - OVERLAP) {
      chunks.push(extractedText.substring(i, i + CHUNK_SIZE));
    }
    console.log(`Processing ${chunks.length} chunks for document`);

    const chunkResults = await Promise.all(chunks.map((chunk, i) => parseChunk(chunk, i + 1)));
    let allTransactions = chunkResults.flat();
    console.log("Total transactions before dedup:", allTransactions.length);

    // Add a unique index to each transaction to distinguish them.
    allTransactions = allTransactions.map((t, index) => ({
      ...t,
      _index: index,
    }));

    // Find duplicates by date + desc + amount.
    const keyCount: Record<string, number> = {};
    allTransactions.forEach((t) => {
      if (!t || !t.date || !t.desc || typeof t.amount !== "number") return;
      const key = `${String(t.date)}-${String(t.desc)}-${String(t.amount)}`;
      keyCount[key] = (keyCount[key] || 0) + 1;
    });

    // Keep all legitimate duplicates, skip only likely chunk-overlap artifacts.
    const seen = new Map<string, number>();
    const transactions = allTransactions
      .filter((t) => {
        if (!t || !t.date || !t.desc || typeof t.amount !== "number") return false;
        return true;
      })
      .map((t) => {
        const key = `${String(t.date)}-${String(t.desc)}-${String(t.amount)}`;
        const lastIndex = seen.get(key);
        seen.set(key, Number(t._index));

        if (lastIndex !== undefined && Number(t._index) - lastIndex < 5) {
          return null;
        }

        const isDuplicate =
          keyCount[key] > 1 && (lastIndex === undefined || Number(t._index) - lastIndex >= 5);

        const tx = {
          date: String(t.date),
          desc: String(t.desc),
          amount: Number(t.amount),
          category: String(t.category ?? "Misc"),
          account: String(t.account ?? "Unknown"),
          flagged: isDuplicate,
          flagReason: isDuplicate ? "Possible duplicate transaction" : "",
        };

        return tx;
      })
      .filter((t): t is ParsedTransaction & { flagged: boolean; flagReason: string } =>
        Boolean(t),
      );

    console.log("Total transactions after dedup:", transactions.length);
    console.log("Flagged transactions:", transactions.filter((t) => t.flagged).length);

    console.log("Parsed transactions count:", transactions.length);
    console.log("First transaction sample:", JSON.stringify(transactions[0]));

    // FIX 3 — delete existing transactions for this docId before saving new ones.
    const existingTxns = await adminDb
      .collection("households")
      .doc(householdId)
      .collection("transactions")
      .where("docId", "==", docId)
      .get();

    if (!existingTxns.empty) {
      const deleteBatch = adminDb.batch();
      existingTxns.docs.forEach((d) => deleteBatch.delete(d.ref));
      await deleteBatch.commit();
      console.log("Deleted existing transactions:", existingTxns.size);
    }

    // FIX 4 — save transactions using adminDb batch.
    try {
      const batch = adminDb.batch();
      for (const txn of transactions) {
        const ref = adminDb
          .collection("households")
          .doc(householdId)
          .collection("transactions")
          .doc();
        batch.set(ref, {
          ...txn,
          docId,
          assignedTo,
          assignedToName,
          reviewed: false,
          flagged: txn.flagged || false,
          flagReason: txn.flagReason || "",
          comment: "",
          commentBy: "",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();
      console.log("Transactions saved successfully:", transactions.length);
    } catch (saveError) {
      console.error("TRANSACTION SAVE ERROR:", saveError);
      throw saveError;
    }

    // FIX 5 — update final document status with adminDb update.
    await adminDb
      .collection("households")
      .doc(householdId)
      .collection("documents")
      .doc(docId)
      .update({
      status: "complete",
      transactionCount: transactions.length,
      parsedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, transactionCount: transactions.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Document parsing failed.";

    if (householdId && docId) {
      await adminDb
        .collection("households")
        .doc(householdId)
        .collection("documents")
        .doc(docId)
        .update({
          status: "error",
          error: message,
          parsedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
    }

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
