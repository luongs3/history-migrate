const { MongoClient } = require('mongodb');
const sqlite3 = require('sqlite3').verbose();
const { mapRecords } = require('./lib/mapper');

function connectToSQLite() {
  return new Promise((resolve, reject) => {
    console.log('Connecting to SQLite database...');
    const db = new sqlite3.Database(
      process.env.SQLITE_FILE || 'nwf-20261012.sqlite',
      sqlite3.OPEN_READWRITE,
      (err) => {
        if (err) {
          console.error('Error connecting to SQLite database:', err.message);
          return reject(err);
        }
        console.log('Connected to SQLite database');
        resolve(db);
      }
    );
  });
}

function queryDB(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        console.error('Error executing query:', err.message);
        return reject(err);
      }
      resolve(rows);
    });
  });
}

async function importDBFToMongoDB() {
  const mongoUri = process.env.MONGO_URI || 'mongodb://admin:password@localhost:27017';
  const databaseName = 'logs';
  const collectionName = 'histories_migrated';
  const chunkSize = 10000;

  let client;
  let db;

  try {
    // Step 1: Connect to SQLite
    db = await connectToSQLite();

    // List all tables for debugging
    // const tables = await queryDB(db, "SELECT name FROM sqlite_master WHERE type='table'");
    // console.log('Tables in database:', tables);

    // await createMergedTable(db);
    let mergedTable = process.env.MERGED_TABLE || 'eqhistormerged';
    // let mergedTable = 'eqhistorcur';
    // let mergedTable = 'merged'; // sto
    // await refineData(db);

    // Get records from SQLite (CHRONO alone is not enough: nwf 91 rows share CHRONO=0.001)
    const records = await queryDB(
      db,
      `SELECT * FROM ${mergedTable} ORDER BY CHRONO ASC, DAT_CRE ASC, HEU_CRE ASC`
    );
    console.log(`Retrieved ${records.length} records from SQLite`);

    // Rest of your MongoDB import logic here...
    // Step 2: Connect to MongoDB
    console.log('Connecting to MongoDB...');
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Connected to MongoDB');

    // Step 3: Get database and collection
    const mongoDb = client.db(databaseName);
    const collection = mongoDb.collection(collectionName);

    // Step 4: Insert records into MongoDB - Insert only 1 for now
    console.log('Inserting records into MongoDB...');

    // preprod - Leroy Merlin
    // let clientId = 'cli_da9ae6e2-064d-4144-8309-9b796f4458ea';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_4de26cdc-5a1d-4bde-8c03-3a1e6ba1988a';

    // preprod - Quipment
    // let clientId = 'cli_2052c8af-9d66-40ed-a2ea-4dd349bbdaec';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_4de26cdc-5a1d-4bde-8c03-3a1e6ba1988a';

    // prod - Leroy Merlin
    // let clientId = 'cli_735423e2-22fb-4612-8817-5e30ec2a551f';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_4de26cdc-5a1d-4bde-8c03-3a1e6ba1988a';

    // prod - Quipment
    // let clientId = 'cli_5ba75359-4f3d-4d59-874a-ab0b72ca2816';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_4de26cdc-5a1d-4bde-8c03-3a1e6ba1988a';

    // beta Cerelia
    // let clientId = 'cli_ceaa1009-ba8e-443d-a1a5-d1b0646ef85d';
    // let warehouseId = 'ware_0213df8a-6665-4ba4-a834-21b04c69199d';
    // let companyId = 'cpn_fea5ec5c-699e-40ff-9fe8-5a33e2b95873';

    // staging - NWF
    let clientId = process.env.CLIENT_ID || 'cli_5df6e8fe-d747-4d7b-b09c-ddadf22a7e4a';
    let warehouseId = process.env.WAREHOUSE_ID || 'ware_6e792213-3895-40b9-92f8-071e1eb96b5c';
    let companyId = process.env.COMPANY_ID || 'cpn_96c4d2b0-169b-421b-910b-800bb0f0055e';

    const mappedRecords = await mapRecords({
      records,
      queryDB: (sql, params) => queryDB(db, sql, params),
      ctx: { clientId, warehouseId, companyId, mergedTable, migrationUser: process.env.MIGRATION_USER || '6625-Clémence God' },
    });
    console.log(`Mapped ${mappedRecords.length} records`);

    let insertedCount = 0;
    for (let i = 0; i < mappedRecords.length; i += chunkSize) {
      const result = await collection.insertMany(mappedRecords.slice(i, i + chunkSize), {
        ordered: false,
      });
      insertedCount += result.insertedCount;
      console.log(`Inserted ${insertedCount}/${mappedRecords.length}`);
    }
    // const result = await collection.insertOne(records[0]);
    // const result = await collection.insertMany(records);

    console.log(`Successfully inserted ${insertedCount} records`);
  } catch (err) {
    console.error('Error during import:', err);
    throw err;
  } finally {
    // Close connections
    if (db) db.close();
    if (client) await client.close();
  }
}

// Run the import
importDBFToMongoDB()
  .then(() => console.log('\nImport completed successfully!'))
  .catch((err) => console.error('\nImport failed:', err));

async function createMergedTable(db) {
  await queryDB(
    db,
    `
CREATE TABLE IF NOT EXISTS eq_merged AS
  SELECT * FROM eq202502
  UNION ALL
  SELECT * FROM eq202503
  UNION ALL
  SELECT * FROM eq202504
  UNION ALL
  SELECT * FROM eq202505
  UNION ALL
  SELECT * FROM eq202506
  UNION ALL
  SELECT * FROM eq202507
  UNION ALL
  SELECT * FROM eq202508
  UNION ALL
  SELECT * FROM eq202509
  UNION ALL
  SELECT * FROM eq202510
UNION ALL
  SELECT * FROM eq202511
  UNION ALL
  SELECT * FROM eqhistor;
`
  );
  console.log('Created merged table: eq_merged');
}

async function refineData(db) {
  await queryDB(
    db,
    `
  DELETE FROM eq_merged
WHERE rowid NOT IN (
    SELECT MIN(rowid)
    FROM eq_merged
    GROUP BY UTI_CRE,DAT_CRE,HEU_CRE,UTI_MOD,DAT_MOD,HEU_MOD,CHRONO,SOCIETE,ENTREPOT,ZONE,ALLEE,TRAVEE,NIVEAU,ZON_ORI,ALL_ORI,TRA_ORI,NIV_ORI,NUMERO,QTE,COD_CDN,TYP_CDN,QTE_SORI,QTE_SCDN,COD_SCDN,TYP_SCDN,QTE_CMD,QTE_CHA,ETAT,COD_MVT,TYP_MVT,DAT_DEM,HEU_DEM,UTI_VAL,DAT_VAL,HEU_VAL,DAT_LIV,HEU_LIV,DAT_CHA,HEU_CHA,REF,NUM_BL,NUM_CMD,SOU_CMD,COD_CLI,COD_FOU,IDF_FOU,IDF_DES,COD_DES,NUM_IDF,DLUO,DAT_FAB,DAT_LIB,FORCAGE,VALIDE,BLC_REF,COD_TPS,IDF_TPS,DAT_LIV_R,HEU_LIV_R,LITIGE,COD_PER,COD_MOY,COD_FOR,SEQUENCE,NUM_LIG,NUM_LV,DLV,DLC,TPS_MST,NUM_PAL,NUM_CAM,COD_KIT,TYP_VEN,CHRONO_EDI,NUM_POR,SUPPORT,TYP_STK,COD_PRE,POS,BLC_AVA,STA_SAT,SAP_CLI,SAP_CMD,NS_NUM_BL,DAT_TRK,HEU_TRK,AVA_RUP
    -- Notice: Do NOT include extra_col_1, etc., here.
);
`
  );
  console.log('Removed duplicated data');
}
