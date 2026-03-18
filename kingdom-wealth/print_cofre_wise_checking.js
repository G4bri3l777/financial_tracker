/**
 * Kingdom Wealth — Print Cofre Wise Checking transactions + full metadata
 * Run: node print_cofre_wise_checking.js
 */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

const fmt = (v) => {
  if (v === null || v === undefined) return 'null';
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0,19);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

async function main() {
  const base = db.collection('households').doc(HOUSEHOLD_ID);

  // ── 1. Find Cofre Wise Checking account ───────────────────────
  const accSnap = await base.collection('accounts').get();
  const account = accSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(a =>
      (a.nickname || '').toLowerCase().includes('cofre wise checking') ||
      (a.last4 === '0070') ||
      (a.nickname || '').toLowerCase().includes('checking') && (a.bankName || '').toLowerCase().includes('citadel')
    );

  if (!account) {
    console.error('❌ Cofre Wise Checking not found. Available accounts:');
    accSnap.docs.forEach(d => {
      const x = d.data();
      console.log(`  ${d.id}  ${x.nickname}  ${x.bankName}  ••${x.last4}`);
    });
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('ACCOUNT');
  console.log('══════════════════════════════════════════════════════════');
  Object.entries(account).forEach(([k, v]) => console.log(`  ${k.padEnd(22)} = ${fmt(v)}`));

  // ── 2. Get ALL transactions for this account ──────────────────
  const txSnap = await base.collection('transactions')
    .where('accountId', '==', account.id)
    .get();

  const txns = txSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`ALL TRANSACTIONS (${txns.length} total)`);
  console.log('══════════════════════════════════════════════════════════');

  // Totals
  let totalIncome = 0, totalExpenses = 0, totalTransfersOut = 0, totalTransfersIn = 0;

  txns.forEach((tx, i) => {
    const amount = Math.abs(Number(tx.amount || 0));
    const sign   = tx.direction === 'credit' ? '+' : '-';

    if (tx.type === 'income')                                        totalIncome      += amount;
    if (tx.type === 'expense')                                       totalExpenses    += amount;
    if (tx.type === 'transfer' && tx.direction === 'debit')          totalTransfersOut += amount;
    if (tx.type === 'transfer' && tx.direction === 'credit')         totalTransfersIn  += amount;

    console.log(`\n  [${String(i+1).padStart(3)}] ${tx.date}  ${sign}$${amount.toFixed(2).padStart(9)}  ${String(tx.type).padEnd(10)} ${String(tx.direction).padEnd(7)}`);
    console.log(`        desc:         ${tx.desc}`);
    console.log(`        merchantName: ${tx.merchantName || '(none)'}`);
    console.log(`        category:     ${tx.category || '(none)'}${tx.subcat ? ' › ' + tx.subcat : ''}`);
    console.log(`        transferType: ${tx.transferType || '(none)'}`);
    console.log(`        transferPair: ${tx.transferPairId || '(none)'}`);
    console.log(`        from→to:      ${tx.transferFromAccountId || '?'} → ${tx.transferToAccountId || '?'}`);
    console.log(`        reviewed:     ${tx.reviewed}  flagged: ${tx.flagged}${tx.flagReason ? ' — ' + tx.flagReason : ''}`);
    console.log(`        sourceDocId:  ${tx.sourceDocId || '(manual)'}`);
    console.log(`        addedManually:${tx.addedManually}`);
    console.log(`        assignedTo:   ${tx.assignedToName} (${tx.assignedTo})`);
  });

  // ── 3. Summary ────────────────────────────────────────────────
  const byMonth = {};
  txns.forEach(tx => {
    const m = String(tx.month || tx.date?.slice(0,7) || 'unknown');
    if (!byMonth[m]) byMonth[m] = { income: 0, expenses: 0, transfersOut: 0, transfersIn: 0 };
    const amt = Math.abs(Number(tx.amount || 0));
    if (tx.type === 'income')                               byMonth[m].income      += amt;
    if (tx.type === 'expense')                              byMonth[m].expenses    += amt;
    if (tx.type === 'transfer' && tx.direction === 'debit') byMonth[m].transfersOut += amt;
    if (tx.type === 'transfer' && tx.direction === 'credit')byMonth[m].transfersIn  += amt;
  });

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Total transactions: ${txns.length}`);
  console.log(`  Income:             $${totalIncome.toFixed(2)}`);
  console.log(`  Expenses:           $${totalExpenses.toFixed(2)}`);
  console.log(`  Transfers OUT:      $${totalTransfersOut.toFixed(2)}`);
  console.log(`  Transfers IN:       $${totalTransfersIn.toFixed(2)}`);
  console.log(`  Net (income-exp):   $${(totalIncome - totalExpenses).toFixed(2)}`);

  console.log('\n  BY MONTH:');
  Object.entries(byMonth).sort().forEach(([m, v]) => {
    console.log(`    ${m}  income=$${v.income.toFixed(2).padStart(9)}  exp=$${v.expenses.toFixed(2).padStart(9)}  xferOut=$${v.transfersOut.toFixed(2).padStart(9)}  xferIn=$${v.transfersIn.toFixed(2).padStart(9)}`);
  });

  console.log('\n  BY CATEGORY (expenses only):');
  const byCat = {};
  txns.filter(t => t.type === 'expense').forEach(t => {
    const cat = String(t.category || 'Uncategorized');
    byCat[cat] = (byCat[cat] || 0) + Math.abs(Number(t.amount || 0));
  });
  Object.entries(byCat)
    .sort((a, b) => b[1] - a[1])
    .forEach(([cat, amt]) => console.log(`    ${cat.padEnd(20)}  $${amt.toFixed(2)}`));

  console.log('\n  TYPES BREAKDOWN:');
  const byType = {};
  txns.forEach(t => {
    const key = `${t.type}/${t.direction}`;
    byType[key] = (byType[key] || 0) + 1;
  });
  Object.entries(byType).sort().forEach(([k, n]) => {
    console.log(`    ${k.padEnd(25)}  ${n} transactions`);
  });
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
