/**
 * Kingdom Wealth — Backfill direction field for manually-added transactions
 *
 * Transactions added via the review modal were missing direction, causing
 * KPI and statement math to mis-count charges.
 *
 * Run: node fix_manual_direction.js
 */

const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();
const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

async function main() {
  const snap = await db
    .collection('households').doc(HOUSEHOLD_ID)
    .collection('transactions').get();

  const missing = snap.docs.filter(d => {
    const dir = d.data().direction;
    return dir === undefined || dir === null || dir === '';
  });

  console.log(`Found ${missing.length} transactions missing direction field`);
  if (missing.length === 0) { console.log('Nothing to fix.'); return; }

  // Preview
  console.log('\nSample:');
  missing.slice(0, 5).forEach(d => {
    const x = d.data();
    console.log(`  ${x.date}  ${x.type}  $${x.amount}  ${x.desc}`);
  });

  let fixed = 0;
  for (let i = 0; i < missing.length; i += 400) {
    const batch = db.batch();
    missing.slice(i, i + 400).forEach(doc => {
      const type = doc.data().type || 'expense';
      const direction = (type === 'income' || type === 'refund') ? 'credit' : 'debit';
      batch.update(doc.ref, { direction, month: doc.data().month || doc.data().date?.slice(0, 7) || '' });
      fixed++;
    });
    await batch.commit();
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`\n✅ Fixed ${fixed} transactions`);
}
main().catch(e => { console.error(e); process.exit(1); });
