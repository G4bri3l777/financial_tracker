/**
 * Kingdom Wealth — Auto-Link Transfer Pairs
 *
 * Scans all transactions and automatically pairs transfer transactions
 * that represent the same money movement (e.g. PNC pays Blue Card).
 *
 * MATCHING RULES:
 *   - Both transactions: type = 'transfer'
 *   - One: direction = 'debit'  (money left this account)
 *   - Other: direction = 'credit' (money arrived in this account)
 *   - Amount matches within $0.05
 *   - Dates within 5 days of each other
 *   - Different accountIds
 *
 * WHAT IT WRITES:
 *   transferPairId          shared UUID linking both sides
 *   transferFromAccountId   Firestore account doc ID of the sender
 *   transferToAccountId     Firestore account doc ID of the receiver
 *
 * Run: node link_transfer_pairs.js
 */

const admin = require('firebase-admin');
const { v4: uuidv4 } = require('uuid');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';
const MAX_DAYS = 5;
const MAX_AMOUNT_DIFF = 0.05;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunk(arr, n) {
  const o = []; for (let i=0;i<arr.length;i+=n) o.push(arr.slice(i,i+n)); return o;
}

function daysBetween(d1, d2) {
  try {
    const a = new Date(d1), b = new Date(d2);
    return Math.abs((a - b) / 86400000);
  } catch { return 999; }
}

async function main() {
  console.log('🔗 Auto-Link Transfer Pairs\n');

  const base = db.collection('households').doc(HOUSEHOLD_ID);

  // ── Load accounts ─────────────────────────────────────────────
  const accSnap = await base.collection('accounts').get();
  const accountsById = {};
  accSnap.docs.forEach(d => { accountsById[d.id] = { id: d.id, ...d.data() }; });
  console.log(`📦 Loaded ${accSnap.size} accounts`);

  // ── Load ALL transfer transactions ────────────────────────────
  const txSnap = await base.collection('transactions')
    .where('type', '==', 'transfer')
    .get();
  console.log(`📋 Found ${txSnap.size} transfer transactions\n`);

  const transfers = txSnap.docs.map(d => ({ firestoreId: d.id, ...d.data() }));

  // Separate into debits (senders) and credits (receivers)
  const debits  = transfers.filter(t => t.direction === 'debit');
  const credits = transfers.filter(t => t.direction === 'credit');

  console.log(`   Debit  (sending):    ${debits.length}`);
  console.log(`   Credit (receiving):  ${credits.length}`);
  console.log(`   Already paired:      ${transfers.filter(t => t.transferPairId).length}\n`);

  // ── Match pairs ───────────────────────────────────────────────
  const paired = new Set();   // firestoreIds already matched
  const pairings = [];        // { debitId, creditId, pairId, fromAccId, toAccId, amount, date }

  for (const debit of debits) {
    if (paired.has(debit.firestoreId)) continue;
    if (debit.transferPairId) continue; // already paired

    for (const credit of credits) {
      if (paired.has(credit.firestoreId)) continue;
      if (credit.transferPairId) continue;

      // Must be different accounts
      if (debit.accountId && credit.accountId && debit.accountId === credit.accountId) continue;

      // Amount match
      if (Math.abs(debit.amount - credit.amount) > MAX_AMOUNT_DIFF) continue;

      // Date match
      if (daysBetween(debit.date, credit.date) > MAX_DAYS) continue;

      // Found a pair!
      const pairId = uuidv4().slice(0, 8).toUpperCase();
      pairings.push({
        debitId:    debit.firestoreId,
        creditId:   credit.firestoreId,
        pairId,
        fromAccId:  debit.accountId  || null,
        toAccId:    credit.accountId || null,
        amount:     debit.amount,
        debitDate:  debit.date,
        creditDate: credit.date,
        debitDesc:  (debit.merchantName  || debit.desc  || '').slice(0, 35),
        creditDesc: (credit.merchantName || credit.desc || '').slice(0, 35),
        debitAcc:   debit.accountId  ? (accountsById[debit.accountId]?.nickname  || '?') : '?',
        creditAcc:  credit.accountId ? (accountsById[credit.accountId]?.nickname || '?') : '?',
      });

      paired.add(debit.firestoreId);
      paired.add(credit.firestoreId);
      break; // move on to next debit
    }
  }

  // ── Preview ───────────────────────────────────────────────────
  console.log(`Found ${pairings.length} new transfer pairs to link:\n`);
  for (const p of pairings) {
    console.log(`  PAIR ${p.pairId}  $${p.amount.toFixed(2)}`);
    console.log(`    SEND  ${p.debitDate}  ${p.debitAcc.padEnd(25)}  "${p.debitDesc}"`);
    console.log(`    RECV  ${p.creditDate}  ${p.creditAcc.padEnd(25)}  "${p.creditDesc}"`);
    console.log();
  }

  // Find unpaired transfers
  const unpairedDebits  = debits.filter(t => !paired.has(t.firestoreId) && !t.transferPairId);
  const unpairedCredits = credits.filter(t => !paired.has(t.firestoreId) && !t.transferPairId);
  console.log(`Unpaired after matching:`);
  console.log(`  Debit  (sending, no match):   ${unpairedDebits.length}`);
  console.log(`  Credit (receiving, no match): ${unpairedCredits.length}`);

  if (unpairedDebits.length > 0) {
    console.log('\nUnpaired DEBIT transfers (sending side only — other statement not imported yet):');
    for (const t of unpairedDebits.slice(0, 10)) {
      const acc = t.accountId ? (accountsById[t.accountId]?.nickname || '?') : '⚠️ no account';
      console.log(`  ${t.date}  ${acc.padEnd(25)}  $${t.amount.toFixed(2)}  "${(t.merchantName||t.desc||'').slice(0,35)}"`);
    }
  }

  if (pairings.length === 0) {
    console.log('\nNo new pairs found — nothing to write.');
    return;
  }

  // ── Write to Firestore ────────────────────────────────────────
  console.log(`\n✍️  Writing ${pairings.length * 2} updates to Firestore...`);
  let written = 0;

  const updates = [];
  for (const p of pairings) {
    updates.push({ id: p.debitId,  patch: {
      transferPairId:        p.pairId,
      transferFromAccountId: p.fromAccId,
      transferToAccountId:   p.toAccId,
    }});
    updates.push({ id: p.creditId, patch: {
      transferPairId:        p.pairId,
      transferFromAccountId: p.fromAccId,
      transferToAccountId:   p.toAccId,
    }});
  }

  for (const ch of chunk(updates, 400)) {
    const batch = db.batch();
    for (const u of ch) {
      // Strip nulls
      const patch = Object.fromEntries(
        Object.entries(u.patch).filter(([,v]) => v !== null && v !== undefined)
      );
      batch.update(base.collection('transactions').doc(u.id), patch);
      written++;
    }
    await batch.commit();
    await sleep(200);
    process.stdout.write(`  Progress: ${written}/${updates.length}...\r`);
  }

  // ── Summary ───────────────────────────────────────────────────
  console.log(`\n\n${'═'.repeat(50)}`);
  console.log('✅  PAIR LINKING COMPLETE');
  console.log('═'.repeat(50));
  console.log(`  New pairs linked:      ${pairings.length}`);
  console.log(`  Transactions updated:  ${written}`);
  console.log(`  Still unpaired debits: ${unpairedDebits.length}`);
  console.log();
  console.log('The review page will now show transfer flow arrows.');
  console.log('MoneyFlowSection will show "Money Moved" totals.');
  console.log();

  // ── Flow summary ──────────────────────────────────────────────
  const flowTotals = {};
  for (const p of pairings) {
    const key = `${p.debitAcc} → ${p.creditAcc}`;
    if (!flowTotals[key]) flowTotals[key] = { count: 0, total: 0 };
    flowTotals[key].count++;
    flowTotals[key].total += p.amount;
  }
  console.log('Flow summary:');
  for (const [key, v] of Object.entries(flowTotals).sort((a,b) => b[1].total - a[1].total)) {
    console.log(`  ${key.padEnd(50)}  ${v.count}× = $${v.total.toFixed(2)}`);
  }
}

main().catch(e => { console.error('\n❌', e.message, '\n', e.stack); process.exit(1); });
