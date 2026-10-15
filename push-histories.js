// Copy logs.histories_migrated (local, produced by import-connect.js) into the
// target environment's `histories` collection, in batches.
//
//   SOURCE_MONGO_URI=mongodb://localhost:27018 \
//   TARGET_MONGO_URI='mongodb://user:pw@host:27017/' TARGET_DB=logger-staging \
//   CLIENT_ID=cli_... node push-histories.js [--dry-run]
//
// Only documents of CLIENT_ID are copied. Documents already present for that
// client with no user_id (= a previous legacy push) are counted and reported so
// a re-run does not silently double the history.
const { MongoClient } = require('mongodb');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sourceUri = process.env.SOURCE_MONGO_URI || 'mongodb://localhost:27018';
  const targetUri = process.env.TARGET_MONGO_URI;
  const targetDb = process.env.TARGET_DB || 'logger-staging';
  const clientId = process.env.CLIENT_ID;
  const chunkSize = 10000;

  if (!targetUri || !clientId) {
    throw new Error('TARGET_MONGO_URI and CLIENT_ID are required');
  }

  const source = new MongoClient(sourceUri);
  const target = new MongoClient(targetUri);
  await source.connect();
  await target.connect();

  try {
    const from = source.db('logs').collection('histories_migrated');
    const to = target.db(targetDb).collection('histories');

    const total = await from.countDocuments({ client_id: clientId });
    const already = await to.countDocuments({ client_id: clientId, user_id: { $exists: false } });
    console.log(`source docs for client: ${total}`);
    console.log(`target legacy docs already present for client: ${already}`);
    if (already > 0) {
      console.log('Refusing to push on top of an existing legacy set. Remove them first:');
      console.log(`  db.histories.deleteMany({client_id: '${clientId}', user_id: {$exists: false}})`);
      process.exitCode = 2;
      return;
    }
    if (dryRun) {
      console.log('--dry-run: nothing written');
      return;
    }

    let pushed = 0;
    let batch = [];
    const cursor = from.find({ client_id: clientId }, { sort: { _id: 1 } });
    for await (const doc of cursor) {
      delete doc._id;
      batch.push(doc);
      if (batch.length >= chunkSize) {
        const r = await to.insertMany(batch, { ordered: false });
        pushed += r.insertedCount;
        console.log(`Pushed ${pushed}/${total}`);
        batch = [];
      }
    }
    if (batch.length > 0) {
      const r = await to.insertMany(batch, { ordered: false });
      pushed += r.insertedCount;
    }
    console.log(`Pushed ${pushed}/${total}`);

    const after = await to.countDocuments({ client_id: clientId, user_id: { $exists: false } });
    console.log(`target legacy docs for client after push: ${after}`);
  } finally {
    await source.close();
    await target.close();
  }
}

main()
  .then(() => console.log('\nPush completed'))
  .catch((err) => {
    console.error('\nPush failed:', err);
    process.exitCode = 1;
  });
