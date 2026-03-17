/**
 * Kingdom Wealth — Fix accountId on all transactions + documents
 *
 * WHAT HAPPENED:
 *   The import stored accountSnapshot (embedded account info) correctly,
 *   but forgot to write the accountId field (Firestore account doc ID).
 *   All 652 transactions have accountId = undefined.
 *
 * THIS FIX:
 *   1. Load all 8 account docs → build (last4 + nickname) → docId lookup
 *   2. For each transaction: read accountSnapshot.last4 + nickname → find docId
 *   3. Write accountId to every transaction
 *   4. Also write accountDocId to every document record
 *
 * Run: node fix_account_links.js
 */

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunk(arr, n) {
  const o = [];
  for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n));
  return o;
}

// ── Helper: match account doc from statement metadata ────────────
function norm(s) { return String(s || '').toLowerCase(); }
function isGabriel(holder) { return norm(holder).includes('gabriel'); }
function isVictoria(holder) {
  const h = norm(holder);
  return h.includes('victoria') || h.includes('wise');
}

function matchAccountDoc(accounts, stmt) {
  // stmt has: bankName, accountLast4, accountType, accountHolder, assignedTo, accountId(external)
  const bank   = norm(stmt.bankName || '');
  const l4     = String(stmt.accountLast4 || '');
  const type   = norm(stmt.accountType || '');
  const holder = String(stmt.accountHolder || '');
  const joint  = stmt.assignedTo === 'joint';
  const extId  = String(stmt.accountId || '');  // e.g. "1070136-S0000"

  // PNC
  if (bank.includes('pnc') && isGabriel(holder))
    return accounts.find(a => a.last4 === '8376');

  // Credit One — distinguish by last4
  if (bank.includes('credit one') && isGabriel(holder)) {
    if (l4 === '9427') return accounts.find(a => a.last4 === '9427');
    if (l4 === '7518') return accounts.find(a => a.last4 === '7518');
  }

  if (bank.includes('citadel')) {
    // Joint accounts — by external accountId or last4
    if (joint || extId.includes('S0000'))
      return accounts.find(a => a.last4 === 'S000' && a.owner === 'joint');
    if (joint || extId.includes('S0070') || l4 === '0070')
      return accounts.find(a => a.last4 === '0070' && a.owner === 'joint');

    // Victoria credit card
    if (type === 'credit' && isVictoria(holder))
      return accounts.find(a => a.last4 === '4494');

    // Victoria savings/checking compound statement (last4=5668)
    // — individual transactions inside use subAccount field
    // We resolve these per-transaction via accountSnapshot.last4

    // Victoria savings direct
    if (l4 === '0000' && isVictoria(holder) && !joint)
      return accounts.find(a => a.last4 === '0000' && a.ownerName === 'Victoria');

    // Victoria growth checking
    if ((l4 === '0071' || l4 === '0070') && isVictoria(holder) && !joint)
      return accounts.find(a => a.last4 === '0071');
  }

  return null;
}

async function main() {
  console.log('🔧 Fix accountId on transactions + documents\n');

  const base = db.collection('households').doc(HOUSEHOLD_ID);

  // ── 1. Load all account docs ─────────────────────────────────
  console.log('📦 Loading accounts...');
  const accSnap = await base.collection('accounts').get();
  const accounts = accSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`   Found ${accounts.length} accounts:\n`);

  // Build lookup maps
  const byLast4Nickname = new Map();  // "last4|nickname" → id
  const byLast4         = new Map();  // last4 → [ids]  (may have duplicates like 0000)

  for (const acc of accounts) {
    const key = `${acc.last4}|${acc.nickname}`;
    byLast4Nickname.set(key, acc.id);
    if (!byLast4.has(acc.last4)) byLast4.set(acc.last4, []);
    byLast4.get(acc.last4).push(acc);
    console.log(`   ••${acc.last4.padEnd(5)} ${acc.nickname.padEnd(28)} → ${acc.id}`);
  }

  // ── 2. Fix transactions ──────────────────────────────────────
  console.log('\n📋 Loading transactions...');
  const txSnap = await base.collection('transactions').get();
  console.log(`   Found ${txSnap.size} transactions`);

  let fixed = 0, skipped = 0, noMatch = 0;
  const noMatchSamples = [];

  const txChunks = chunk(txSnap.docs, 400);
  for (const ch of txChunks) {
    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of ch) {
      const data = doc.data();

      // Already has accountId? Skip
      if (data.accountId) { skipped++; continue; }

      // Read from accountSnapshot
      const snap = data.accountSnapshot || {};
      const snapLast4    = String(snap.last4 || '');
      const snapNickname = String(snap.nickname || '');

      // Try exact match first: last4 + nickname
      let accountId = byLast4Nickname.get(`${snapLast4}|${snapNickname}`);

      // Fallback: last4 only (if unique)
      if (!accountId && byLast4.has(snapLast4)) {
        const candidates = byLast4.get(snapLast4);
        if (candidates.length === 1) {
          accountId = candidates[0].id;
        } else {
          // Multiple accounts with same last4 (e.g. 0000 = Victoria Savings + Cofre Wise)
          // Disambiguate by ownerName from accountSnapshot or assignedToName
          const ownerHint = String(data.assignedToName || '').toLowerCase();
          const matched = candidates.find(a => {
            const on = String(a.ownerName || '').toLowerCase();
            return on === ownerHint || on.includes(ownerHint) || ownerHint.includes(on);
          });
          if (matched) accountId = matched.id;
        }
      }

      if (!accountId) {
        noMatch++;
        if (noMatchSamples.length < 10) {
          noMatchSamples.push({
            date: data.date, desc: (data.desc || '').slice(0, 30),
            snapLast4, snapNickname, assignedToName: data.assignedToName,
          });
        }
        continue;
      }

      batch.update(doc.ref, { accountId });
      batchWrites++;
      fixed++;
    }

    if (batchWrites > 0) {
      await batch.commit();
      await sleep(200);
    }
    process.stdout.write(`   Progress: ${fixed} fixed...\r`);
  }

  console.log(`\n   ✅ Fixed:    ${fixed}`);
  console.log(`   ➡  Skipped:  ${skipped} (already had accountId)`);
  console.log(`   ⚠️  No match: ${noMatch}`);
  if (noMatchSamples.length) {
    console.log('\n   Sample unmatched:');
    noMatchSamples.forEach(s =>
      console.log(`     ${s.date} | ${s.desc.padEnd(32)} | snap=••${s.snapLast4} "${s.snapNickname}" | owner=${s.assignedToName}`)
    );
  }

  // ── 3. Fix documents collection ─────────────────────────────
  console.log('\n📄 Fixing document records...');
  const docSnap = await base.collection('documents').get();
  let docFixed = 0, docNoMatch = 0;

  const docChunks = chunk(docSnap.docs, 200);
  for (const ch of docChunks) {
    const batch = db.batch();
    let batchWrites = 0;

    for (const doc of ch) {
      const data = doc.data();
      const acc = matchAccountDoc(accounts, data);
      if (acc) {
        batch.update(doc.ref, { accountDocId: acc.id });
        batchWrites++;
        docFixed++;
      } else {
        docNoMatch++;
        console.log(`   ⚠️  No account match: ${data.fileName} (••${data.accountLast4} ${data.bankName})`);
      }
    }

    if (batchWrites > 0) {
      await batch.commit();
      await sleep(150);
    }
  }
  console.log(`   ✅ Documents fixed: ${docFixed}  |  No match: ${docNoMatch}`);

  // ── 4. Verify ────────────────────────────────────────────────
  console.log('\n🔍 Verifying...');
  const verifySnap = await base.collection('transactions').get();
  const withAccId = verifySnap.docs.filter(d => d.data().accountId).length;
  const stillMissing = verifySnap.size - withAccId;

  console.log(`\n${'═'.repeat(50)}`);
  console.log('✅  FIX COMPLETE');
  console.log('═'.repeat(50));
  console.log(`   Transactions with accountId:    ${withAccId} / ${verifySnap.size}`);
  console.log(`   Transactions still missing:     ${stillMissing}`);
  console.log(`   Documents fixed:                ${docFixed}`);
  if (stillMissing > 0) {
    console.log(`\n   ⚠️  ${stillMissing} transactions still have no accountId.`);
    console.log('   These likely came from statements with no account match.');
    console.log('   Run inspect_firestore.js again to see which ones.');
  }
  console.log();
}

main().catch(e => { console.error('\n❌', e.message, '\n', e.stack); process.exit(1); });
