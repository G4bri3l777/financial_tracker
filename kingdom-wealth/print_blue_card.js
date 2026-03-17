/**
 * Kingdom Wealth — Print Blue Card Transactions + Full Metadata
 *
 * Run: node print_blue_card.js
 */

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

function fmt(v) {
  if (v === null || v === undefined) return 'null';
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0, 19);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function main() {
  const base = db.collection('households').doc(HOUSEHOLD_ID);

  // ── 1. Find Blue Card account ─────────────────────────────────
  const accSnap = await base.collection('accounts').get();
  const blueCard = accSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .find(a => a.last4 === '9427' || a.nickname === 'Blue Card');

  if (!blueCard) {
    console.error('❌ Blue Card not found in accounts');
    process.exit(1);
  }

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('BLUE CARD ACCOUNT');
  console.log('══════════════════════════════════════════════════════════');
  Object.entries(blueCard).forEach(([k, v]) => {
    console.log(`  ${k.padEnd(22)} = ${fmt(v)}`);
  });

  // ── 2. Find latest statement document for Blue Card ───────────
  const docsSnap = await base.collection('documents').get();
  const cardDocs = docsSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(d => d.accountDocId === blueCard.id)
    .sort((a, b) => (b.statementEnd || '').localeCompare(a.statementEnd || ''));

  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`STATEMENT DOCUMENTS (${cardDocs.length} total, showing latest)`);
  console.log('══════════════════════════════════════════════════════════');

  const latestDoc = cardDocs[0];
  if (!latestDoc) {
    console.log('  No statement documents found for Blue Card');
  } else {
    Object.entries(latestDoc).forEach(([k, v]) => {
      if (k !== 'parserNotes') console.log(`  ${k.padEnd(22)} = ${fmt(v)}`);
    });
    if (latestDoc.parserNotes) {
      console.log(`\n  parserNotes:\n    ${latestDoc.parserNotes.replace(/\. /g, '.\n    ')}`);
    }
  }

  const stmtStart = latestDoc?.statementStart ?? '';
  const stmtEnd   = latestDoc?.statementEnd   ?? '';

  // ── 3. Get ALL transactions for Blue Card ─────────────────────
  const txSnap = await base.collection('transactions')
    .where('accountId', '==', blueCard.id)
    .get();

  const allTxns = txSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));

  // Categorize
  const stmtTxns = stmtStart && stmtEnd
    ? allTxns.filter(t => t.date >= stmtStart && t.date <= stmtEnd)
    : allTxns;
  const newTxns  = stmtEnd
    ? allTxns.filter(t => t.date > stmtEnd)
    : [];
  const beforeTxns = stmtStart
    ? allTxns.filter(t => t.date < stmtStart)
    : [];

  // ── 4. Print statement-period transactions ────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log(`TRANSACTIONS IN STATEMENT PERIOD (${stmtStart} → ${stmtEnd})`);
  console.log(`${stmtTxns.length} transactions`);
  console.log('══════════════════════════════════════════════════════════');

  let stmtCharged = 0, stmtPaid = 0, stmtRefunded = 0;

  stmtTxns.forEach((tx, i) => {
    const sign = tx.direction === 'credit' ? '+' : '-';
    const amount = Math.abs(Number(tx.amount || 0));

    if (tx.direction === 'debit'  && tx.type === 'expense')  stmtCharged  += amount;
    if (tx.direction === 'credit' && tx.type === 'transfer') stmtPaid     += amount;
    if (tx.direction === 'credit' && tx.type === 'refund')   stmtRefunded += amount;

    console.log(`\n  [${i + 1}] ${tx.date}  ${sign}$${amount.toFixed(2).padStart(8)}  ${tx.type}/${tx.direction}`);
    console.log(`      merchantName:    ${tx.merchantName || '(none)'}`);
    console.log(`      desc:            ${tx.desc}`);
    console.log(`      category:        ${tx.category || '(none)'}${tx.subcat ? ' › ' + tx.subcat : ''}`);
    console.log(`      transferType:    ${tx.transferType || '(none)'}`);
    console.log(`      transferPairId:  ${tx.transferPairId || '(none)'}`);
    console.log(`      isSubscription:  ${tx.isSubscription}`);
    console.log(`      confidence:      ${tx.confidence}`);
    console.log(`      reviewed:        ${tx.reviewed}`);
    console.log(`      flagged:         ${tx.flagged}${tx.flagReason ? ' — ' + tx.flagReason : ''}`);
    console.log(`      sourceDocId:     ${tx.sourceDocId || '(none)'}`);
    console.log(`      accountId:       ${tx.accountId}`);
    console.log(`      assignedTo:      ${tx.assignedToName} (${tx.assignedTo})`);
    console.log(`      addedManually:   ${tx.addedManually}`);
  });

  // ── 5. Statement math ─────────────────────────────────────────
  const stmtOpening = Number(latestDoc?.openingBalance ?? 0);
  const stmtClosing = Number(latestDoc?.closingBalance ?? 0);
  const identityCharged = Math.max(0, stmtClosing - stmtOpening + stmtPaid + stmtRefunded);

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('STATEMENT MATH');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Opening balance (statement):  $${stmtOpening.toFixed(2)}`);
  console.log(`  Closing balance (statement):  $${stmtClosing.toFixed(2)}`);
  console.log();
  console.log(`  From transactions:`);
  console.log(`    Charged  (expense+debit):   $${stmtCharged.toFixed(2)}`);
  console.log(`    Paid     (transfer+credit): $${stmtPaid.toFixed(2)}`);
  console.log(`    Refunded (refund+credit):   $${stmtRefunded.toFixed(2)}`);
  console.log();
  console.log(`  Accounting identity check:`);
  console.log(`    closing = opening + charged - paid - refunded`);
  console.log(`    $${stmtClosing} = $${stmtOpening} + X - $${stmtPaid} - $${stmtRefunded}`);
  console.log(`    X (should be charged) = $${identityCharged.toFixed(2)}`);
  console.log();
  const diff = stmtCharged - identityCharged;
  if (Math.abs(diff) > 0.05) {
    console.log(`  ⚠️  DISCREPANCY: transactions sum $${stmtCharged.toFixed(2)} vs identity $${identityCharged.toFixed(2)}`);
    console.log(`      Difference: $${Math.abs(diff).toFixed(2)}`);
    console.log(`      This means $${Math.abs(diff).toFixed(2)} in transactions are`);
    console.log(`      ${diff > 0 ? 'portal data NOT captured in the statement closing balance' : 'missing from Firestore'}`);
  } else {
    console.log(`  ✅ Transactions reconcile with statement balance`);
  }

  // ── 6. New activity (after statement) ─────────────────────────
  if (newTxns.length > 0) {
    const newCharged = newTxns
      .filter(t => t.direction === 'debit'  && t.type === 'expense')
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const newPaid = newTxns
      .filter(t => t.direction === 'credit' && t.type === 'transfer')
      .reduce((s, t) => s + Math.abs(Number(t.amount)), 0);

    console.log('\n══════════════════════════════════════════════════════════');
    console.log(`NEW ACTIVITY AFTER STATEMENT (${newTxns.length} transactions)`);
    console.log('══════════════════════════════════════════════════════════');
    newTxns.forEach(tx => {
      const sign = tx.direction === 'credit' ? '+' : '-';
      const amount = Math.abs(Number(tx.amount || 0));
      console.log(`  ${tx.date}  ${sign}$${amount.toFixed(2).padStart(8)}  ${tx.type}  ${tx.merchantName || tx.desc}`);
    });
    console.log(`\n  New charges: $${newCharged.toFixed(2)}`);
    console.log(`  New payments: $${newPaid.toFixed(2)}`);
    console.log(`  Estimated current balance: $${(stmtClosing + newCharged - newPaid).toFixed(2)}`);
  } else {
    console.log('\n  No new activity after statement end date.');
    console.log(`  Estimated current balance = statement closing = $${stmtClosing.toFixed(2)}`);
  }

  // ── 7. Summary ────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════');
  console.log('SUMMARY');
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  Total transactions on card:  ${allTxns.length}`);
  console.log(`  In statement period:         ${stmtTxns.length}`);
  console.log(`  After statement:             ${newTxns.length}`);
  console.log(`  Before statement:            ${beforeTxns.length}`);
  console.log(`  Credit limit:                $${Number(blueCard.creditLimit || 0).toFixed(2)}`);
  console.log(`  Est. current balance:        $${stmtClosing.toFixed(2)}`);
  console.log(`  Utilization:                 ${Math.round((stmtClosing / Number(blueCard.creditLimit || 1)) * 100)}%`);
  console.log();
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
