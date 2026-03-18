/**
 * Kingdom Wealth — Trace exactly what data feeds the categories wheel
 * This replicates the categoryData computation from the dashboard
 * Run: node trace_categories_data.js
 */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

async function main() {
  const base = db.collection('households').doc(HOUSEHOLD_ID);

  const txSnap = await base.collection('transactions').get();
  const allTxns = txSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  console.log(`\nTotal transactions in Firestore: ${allTxns.length}`);

  // ── Replicate dashboard filter logic ─────────────────────────
  // The categories wheel uses `filtered` transactions.
  // With NO sidebar filters applied, filtered = all transactions.
  // categoryData = expenses grouped by category from filtered.

  // Step 1: What counts as an expense for the wheel?
  const expenses = allTxns.filter(t => t.type === 'expense');
  console.log(`\nExpenses (type=expense): ${expenses.length}`);

  // Step 2: Group by category
  const byCat: Record<string, { amount: number; count: number; transactions: any[] }> = {};
  expenses.forEach(tx => {
    const cat = String(tx.category || 'Uncategorized');
    if (!byCat[cat]) byCat[cat] = { amount: 0, count: 0, transactions: [] };
    byCat[cat].amount += Math.abs(Number(tx.amount || 0));
    byCat[cat].count++;
    byCat[cat].transactions.push(tx);
  });

  const totalExpenses = Object.values(byCat).reduce((s, v) => s + v.amount, 0);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('CATEGORIES WHEEL DATA (what the dashboard shows)');
  console.log(`Total expenses: $${totalExpenses.toFixed(2)}`);
  console.log('══════════════════════════════════════════════════════════');

  const sorted = Object.entries(byCat).sort((a, b) => b[1].amount - a[1].amount);

  sorted.forEach(([cat, data], i) => {
    const pct = totalExpenses > 0 ? (data.amount / totalExpenses * 100).toFixed(1) : '0.0';
    console.log(`\n  ${String(i+1).padStart(2)}. ${cat.padEnd(22)} $${data.amount.toFixed(2).padStart(10)}  ${pct.padStart(5)}%  (${data.count} txns)`);

    // Show top 3 transactions per category
    const top3 = data.transactions
      .sort((a, b) => Math.abs(Number(b.amount)) - Math.abs(Number(a.amount)))
      .slice(0, 3);
    top3.forEach(tx => {
      console.log(`       ${tx.date}  $${Math.abs(Number(tx.amount)).toFixed(2).padStart(9)}  ${(tx.merchantName || tx.desc || '').slice(0,35)}`);
    });
    if (data.count > 3) console.log(`       ... and ${data.count - 3} more`);
  });

  // ── What does NOT appear in the wheel ────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('EXCLUDED FROM WHEEL (not type=expense)');
  console.log('══════════════════════════════════════════════════════════');

  const nonExpenses = allTxns.filter(t => t.type !== 'expense');
  const byType: Record<string, number> = {};
  nonExpenses.forEach(t => {
    const key = `${t.type}/${t.direction || '?'}`;
    byType[key] = (byType[key] || 0) + 1;
  });
  Object.entries(byType).sort().forEach(([k, n]) => {
    const total = nonExpenses
      .filter(t => `${t.type}/${t.direction || '?'}` === k)
      .reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
    console.log(`  ${k.padEnd(30)} ${n} txns  $${total.toFixed(2)}`);
  });

  // ── Uncategorized check ───────────────────────────────────────
  const uncategorized = expenses.filter(t => !t.category || t.category === 'Uncategorized');
  if (uncategorized.length > 0) {
    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`UNCATEGORIZED EXPENSES (${uncategorized.length}) — these appear in the wheel as "Uncategorized"`);
    console.log('══════════════════════════════════════════════════════════');
    uncategorized.slice(0, 20).forEach(tx => {
      console.log(`  ${tx.date}  $${Math.abs(Number(tx.amount)).toFixed(2).padStart(9)}  ${(tx.desc || '').slice(0,40)}  account:${tx.accountId?.slice(0,8)}`);
    });
    if (uncategorized.length > 20) console.log(`  ... and ${uncategorized.length - 20} more`);
  }

  // ── Filter simulation: what changes when you filter by account ─
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('CATEGORIES WHEN FILTERED TO EACH ACCOUNT');
  console.log('══════════════════════════════════════════════════════════');

  const accSnap = await base.collection('accounts').get();
  const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  for (const acc of accounts) {
    const accExpenses = expenses.filter(t => t.accountId === acc.id);
    if (accExpenses.length === 0) continue;
    const accTotal = accExpenses.reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
    const cats = Object.entries(
      accExpenses.reduce((acc2: Record<string, number>, t) => {
        const c = String(t.category || 'Uncategorized');
        acc2[c] = (acc2[c] || 0) + Math.abs(Number(t.amount || 0));
        return acc2;
      }, {})
    ).sort((a, b) => b[1] - a[1]).slice(0, 3);

    console.log(`\n  ${(acc as any).nickname} (${accExpenses.length} txns, $${accTotal.toFixed(2)}):`);
    cats.forEach(([c, v]) => {
      console.log(`    ${c.padEnd(20)} $${v.toFixed(2).padStart(9)}`);
    });
  }
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
