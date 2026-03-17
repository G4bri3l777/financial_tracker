/**
 * Kingdom Wealth — Full Reset + Import from Parsed JSON Statements
 *
 * SETUP:
 *   1. Place this file in kingdom-wealth/
 *   2. Place serviceAccountKey.json alongside it
 *   3. Create kingdom-wealth/statements/ folder
 *   4. Drop all parsed JSON files into statements/
 *   5. npm install firebase-admin
 *   6. node reset_and_import.js
 *
 * SUPPORTED JSON STATEMENT SHAPES:
 *   - Standard statement  { statement: {...}, transactions: [...] }
 *   - With subAccounts    { statement: { subAccounts: [...] }, transactions: [{ subAccount: "id" }] }
 *   - With accountId      { statement: { accountId: "1070136-S0000", assignedTo: "joint" } }
 */

const admin = require('firebase-admin');
const fs    = require('fs');
const path  = require('path');

admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

// ── CONFIG ────────────────────────────────────────────────────────
const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

const MEMBER_UIDS = {
  Gabriel:  'PiodEsluqIWCtCU2XIZddzH2pbm1',
  Victoria: 'aoz7QAmuyxfyr369jUM8HZJvb9k1',
  Joint:    'joint',
};

// ── ACCOUNT DEFINITIONS ───────────────────────────────────────────
// Source of truth for all accounts.
// matchRules tells the importer which JSON statement maps to this account.
const ACCOUNT_DEFS = [

  // ── GABRIEL ──────────────────────────────────────────────────────
  {
    key:         'pnc-checking',
    nickname:    'Checking PNC',
    bankName:    'PNC Bank',
    last4:       '8376',        // bank account number
    cardLast4:   '6910',        // debit card printed on card
    type:        'checking',
    subtype:     'checking',
    creditLimit: null,
    owner:       'Gabriel',
    color:       '#1B2A4A',
    // match: any PNC statement for Gabriel (by account OR card number)
    match: (stmt) =>
      norm(stmt.bankName).includes('pnc') &&
      isGabriel(stmt),
  },
  {
    key:         'credit-one-blue',
    nickname:    'Blue Card',
    bankName:    'Credit One Bank',
    last4:       '9427',
    cardLast4:   '9427',
    type:        'credit',
    subtype:     '',
    creditLimit: 800,
    owner:       'Gabriel',
    color:       '#3B82F6',
    match: (stmt) =>
      norm(stmt.bankName).includes('credit one') &&
      isGabriel(stmt) &&
      String(stmt.accountLast4) === '9427',
  },
  {
    key:         'credit-one-green',
    nickname:    'Green Card',
    bankName:    'Credit One Bank',   // both Gabriel cards are Credit One Bank
    last4:       '7518',
    cardLast4:   '7518',
    type:        'credit',
    subtype:     '',
    creditLimit: 2200,                // updated from $1,900 — confirmed on Feb statement
    owner:       'Gabriel',
    color:       '#1B2A4A',
    // match by last4=7518 since both blue (9427) and green (7518) are Credit One Bank
    match: (stmt) =>
      norm(stmt.bankName).includes('credit one') &&
      isGabriel(stmt) &&
      String(stmt.accountLast4) === '7518',
  },

  // ── VICTORIA ─────────────────────────────────────────────────────
  {
    key:         'citadel-victoria-savings',
    nickname:    'Victoria Savings',
    bankName:    'Citadel Credit Union',
    last4:       '0000',        // Star Savings sub-account
    cardLast4:   '0000',
    type:        'savings',
    subtype:     'savings',
    creditLimit: null,
    owner:       'Victoria',
    color:       '#C9A84C',
    // Matched when: Citadel + Victoria + NOT joint + subAccountId=savings-0000
    // OR direct statement with last4=0000 and not joint
    match: (stmt, subAccountId) =>
      norm(stmt.bankName).includes('citadel') &&
      isVictoria(stmt) &&
      stmt.assignedTo !== 'joint' &&
      (subAccountId === 'savings-0000' ||
       (stmt.accountLast4 === '0000' && !stmt.subAccounts)),
  },
  {
    key:         'citadel-victoria-growth',
    nickname:    'Victoria Growth Checking',
    bankName:    'Citadel Credit Union',
    last4:       '0071',
    cardLast4:   '0071',
    type:        'checking',
    subtype:     'growth',
    creditLimit: null,
    owner:       'Victoria',
    color:       '#F97316',
    match: (stmt, subAccountId) =>
      norm(stmt.bankName).includes('citadel') &&
      isVictoria(stmt) &&
      stmt.assignedTo !== 'joint' &&
      (subAccountId === 'checking-0071' ||
       stmt.accountLast4 === '0071'),
  },
  {
    key:         'citadel-victoria-credit',
    nickname:    'Victoria Main Card',
    bankName:    'Citadel Credit Union',
    last4:       '4494',
    cardLast4:   '4494',
    type:        'credit',
    subtype:     '',
    creditLimit: 3000,
    owner:       'Victoria',
    color:       '#C9A84C',
    match: (stmt) =>
      norm(stmt.bankName).includes('citadel') &&
      stmt.accountType === 'credit' &&
      isVictoria(stmt) &&
      stmt.assignedTo !== 'joint',
  },

  // ── JOINT ─────────────────────────────────────────────────────────
  {
    key:         'citadel-joint-savings',
    nickname:    'Cofre Wise Savings',
    bankName:    'Citadel Credit Union',
    last4:       'S000',        // prefix S to distinguish from Victoria ••0000
    cardLast4:   '0000',
    type:        'savings',
    subtype:     'emergency',
    creditLimit: null,
    owner:       'Joint',
    color:       '#14B8A6',
    // match: Citadel + assignedTo=joint + (accountId contains S0000 OR last4=0000)
    match: (stmt) =>
      norm(stmt.bankName).includes('citadel') &&
      stmt.assignedTo === 'joint' &&
      (String(stmt.accountId || '').includes('S0000') ||
       String(stmt.accountLabel || '').includes('0000') ||
       (stmt.accountLast4 === '0000' && stmt.assignedTo === 'joint')),
  },
  {
    key:         'citadel-joint-checking',
    nickname:    'Cofre Wise Checking',
    bankName:    'Citadel Credit Union',
    last4:       '0070',
    cardLast4:   '0070',
    type:        'checking',
    subtype:     'checking',
    creditLimit: null,
    owner:       'Joint',
    color:       '#14B8A6',
    match: (stmt) =>
      norm(stmt.bankName).includes('citadel') &&
      stmt.assignedTo === 'joint' &&
      (String(stmt.accountId || '').includes('S0070') ||
       String(stmt.accountLabel || '').includes('0070') ||
       stmt.accountLast4 === '0070'),
  },
];

// ── MATCH HELPERS ─────────────────────────────────────────────────
function norm(s) { return String(s || '').toLowerCase(); }
function isGabriel(stmt) {
  return norm(stmt.accountHolder).includes('gabriel');
}
function isVictoria(stmt) {
  const h = norm(stmt.accountHolder);
  return h.includes('victoria') || h.includes('wise');
}

// Find account def for a statement + optional subAccountId
function findAccountDef(stmt, subAccountId = null) {
  return ACCOUNT_DEFS.find(def => {
    try { return def.match(stmt, subAccountId); }
    catch { return false; }
  }) || null;
}

// ── HELPERS ──────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunk(arr, n) {
  const o = [];
  for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n));
  return o;
}

async function deleteCollection(ref, label) {
  const snap = await ref.get();
  if (snap.empty) { console.log(`    ${label}: empty`); return 0; }
  for (const ch of chunk(snap.docs, 400)) {
    const b = db.batch();
    ch.forEach(d => b.delete(d.ref));
    await b.commit();
    await sleep(150);
  }
  console.log(`    ✅ Deleted ${snap.size} ${label}`);
  return snap.size;
}

// ── STEP 1 — FULL RESET ───────────────────────────────────────────
async function resetHousehold() {
  console.log('\n🗑️  Resetting household...');
  const base = db.collection('households').doc(HOUSEHOLD_ID);
  const cols  = [
    'transactions','accounts','documents','subcategories',
    'reports','transfers','monthlySnapshots','merchants',
  ];
  for (const col of cols) await deleteCollection(base.collection(col), col);

  await base.update({
    latestReportId: null,
    lastAnalyzedAt: null,
    reportStatus:   null,
    budget:         null,
    updatedAt:      admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('  ✅ Household doc reset\n');
}

// ── STEP 2 — CREATE ACCOUNTS ──────────────────────────────────────
async function createAccounts() {
  console.log('📦 Creating accounts...\n');
  const keyToId = {};     // def.key → Firestore docId
  const keyToDef = {};    // def.key → def

  for (const def of ACCOUNT_DEFS) {
    const ownerUid = MEMBER_UIDS[def.owner] || 'joint';
    const doc = {
      nickname:        def.nickname,
      bankName:        def.bankName,
      last4:           def.last4,
      cardLast4:       def.cardLast4 || def.last4,
      type:            def.type,
      subtype:         def.subtype || '',
      creditLimit:     def.creditLimit ?? null,
      owner:           ownerUid,
      ownerName:       def.owner,
      color:           def.color,
      householdId:     HOUSEHOLD_ID,
      currentBalance:  0,
      createdAt:       admin.firestore.FieldValue.serverTimestamp(),
      updatedAt:       admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await db
      .collection('households').doc(HOUSEHOLD_ID)
      .collection('accounts').add(doc);

    keyToId[def.key]  = ref.id;
    keyToDef[def.key] = { ...def, id: ref.id };
    console.log(`  ✅ ${def.nickname.padEnd(28)} ••${def.last4.padEnd(5)} → ${ref.id}`);
  }

  return { keyToId, keyToDef };
}

// ── STEP 3 — IMPORT STATEMENTS ────────────────────────────────────
async function importStatements(keyToDef) {
  console.log('\n📥 Importing statements...\n');

  const stmtsDir = path.join(__dirname, 'statements');
  if (!fs.existsSync(stmtsDir)) {
    console.error('  ❌ statements/ folder not found');
    return { totalImported: 0, totalFlagged: 0, fileCount: 0 };
  }

  const files = fs.readdirSync(stmtsDir)
    .filter(f => f.endsWith('.json'))
    .sort();

  if (!files.length) {
    console.log('  ⚠️  No JSON files in statements/');
    return { totalImported: 0, totalFlagged: 0, fileCount: 0 };
  }

  let totalImported = 0, totalFlagged = 0;

  for (const file of files) {
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(stmtsDir, file), 'utf8'));
    } catch(e) {
      console.log(`  ❌ ${file}: parse error — ${e.message}`);
      continue;
    }

    const stmt = parsed.statement;
    const txns = parsed.transactions || [];
    console.log(`  📄 ${file}`);
    console.log(`     ${stmt.bankName} ••${stmt.accountLast4} — ${stmt.accountHolder}`);
    console.log(`     Period: ${stmt.statementStart} → ${stmt.statementEnd}`);
    console.log(`     ${txns.length} transactions`);

    // ── Determine accounts this statement covers ─────────────────
    // A statement may cover multiple sub-accounts (e.g. Citadel ••5668)
    const statementAccounts = new Map();   // subAccountId|'main' → accountDef

    if (stmt.subAccounts && stmt.subAccounts.length) {
      // Split by subAccount
      for (const sa of stmt.subAccounts) {
        const def = findAccountDef(stmt, sa.id);
        if (def) {
          statementAccounts.set(sa.id, def);
          console.log(`     subAccount ${sa.id} → ${def.nickname}`);
        } else {
          console.log(`     ⚠️  subAccount ${sa.id} — no matching account def`);
        }
      }
      // Also try 'main' for any txns without a subAccount field
      const mainDef = findAccountDef(stmt, null);
      if (mainDef) statementAccounts.set('main', mainDef);
    } else {
      // Single account statement
      const def = findAccountDef(stmt, null);
      if (def) {
        statementAccounts.set('main', def);
        console.log(`     → ${def.nickname}`);
      } else {
        console.log(`     ⚠️  NO MATCHING ACCOUNT DEF — transactions will import without accountId`);
        statementAccounts.set('main', null);
      }
    }

    // ── Store document record ────────────────────────────────────
    const primaryDef = statementAccounts.values().next().value;
    const docRef = await db
      .collection('households').doc(HOUSEHOLD_ID)
      .collection('documents').add({
        fileName:         file,
        bankName:         stmt.bankName,
        accountLast4:     stmt.accountLast4,
        accountId:        stmt.accountId || null,
        accountLabel:     stmt.accountLabel || null,
        accountType:      stmt.accountType,
        accountHolder:    stmt.accountHolder,
        statementStart:   stmt.statementStart,
        statementEnd:     stmt.statementEnd,
        openingBalance:   stmt.openingBalance ?? null,
        closingBalance:   stmt.closingBalance ?? null,
        creditLimit:      stmt.creditLimit ?? null,
        currency:         stmt.currency || 'USD',
        assignedTo:       stmt.assignedTo || null,
        accountDocId:     primaryDef?.id || null,
        transactionCount: txns.length,
        status:           'complete',
        parserNotes:      parsed.parserNotes || null,
        uploadedAt:       admin.firestore.FieldValue.serverTimestamp(),
        parsedAt:         admin.firestore.FieldValue.serverTimestamp(),
      });

    // ── Import transactions ──────────────────────────────────────
    let imported = 0;
    for (const ch of chunk(txns, 400)) {
      const batch = db.batch();

      for (const tx of ch) {
        // Resolve account for this transaction
        const subAccKey = tx.subAccount || 'main';
        const def = statementAccounts.get(subAccKey)
                 || statementAccounts.get('main')
                 || null;

        const ownerUid  = def ? (MEMBER_UIDS[def.owner] || 'joint') : 'joint';
        const ownerName = def?.owner || (stmt.assignedTo === 'joint' ? 'Joint' :
                          isGabriel(stmt) ? 'Gabriel' : 'Victoria');

        const accountSnapshot = def ? {
          nickname: def.nickname,
          bankName: def.bankName,
          last4:    def.last4,
          type:     def.type,
          color:    def.color,
        } : null;

        const txDoc = {
          // ── IDENTITY ────────────────────────────────────────
          householdId:   HOUSEHOLD_ID,
          sourceDocId:   docRef.id,

          // ── WHAT HAPPENED ───────────────────────────────────
          date:          tx.date,
          month:         tx.date.slice(0, 7),
          desc:          tx.description,
          merchantName:  tx.merchantName || null,
          amount:        tx.amount,
          currency:      stmt.currency || 'USD',

          // ── CLASSIFICATION ──────────────────────────────────
          type:           tx.type,
          direction:      tx.direction,
          transferType:   tx.transferType  || null,
          category:       tx.category      || null,
          subcat:         tx.subcat        || null,
          isSubscription: tx.isSubscription || false,

          // ── ACCOUNT ─────────────────────────────────────────
          accountId:       def?.id          || null,
          accountSnapshot: accountSnapshot,
          subAccountId:    tx.subAccount    || null,

          // ── PERSON ──────────────────────────────────────────
          assignedTo:      ownerUid,
          assignedToName:  ownerName,

          // ── TRANSFER ────────────────────────────────────────
          transferPairId:       null,
          transferPairHint:     tx.transferPairHint || null,
          transferFromAccountId: null,
          transferToAccountId:  null,

          // ── REVIEW STATE ────────────────────────────────────
          reviewed:    false,
          reviewedBy:  null,
          reviewedAt:  null,
          flagged:     tx.needsReview || false,
          flagReason:  tx.flagReason  || null,
          comment:     null,
          commentBy:   null,

          // ── QUALITY ─────────────────────────────────────────
          confidence:    tx.confidence  || 1.0,
          addedManually: false,

          // ── METADATA ────────────────────────────────────────
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedBy: ownerUid,
        };

        // Strip nulls
        Object.keys(txDoc).forEach(k => {
          if (txDoc[k] === null || txDoc[k] === undefined) delete txDoc[k];
        });

        batch.set(
          db.collection('households').doc(HOUSEHOLD_ID)
            .collection('transactions').doc(),
          txDoc
        );
        imported++;
        if (tx.needsReview) totalFlagged++;
      }

      await batch.commit();
      await sleep(200);
    }

    totalImported += imported;
    console.log(`     ✅ ${imported} transactions imported\n`);
  }

  return { totalImported, totalFlagged, fileCount: files.length };
}

// ── STEP 4 — LINK TRANSFER PAIRS ─────────────────────────────────
async function linkTransferPairs() {
  console.log('🔗 Linking transfer pairs...');

  const snap = await db
    .collection('households').doc(HOUSEHOLD_ID)
    .collection('transactions')
    .where('transferPairHint', '!=', null)
    .get();

  if (snap.empty) {
    console.log('  No transfer pair hints found\n');
    return;
  }

  // Group by hint label
  const byHint = new Map();
  snap.docs.forEach(doc => {
    const hint = doc.data().transferPairHint;
    if (!byHint.has(hint)) byHint.set(hint, []);
    byHint.get(hint).push({ id: doc.id, data: doc.data() });
  });

  let linked = 0;
  for (const [hint, docs] of byHint) {
    if (docs.length < 2) continue;
    const pairId = `PAIR_${hint}_${Date.now()}`.slice(0, 20);

    const batch = db.batch();
    for (const doc of docs) {
      batch.update(
        db.collection('households').doc(HOUSEHOLD_ID)
          .collection('transactions').doc(doc.id),
        { transferPairId: pairId }
      );
    }
    await batch.commit();
    linked++;
    console.log(`  ✅ Linked ${hint}: ${docs.length} transactions → ${pairId}`);
  }

  console.log(`  Total pairs linked: ${linked}\n`);
}

// ── STEP 5 — RESET USER STATE ─────────────────────────────────────
async function resetUserState() {
  console.log('👤 Setting user onboardingStep → review...');
  for (const [name, uid] of Object.entries(MEMBER_UIDS)) {
    if (uid === 'joint') continue;
    await db.collection('users').doc(uid).update({
      onboardingStep: 'review',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`  ✅ ${name}`);
  }
  console.log();
}

// ── STEP 6 — SUMMARY ─────────────────────────────────────────────
async function summary(result) {
  const base = db.collection('households').doc(HOUSEHOLD_ID);
  const [tx, acc, doc] = await Promise.all([
    base.collection('transactions').get(),
    base.collection('accounts').get(),
    base.collection('documents').get(),
  ]);

  console.log('═══════════════════════════════════════════');
  console.log('✅  RESET + IMPORT COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`  Statements processed:  ${result.fileCount}`);
  console.log(`  Accounts created:      ${acc.size}`);
  console.log(`  Transactions imported: ${tx.size}`);
  console.log(`  Documents recorded:    ${doc.size}`);
  console.log(`  Flagged for review:    ${result.totalFlagged}`);
  console.log('═══════════════════════════════════════════');
  console.log('\nNext: open /onboarding/review to review flagged items\n');
}

// ── MAIN ─────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Kingdom Wealth — Full Reset + Import');
  console.log(`   Household: ${HOUSEHOLD_ID}`);
  console.log('\n⚠️  Deletes ALL household data. Ctrl+C within 5s to abort...\n');
  await sleep(5000);

  try {
    await resetHousehold();
    const { keyToDef } = await createAccounts();
    const result = await importStatements(keyToDef);
    await linkTransferPairs();
    await resetUserState();
    await summary(result);
  } catch(e) {
    console.error('\n❌ Fatal:', e.message);
    console.error(e.stack);
    process.exit(1);
  }
}

main();
