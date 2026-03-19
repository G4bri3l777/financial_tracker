/**
 * Kingdom Wealth — Print all categories + subcategories from transactions
 * Run: node print_categories.js
 */
const admin = require('firebase-admin');
admin.initializeApp({ credential: admin.credential.cert(require('./serviceAccountKey.json')) });
const db = admin.firestore();

const HOUSEHOLD_ID = 'QOQyIp94Ywa3TxmagQQ2';

async function main() {
  const snap = await db
    .collection('households').doc(HOUSEHOLD_ID)
    .collection('transactions')
    .get();

  const txns = snap.docs.map(d => d.data());

  // Build category → subcategory → { count, total } map
  const tree = {};

  txns.forEach(tx => {
    const cat = String(tx.category || '').trim();
    const sub = String(tx.subcat  || '').trim();
    const amt = Math.abs(Number(tx.amount || 0));
    const type = String(tx.type || '');

    if (!cat) return;

    if (!tree[cat]) tree[cat] = { count: 0, total: 0, type: type, subcats: {} };
    tree[cat].count++;
    tree[cat].total += amt;

    if (sub) {
      if (!tree[cat].subcats[sub]) tree[cat].subcats[sub] = { count: 0, total: 0 };
      tree[cat].subcats[sub].count++;
      tree[cat].subcats[sub].total += amt;
    }
  });

  // Sort categories by total descending
  const sortedCats = Object.entries(tree)
    .sort((a, b) => b[1].total - a[1].total);

  const fmt = (n) => `$${n.toFixed(0).padStart(8)}`;

  console.log('\n══════════════════════════════════════════════════════════');
  console.log('CATEGORIES & SUBCATEGORIES');
  console.log(`${txns.length} total transactions`);
  console.log('══════════════════════════════════════════════════════════\n');

  sortedCats.forEach(([cat, data]) => {
    const subcatCount = Object.keys(data.subcats).length;
    console.log(`  ${cat.padEnd(24)} ${fmt(data.total)}   ${String(data.count).padStart(4)} txns   ${subcatCount} subcats`);

    // Sort subcats by total descending
    Object.entries(data.subcats)
      .sort((a, b) => b[1].total - a[1].total)
      .forEach(([sub, sd]) => {
        const pct = data.total > 0 ? Math.round((sd.total / data.total) * 100) : 0;
        console.log(`    └ ${sub.padEnd(22)} ${fmt(sd.total)}   ${String(sd.count).padStart(4)} txns   ${pct}%`);
      });

    if (subcatCount > 0) console.log();
  });

  // Summary
  console.log('══════════════════════════════════════════════════════════');
  console.log(`  ${sortedCats.length} categories`);
  console.log(`  ${sortedCats.reduce((s, [, d]) => s + Object.keys(d.subcats).length, 0)} subcategories`);
  console.log(`  ${txns.filter(t => !t.category).length} transactions with no category`);
  console.log(`  ${txns.filter(t => t.category && !t.subcat).length} transactions with category but no subcategory`);
}

main().catch(e => { console.error('\n❌', e.message); process.exit(1); });
