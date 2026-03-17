/**
 * Kingdom Wealth — Firestore Inspector
 * Prints every document field + metadata for accounts, transactions, documents
 * Run: node inspect_firestore.js
 */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

function fmt(v) {
  if (v === null || v === undefined) return 'null';
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString().slice(0,19);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

async function inspectCollection(label, collRef, maxDocs = 999) {
  const snap = await collRef.get();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${label.toUpperCase()}  (${snap.size} docs)`);
  console.log('═'.repeat(60));

  if (snap.empty) { console.log('  (empty)'); return []; }

  const docs = [];
  for (const doc of snap.docs.slice(0, maxDocs)) {
    const d = doc.data();
    console.log(`\n  ── doc: ${doc.id}`);
    for (const [k, v] of Object.entries(d)) {
      console.log(`     ${k.padEnd(24)} = ${fmt(v)}`);
    }
    docs.push({ id: doc.id, ...d });
  }
  if (snap.size > maxDocs) {
    console.log(`\n  ... and ${snap.size - maxDocs} more (showing first ${maxDocs})`);
  }
  return docs;
}

async function main() {
  const base = db.collection('households').doc(HOUSEHOLD_ID);

  // ── ACCOUNTS ────────────────────────────────────────────────────
  const accounts = await inspectCollection(
    '📦 ACCOUNTS',
    base.collection('accounts')
  );

  // Build accountId → nickname map
  const accMap = {};
  for (const a of accounts) accMap[a.id] = a.nickname || a.id;

  // ── DOCUMENTS (statement records) ────────────────────────────────
  const docs = await inspectCollection(
    '📄 DOCUMENTS (statement records)',
    base.collection('documents')
  );

  // ── TRANSACTIONS — show first 20 + summary ──────────────────────
  const txSnap = await base.collection('transactions').get();
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📋 TRANSACTIONS  (${txSnap.size} total)`);
  console.log('═'.repeat(60));

  // Count issues
  let noAccountId  = 0;
  let noSourceDocId = 0;
  let noDirection  = 0;
  let noMerchant   = 0;
  const accountUsage = {};
  const sourceDocUsage = {};

  for (const doc of txSnap.docs) {
    const d = doc.data();
    if (!d.accountId)   noAccountId++;
    if (!d.sourceDocId) noSourceDocId++;
    if (!d.direction)   noDirection++;
    if (!d.merchantName) noMerchant++;
    accountUsage[d.accountId || '__none__'] = (accountUsage[d.accountId || '__none__'] || 0) + 1;
    sourceDocUsage[d.sourceDocId || '__none__'] = (sourceDocUsage[d.sourceDocId || '__none__'] || 0) + 1;
  }

  console.log(`\n  ── FIELD COVERAGE SUMMARY`);
  console.log(`     accountId present:    ${txSnap.size - noAccountId} / ${txSnap.size}  (${noAccountId} missing)`);
  console.log(`     sourceDocId present:  ${txSnap.size - noSourceDocId} / ${txSnap.size}  (${noSourceDocId} missing)`);
  console.log(`     direction present:    ${txSnap.size - noDirection} / ${txSnap.size}  (${noDirection} missing)`);
  console.log(`     merchantName present: ${txSnap.size - noMerchant} / ${txSnap.size}  (${noMerchant} missing)`);

  console.log(`\n  ── TRANSACTIONS PER ACCOUNT`);
  for (const [accId, count] of Object.entries(accountUsage).sort((a,b) => b[1]-a[1])) {
    const name = accId === '__none__' ? '⚠️  NO ACCOUNT' : (accMap[accId] || `unknown: ${accId}`);
    console.log(`     ${name.padEnd(30)} ${count} txns  (id: ${accId.slice(0,8)}...)`);
  }

  console.log(`\n  ── TRANSACTIONS PER SOURCE DOC`);
  const docNameMap = {};
  for (const d of docs) docNameMap[d.id] = d.fileName || d.id;
  for (const [docId, count] of Object.entries(sourceDocUsage).sort((a,b) => b[1]-a[1])) {
    const name = docId === '__none__' ? '⚠️  NO SOURCE DOC' : (docNameMap[docId] || `unknown: ${docId}`);
    console.log(`     ${name.padEnd(40)} ${count} txns`);
  }

  // Show first 5 transactions in full
  console.log(`\n  ── FIRST 5 TRANSACTIONS (full fields)`);
  for (const doc of txSnap.docs.slice(0, 5)) {
    const d = doc.data();
    console.log(`\n     doc: ${doc.id}`);
    for (const [k, v] of Object.entries(d)) {
      console.log(`       ${k.padEnd(22)} = ${fmt(v)}`);
    }
  }

  // Show 5 transactions with NO accountId
  const missing = txSnap.docs.filter(d => !d.data().accountId).slice(0, 5);
  if (missing.length > 0) {
    console.log(`\n  ── SAMPLE TRANSACTIONS WITH NO accountId`);
    for (const doc of missing) {
      const d = doc.data();
      console.log(`     ${d.date} | ${(d.merchantName||d.desc||'').slice(0,30).padEnd(32)} | sourceDocId: ${d.sourceDocId || 'NONE'}`);
    }
  }

  console.log('\n\n' + '═'.repeat(60));
  console.log('DIAGNOSIS COMPLETE');
  console.log('═'.repeat(60));
}

main().catch(e => { console.error('❌', e.message); process.exit(1); });
