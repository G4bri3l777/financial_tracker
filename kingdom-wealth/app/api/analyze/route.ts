export const runtime = "nodejs";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import * as admin from "firebase-admin";
import { callClaude } from "@/app/lib/claude";
import { getCategoryEmoji } from "@/app/lib/categories";
import { adminDb } from "@/app/lib/firebaseAdmin";

type AnalyzeRequest = {
  householdId?: string;
};

type Tx = {
  date: string;
  desc: string;
  amount: number;
  type: "income" | "expense" | "transfer" | "refund";
  category: string;
  subcat?: string;
  comment?: string;
  commentBy?: string;
  reviewed?: boolean;
  flagged?: boolean;
};

type CategoryBreakdownItem = {
  category: string;
  emoji: string;
  totalAmount: number;
  avgMonthlyAmount: number;
  transactionCount: number;
  percentOfExpenses: number;
  subcategoryBreakdown: Array<{ name: string; amount: number }>;
  topMerchants: Array<{ name: string; amount: number }>;
  comments: string[];
};

function cleanJsonText(input: string): string {
  let text = input.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const arrayStart = text.indexOf("{");
  const arrayEnd = text.lastIndexOf("}");
  if (arrayStart !== -1 && arrayEnd !== -1) {
    text = text.substring(arrayStart, arrayEnd + 1);
  }
  return text;
}

function buildCategoryBreakdown(txns: Tx[], monthsSpan: number): CategoryBreakdownItem[] {
  const grouped: Record<string, {
    category: string;
    emoji: string;
    totalAmount: number;
    transactionCount: number;
    subcategories: Record<string, number>;
    merchants: Record<string, number>;
    comments: string[];
  }> = {};

  txns.forEach((t) => {
    if (t.type === "income" || t.type === "refund") return;
    const cat = t.category || "Misc";
    if (!grouped[cat]) {
      grouped[cat] = {
        category: cat,
        emoji: getCategoryEmoji(cat),
        totalAmount: 0,
        transactionCount: 0,
        subcategories: {},
        merchants: {},
        comments: [],
      };
    }
    grouped[cat].totalAmount += t.amount;
    grouped[cat].transactionCount += 1;

    const subcat = t.subcat || "Uncategorized";
    grouped[cat].subcategories[subcat] = (grouped[cat].subcategories[subcat] || 0) + t.amount;

    const merchant = t.desc || "Unknown";
    grouped[cat].merchants[merchant] = (grouped[cat].merchants[merchant] || 0) + t.amount;

    if (t.comment && t.comment.trim()) {
      grouped[cat].comments.push(`${t.desc}: ${t.comment}`);
    }
  });

  const totalExpenses = txns
    .filter((t) => t.type !== "income" && t.type !== "refund")
    .reduce((sum, t) => sum + t.amount, 0);

  return Object.values(grouped)
    .map((cat) => {
      const topMerchants = Object.entries(cat.merchants)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 5)
        .map(([name, amount]) => ({ name, amount: Number(amount) }));

      const subcategoryBreakdown = Object.entries(cat.subcategories)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .map(([name, amount]) => ({ name, amount: Number(amount) }));

      return {
        category: cat.category,
        emoji: cat.emoji,
        totalAmount: Number(cat.totalAmount.toFixed(2)),
        avgMonthlyAmount: Number((cat.totalAmount / monthsSpan).toFixed(2)),
        transactionCount: cat.transactionCount,
        percentOfExpenses:
          totalExpenses > 0 ? Number(((cat.totalAmount / totalExpenses) * 100).toFixed(1)) : 0,
        subcategoryBreakdown,
        topMerchants,
        comments: cat.comments.slice(0, 5),
      } satisfies CategoryBreakdownItem;
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

async function analyzeMonth(
  monthKey: string,
  monthTxns: Tx[],
  members: Array<{ name: string }>,
  overallAvgMonthlyExpenses: number,
) {
  const monthIncome = monthTxns
    .filter((t) => t.type === "income" || t.type === "refund")
    .reduce((sum, t) => sum + t.amount, 0);

  const monthExpenses = monthTxns
    .filter((t) => t.type === "expense" || t.type === "transfer")
    .reduce((sum, t) => sum + t.amount, 0);

  const monthNet = monthIncome - monthExpenses;
  const savingsRate = monthIncome > 0 ? Number(((monthNet / monthIncome) * 100).toFixed(1)) : 0;

  const categoryBreakdown = buildCategoryBreakdown(monthTxns, 1);

  const topExpenses = monthTxns
    .filter((t) => t.type === "expense")
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)
    .map((t) => ({
      merchant: t.desc,
      amount: t.amount,
      category: t.category,
      subcat: t.subcat || null,
      date: t.date,
    }));

  const monthComments = monthTxns
    .filter((t) => t.comment && t.comment.trim())
    .map((t) => ({
      merchant: t.desc,
      amount: t.amount,
      category: t.category,
      comment: t.comment,
    }));

  const vsAverage =
    overallAvgMonthlyExpenses > 0
      ? Number((((monthExpenses - overallAvgMonthlyExpenses) / overallAvgMonthlyExpenses) * 100).toFixed(1))
      : 0;

  const miniSummary = {
    month: monthKey,
    monthName: new Date(`${monthKey}-15`).toLocaleString("en-US", { month: "long", year: "numeric" }),
    members: members.map((m) => m.name),
    income: monthIncome,
    expenses: monthExpenses,
    net: monthNet,
    savingsRate,
    transactionCount: monthTxns.length,
    vsAveragePercent: vsAverage,
    categoryBreakdown: categoryBreakdown.map((c) => ({
      category: c.category,
      emoji: c.emoji,
      total: c.totalAmount,
      subcategories: c.subcategoryBreakdown,
      topMerchants: c.topMerchants,
    })),
    topExpenses,
    comments: monthComments,
  };

  const monthReportText = await callClaude(
    [
      {
        role: "user",
        content: `Analyze ${miniSummary.monthName} for ${miniSummary.members.join(" and ")}.

This month vs average: ${vsAverage > 0 ? "+" : ""}${vsAverage}% spending

Data: ${JSON.stringify(miniSummary)}

Return ONLY this JSON (no markdown, no explanation):
{
  "healthScore": 0,
  "healthGrade": "A",
  "summary": "",
  "topWin": "",
  "topConcern": "",
  "subcategoryInsight": "",
  "merchantInsight": "",
  "commentInsights": null,
  "trend": "stable"
}`,
      },
    ],
    "You are a financial advisor. Return ONLY valid JSON. Be warm, specific, and reference real data.",
  );

  let rawText = monthReportText;
  rawText = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start === -1 || end === -1) {
    return {
      ...miniSummary,
      healthScore: 50,
      healthGrade: "C",
      summary: "Analysis unavailable for this month.",
      topWin: "",
      topConcern: "",
      trend: "stable",
    };
  }

  try {
    const parsed = JSON.parse(rawText.substring(start, end + 1));
    return { ...miniSummary, ...parsed };
  } catch {
    return {
      ...miniSummary,
      healthScore: 50,
      healthGrade: "C",
      summary: "Analysis unavailable for this month.",
      topWin: "",
      topConcern: "",
      trend: "stable",
    };
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as AnalyzeRequest;
    const householdId = body.householdId ?? "";

    if (!householdId) {
      return NextResponse.json({ success: false, error: "Missing householdId." }, { status: 400 });
    }

    const householdRef = adminDb.collection("households").doc(householdId);
    const householdSnap = await householdRef.get();
    const householdData = householdSnap.data() ?? {};
    const memberIds = Array.isArray(householdData.members)
      ? (householdData.members as string[])
      : [];

    const userSnaps = await Promise.all(memberIds.map((uid) => adminDb.collection("users").doc(uid).get()));
    const members = userSnaps.map((snap, index) => {
      const data = snap.data() ?? {};
      const firstName = typeof data.firstName === "string" ? data.firstName : `Member ${index + 1}`;
      const monthlyIncome = Number(data.monthlyIncome ?? 0);
      const ownsOrRents = typeof data.ownsOrRents === "string" ? data.ownsOrRents : "";
      const hasDebt = typeof data.hasDebt === "string" ? data.hasDebt : "";
      const debtAnswers =
        data.debtAnswers && typeof data.debtAnswers === "object"
          ? (data.debtAnswers as Record<string, unknown>)
          : null;

      return {
        uid: memberIds[index],
        firstName,
        monthlyIncome,
        ownsOrRents,
        hasDebt,
        debtAnswers,
      };
    });

    const txSnap = await adminDb.collection("households").doc(householdId).collection("transactions").get();
    const transactions: Tx[] = txSnap.docs.map((d) => {
      const data = d.data();
      const amount = Math.abs(Number(data.amount ?? 0));
      const type = (data.type as Tx["type"] | undefined) ?? "expense";
      return {
        date: String(data.date ?? ""),
        desc: String(data.desc ?? "Unknown"),
        amount,
        type,
        category: String(data.category ?? "Misc"),
        subcat: typeof data.subcat === "string" ? data.subcat : "",
        comment: typeof data.comment === "string" ? data.comment : "",
        commentBy: typeof data.commentBy === "string" ? data.commentBy : "",
        reviewed: Boolean(data.reviewed),
        flagged: Boolean(data.flagged),
      };
    });

    const membersWithData = members.filter((m) => m.debtAnswers && m.monthlyIncome);
    const isComplete = membersWithData.length === members.length;
    const missingMembers = members
      .filter((m) => !m.debtAnswers || !m.monthlyIncome)
      .map((m) => m.firstName);

    const parsedDates = transactions
      .map((t) => new Date(t.date))
      .filter((d) => !Number.isNaN(d.getTime()));
    const minDate = parsedDates.length > 0 ? new Date(Math.min(...parsedDates.map((d) => d.getTime()))) : new Date();
    const maxDate = parsedDates.length > 0 ? new Date(Math.max(...parsedDates.map((d) => d.getTime()))) : new Date();
    const monthsSpan = Math.max(
      1,
      (maxDate.getFullYear() - minDate.getFullYear()) * 12 +
        (maxDate.getMonth() - minDate.getMonth()) +
        1,
    );
    console.log("Months span:", monthsSpan);

    const totalIncome = transactions.reduce(
      (sum, tx) => (tx.type === "income" || tx.type === "refund" ? sum + tx.amount : sum),
      0,
    );
    const totalExpenses = transactions.reduce(
      (sum, tx) => (tx.type === "expense" || tx.type === "transfer" ? sum + tx.amount : sum),
      0,
    );
    const avgMonthlyIncome = totalIncome / monthsSpan;
    const avgMonthlyExpenses = totalExpenses / monthsSpan;
    const avgMonthlyNet = avgMonthlyIncome - avgMonthlyExpenses;
    const savingsRate =
      avgMonthlyIncome > 0 ? ((avgMonthlyNet / avgMonthlyIncome) * 100).toFixed(1) : "0.0";

    const dateRange = {
      from: minDate.toISOString(),
      to: maxDate.toISOString(),
    };

    const enrichedCategoryBreakdown = buildCategoryBreakdown(transactions, monthsSpan);

    const topExpenses = [...transactions]
      .filter((tx) => tx.type === "expense" || tx.type === "transfer")
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((tx) => ({
        date: tx.date,
        desc: tx.desc,
        amount: tx.amount,
        category: tx.category,
      }));

    const monthMap = new Map<string, { income: number; expenses: number }>();
    for (const tx of transactions) {
      const month = tx.date ? tx.date.slice(0, 7) : "unknown";
      const row = monthMap.get(month) ?? { income: 0, expenses: 0 };
      if (tx.type === "income" || tx.type === "refund") row.income += tx.amount;
      if (tx.type === "expense" || tx.type === "transfer") row.expenses += tx.amount;
      monthMap.set(month, row);
    }
    const monthlyTrend = Array.from(monthMap.entries())
      .map(([month, row]) => ({ month, income: row.income, expenses: row.expenses }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const transactionsByMonth = transactions.reduce((acc, t) => {
      const month = t.date.substring(0, 7);
      if (!acc[month]) acc[month] = [];
      acc[month].push(t);
      return acc;
    }, {} as Record<string, Tx[]>);

    const months = Object.keys(transactionsByMonth).sort();
    const monthlyReports = [];
    for (const month of months) {
      const monthReport = await analyzeMonth(
        month,
        transactionsByMonth[month],
        membersWithData.map((m) => ({ name: m.firstName })),
        avgMonthlyExpenses,
      );
      monthlyReports.push(monthReport);
    }

    const summary = {
      household: {
        name: String(householdData.name ?? "Your Household"),
        country: String(householdData.country ?? "Unknown"),
        memberCount: members.length,
      },
      members: membersWithData.map((m) => ({
        uid: m.uid,
        name: m.firstName,
        monthlyIncome: Number(m.monthlyIncome) || 0,
        ownsOrRents: m.ownsOrRents,
        hasDebt: m.hasDebt,
        debtAnswers: m.debtAnswers ?? {},
      })),
      financials: {
        totalIncome,
        totalExpenses,
        avgMonthlyIncome,
        avgMonthlyExpenses,
        avgMonthlyNet,
        savingsRate,
        monthsAnalyzed: monthsSpan,
        dateRange,
        transactionCount: transactions.length,
      },
      categoryBreakdown: enrichedCategoryBreakdown.map((c) => ({
        category: c.category,
        emoji: c.emoji,
        totalAmount: c.totalAmount,
        avgMonthlyAmount: c.avgMonthlyAmount,
        percentOfExpenses: c.percentOfExpenses,
        subcategories: c.subcategoryBreakdown,
        topMerchants: c.topMerchants,
        comments: c.comments,
      })),
      topExpenses,
      monthlyTrend,
      monthlyReports,
      reportStatus: isComplete ? "complete" : "partial",
      missingMembers,
    };

    const systemPrompt = `You are Kingdom Wealth's AI financial advisor for Christian couples.
Analyze real financial data and provide warm, encouraging, actionable
guidance rooted in biblical stewardship principles.

Tone: trusted friend who is also a CPA and Dave Ramsey certified coach.
Never judgmental. Always specific. Always hopeful.
Address members by first name. Use 'your household' naturally.
Occasionally reference biblical stewardship — subtle, never preachy.
If report is partial (one spouse), acknowledge this warmly and note
the report will be even more complete when both spouses contribute.
Return ONLY valid JSON. No markdown. No explanation.`;

    const userPrompt = `Analyze this household financial data and return a JSON report.

${isComplete ? "" : "NOTE: This is a PARTIAL report — not all household members have submitted their data yet. Acknowledge this warmly in your summary."}

IMPORTANT: The financials show both TOTALS (over ${monthsSpan} months) and MONTHLY AVERAGES.
Always use avgMonthlyIncome and avgMonthlyExpenses when discussing monthly figures.
Never divide total by 1 — the data spans ${monthsSpan} months.

Pay special attention to:
 - Subcategory patterns (e.g. which subcategory drives most spending)
 - Recurring merchants (high frequency or high amount)
 - User comments on transactions (these show intent/context)
 - Month-by-month trends already calculated

Data: ${JSON.stringify(summary)}

Return ONLY this exact JSON:
{
  "healthScore": 0,
  "healthGrade": "A",
  "summary": "",
  "strengths": [],
  "income": {
    "combined": 0,
    "byMember": [{ "name": "", "amount": 0 }]
  },
  "topRisks": [{
    "title": "",
    "description": "",
    "severity": "high"
  }],
  "categoryBreakdown": [{
    "category": "",
    "amount": 0,
    "recommendedBudget": 0,
    "status": "over",
    "insight": ""
  }],
  "debtSummary": [{
    "name": "",
    "balance": 0,
    "rate": 0,
    "monthlyPayment": 0,
    "payoffMonths": 0
  }],
  "recommendedBudget": {
    "totalIncome": 0,
    "categories": {}
  },
  "keyInsights": [],
  "quickWins": [],
  "encouragement": ""
}`;

    const responseText = await callClaude([{ role: "user", content: userPrompt }], systemPrompt);
    const cleanText = cleanJsonText(responseText);
    const reportData = JSON.parse(cleanText) as Record<string, unknown>;

    const reportRef = adminDb.collection("households").doc(householdId).collection("reports").doc();
    await reportRef.set({
      ...reportData,
      status: isComplete ? "complete" : "partial",
      missingMembers,
      generatedWith: membersWithData.map((m) => m.uid),
      monthlyReports,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      transactionCount: transactions.length,
    });

    await householdRef.set(
      {
        latestReportId: reportRef.id,
        lastAnalyzedAt: admin.firestore.FieldValue.serverTimestamp(),
        reportStatus: isComplete ? "complete" : "partial",
      },
      { merge: true },
    );

    return NextResponse.json({
      success: true,
      reportId: reportRef.id,
      status: isComplete ? "complete" : "partial",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not generate report.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
