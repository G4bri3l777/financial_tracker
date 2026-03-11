export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { callClaude } from "@/app/lib/claude";
import { CATEGORY_NAMES, getDefaultType, type TransactionType } from "@/app/lib/categories";
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
  type: TransactionType;
  category: string;
  account: string;
};

const transactionTypes: TransactionType[] = ["income", "expense", "transfer", "refund"];

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
Return ONLY the JSON array. No explanation before or after.
Start your response with [ and end with ].
If you cannot fit all transactions, prioritize completing
each transaction object fully before stopping.
CRITICAL: Extract EVERY SINGLE transaction. Do not stop early.
Do not summarize. Do not skip any transaction.
This chunk may contain 50-150 transactions - extract ALL of them.
If the JSON response would be very long, that is expected and correct.
Start from the first transaction and go to the last one without stopping.
CRITICAL RULES FOR AMOUNTS:
- ALL amounts must be POSITIVE numbers (no negative values)
- Add a 'type' field to every transaction:
  * 'income'   -> salary, direct deposit, freelance payment, side income
  * 'transfer' -> savings transfers, investment contributions, 401k
  * 'refund'   -> refunds, credits, cashback
  * 'expense'  -> everything else (purchases, bills, payments)
- Examples:
  Salary $3,250 -> amount: 3250, type: 'income'
  Grocery $45 -> amount: 45.00, type: 'expense'
  Refund $12 -> amount: 12.00, type: 'refund'
  To Savings -> amount: 500, type: 'transfer'

Each item must have exactly:
{
  "date": "YYYY-MM-DD",
  "desc": "string",
  "amount": number,
  "type": "income" | "expense" | "transfer" | "refund",
  "category": "string",
  "account": "string"
}

category: one of [${CATEGORY_NAMES.join(", ")}]

Map each transaction to the most appropriate Dave Ramsey category.
Use these rules:
- Giving: tithes, donations, charity, gifts
- Saving: transfers to savings, investments, 401k
- Housing: rent, mortgage, utilities, home repairs
- Food: groceries, restaurants, coffee shops, fast food
- Transport: gas stations, car payments, parking, rideshare
- Health: pharmacies, doctors, dentists, gyms
- Insurance: insurance payments
- Personal: clothing stores, salons, subscriptions, Amazon
- Recreation: entertainment, travel, hobbies
- Debt: loan payments, credit card payments
- Income: direct deposits, refunds, credits

Bank statement text:
${chunkText}`,
      },
    ],
    "You are a financial document parser. Return ONLY valid JSON arrays. Never truncate. Never add explanation.",
  );
  console.log(`Chunk ${chunkIndex}: Claude returned ${claudeResponse.length} chars`);
  console.log("=== CLAUDE RAW RESPONSE (first 500 chars) ===");
  console.log(claudeResponse.substring(0, 500));
  console.log("=== CLAUDE RAW RESPONSE (last 500 chars) ===");
  console.log(claudeResponse.substring(claudeResponse.length - 500));
  console.log("=== RESPONSE LENGTH:", claudeResponse.length, "===");

  let rawText = claudeResponse;
  rawText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  console.log("arrayStart index:", rawText.indexOf("["));
  console.log("arrayEnd index:", rawText.lastIndexOf("]"));
  console.log("rawText length after cleaning:", rawText.length);
  const arrayStart = rawText.indexOf("[");
  let arrayEnd = rawText.lastIndexOf("]");

  if (arrayStart === -1) {
    console.log(`Chunk ${chunkIndex}: Extracted 0 transactions`);
    return [];
  }

  // If no closing bracket, the response was cut off.
  // Try to salvage by finding the last complete transaction object.
  if (arrayEnd === -1) {
    console.log("Response cut off — attempting to salvage complete objects");
    const lastCompleteObject = rawText.lastIndexOf("},");
    const lastObject = rawText.lastIndexOf("}");

    // Use whichever is further.
    const cutPoint = Math.max(lastCompleteObject, lastObject);

    if (cutPoint === -1) {
      console.log(`Chunk ${chunkIndex}: Extracted 0 transactions`);
      return [];
    }

    // Close the array after the last complete object.
    rawText = rawText.substring(arrayStart, cutPoint + 1) + "]";
    arrayEnd = rawText.length - 1;
    console.log("Salvaged array ends at:", cutPoint);
  }
  rawText = rawText.substring(arrayStart, arrayEnd + 1);

  try {
    const parsed = JSON.parse(rawText);
    const transactions = Array.isArray(parsed) ? (parsed as Array<Record<string, unknown>>) : [];
    console.log(`Chunk ${chunkIndex}: Extracted ${transactions.length} transactions`);
    return transactions;
  } catch {
    const partialMatches = rawText.match(/\{[^{}]+\}/g) || [];
    const transactions = partialMatches
      .map((m) => {
        try {
          return JSON.parse(m) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((item): item is Record<string, unknown> => Boolean(item));
    console.log(`Chunk ${chunkIndex}: Extracted ${transactions.length} transactions`);
    return transactions;
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

    const CHUNK_SIZE = 40000;
    const OVERLAP = 500;
    const chunks: string[] = [];
    for (let i = 0; i < extractedText.length; i += CHUNK_SIZE - OVERLAP) {
      chunks.push(extractedText.substring(i, i + CHUNK_SIZE));
    }
    console.log(`Document text length: ${extractedText.length} chars`);
    console.log(`Split into ${chunks.length} chunks of ~${CHUNK_SIZE} chars each`);

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
          type: String(t.type ?? "") as TransactionType,
          category: String(t.category ?? CATEGORY_NAMES[0]),
          account: String(t.account ?? "Unknown"),
          flagged: isDuplicate,
          flagReason: isDuplicate ? "Possible duplicate transaction" : "",
        };

        return tx;
      })
      .filter((t): t is ParsedTransaction & { flagged: boolean; flagReason: string } =>
        Boolean(t),
      );

    const sanitizedTransactions = transactions.map((t) => ({
      ...t,
      amount: Math.abs(Number(t.amount ?? 0)),
      type: transactionTypes.includes(t.type) ? t.type : getDefaultType(t.category),
    }));

    console.log("Total transactions after dedup:", sanitizedTransactions.length);
    console.log("Flagged transactions:", sanitizedTransactions.filter((t) => t.flagged).length);

    console.log("Parsed transactions count:", sanitizedTransactions.length);
    console.log("First transaction sample:", JSON.stringify(sanitizedTransactions[0]));

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
      const BATCH_SIZE = 400;
      for (let i = 0; i < sanitizedTransactions.length; i += BATCH_SIZE) {
        const batchChunk = sanitizedTransactions.slice(i, i + BATCH_SIZE);
        const batch = adminDb.batch();
        batchChunk.forEach((txn) => {
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
        });
        await batch.commit();
        console.log(
          `Saved batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchChunk.length} transactions`,
        );
      }
      console.log("Transactions saved successfully:", sanitizedTransactions.length);
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
      transactionCount: sanitizedTransactions.length,
      parsedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, transactionCount: sanitizedTransactions.length });
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
