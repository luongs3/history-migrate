const DBFFile = require('dbffile').default
const { MongoClient } = require('mongodb')

async function importDBFToMongoDB() {
  // Configuration
  const dbfFilePath = '/Users/luongnp/Downloads/sto/eqhistor.dbf' // Update with your file path
  const mongoUri = 'mongodb://admin:password@localhost:27017' // Update with your MongoDB URI
  const databaseName = 'logs' // Update with your database name
  const collectionName = 'histories_migrated'

  let client

  try {
    // Step 1: Read the DBF file
    console.log('Reading DBF file...')
    const dbf = await DBFFile.open(dbfFilePath)
    const records = await dbf.readRecords()

    console.log(`Found ${records.length} records in DBF file`)

    if (records.length === 0) {
      console.log('No records to import')
      return
    }

    // Step 2: Connect to MongoDB
    console.log('Connecting to MongoDB...')
    client = new MongoClient(mongoUri)
    await client.connect()
    console.log('Connected to MongoDB')

    // Step 3: Get database and collection
    const db = client.db(databaseName)
    const collection = db.collection(collectionName)

    // Step 4: Insert records into MongoDB - Insert only 1 for now
    console.log('Inserting records into MongoDB...')

    const mappedRecords = []
    for (let i = 0; i < records.length; i++) {

      const record = records[i]
      // only process these sscc, attendu for now
      if (record.NUM_PAL != '366173362000451063') {
        continue
      }

      // only process for attendu
      // if (!((record.COD_MVT == 'AM' && record.TYP_MVT == '12') || 
      // (record.COD_MVT == 'EX' && record.TYP_MVT == '23'))) {
      //   continue
      // }

      console.log(`Processing: COD_MVT=${record.COD_MVT}, TYP_MVT=${record.TYP_MVT}, chrono ${record.CHRONO}`);
      // console.log(record)
      let currentValue = record.BLC_REF;
      let previousValue = record.BLC_AVA;
      let objectSearchType = 'sscc';
      let action = 'create';
      let actionDetail = 'manual';
      let cadre = '';
      let eventType = ''
      let objectType = 'stock'
      let objectNumber = record.NUM_PAL;
      let sscc = record.NUM_PAL;
      let referenceNumber = '';
      let lotNom = '';
      let dluo = 0;
      let cartonNumber = 0
      let qte = 0;
      let locationAddress = ''
      let extraData = {}
      let noCdns = [];
      let tier = ''
      let userCodeNom = record.UTI_VAL
      let movementType = record.TYP_MVT;
      let movementState = record.ETAT;
      let code = record.COD_MVT;

      if ((record.COD_MVT == 'AM' && record.TYP_MVT == '12') || (record.COD_MVT == 'AT' && record.TYP_MVT == '12')) {
        actionDetail = 'file'
        eventType = 'A-1'
        objectType = 'attendu'
        objectSearchType = 'attendu'
        previousValue = ''
        currentValue = 'created'
        objectNumber = record.NUM_BL || record.CMD;
        cadre = record.NUM_BL || record.CMD;
        extraData = { is_deffective_attendu: false };
        tier = record.COD_FOU || record.IDF_FOU || record.IDF_DES || record.COD_DES
      } else if (record.COD_MVT == 'EX' && record.TYP_MVT == '23') {
        eventType = '5';
        action = 'entry'
        cadre = record.NUM_BL || record.CMD;
        locationAddress = convertLocationAddress(record);
      } else if (record.COD_MVT == 'MV' && record.TYP_MVT == '24') {
        eventType = '6';
        action = 'entry';
        locationAddress = convertLocationAddress(record);
      } else if ((record.COD_MVT == 'AP' && record.TYP_MVT == '2L') || (record.COD_MVT == 'EN' && record.TYP_MVT == '2V')) {
        eventType = 'regularization_entree';
        action = 'entry';
        actionDetail = 'regularization_positive';
        currentValue = record.QTE_SORI;
      } else if (record.COD_MVT == 'AP' && record.TYP_MVT == '7L') {
        eventType = 'regularization_sortie';
        action = 'exit';
        actionDetail = 'regularization_negative';
        previousValue = record.QTE_SORI;
      } else if (record.COD_MVT == 'CH' && (record.TYP_MVT != '2A' || record.TYP_MVT != '7A')) {
        action = 'edit'
        actionDetail = 'edit_update'
        eventType = 'sscc_stock_wrapped';
        previousValue = 'UD'
        currentValue = 'PAL'
        // aggregate all adjacent chEvents
        let palRecord = record
        if (record.TYP_CDN == 'PAL') {
          palRecord = record
        }


        for (let j = i+1; j<records.length; j++) {
          const jRecord = records[j];
          if (jRecord.COD_MVT !== 'CH' && (jRecord.TYP_MVT != '2A' || jRecord.TYP_MVT != '7A')) {
            i = j - 1
            break;
          }

          if (jRecord.TYP_CDN == 'PAL') {
            palRecord = jRecord  
          }
        }

        // pal => ud
        if (palRecord.TYP_MVT == '7A') {
          eventType = 'sscc_stock_unwrapped';
          previousValue = 'PAL'
          currentValue = 'UD'
        }

        cartonNumber = palRecord.QTE_SORI
      } else if (record.COD_MVT == 'MV' && record.TYP_MVT == '74') {
        eventType = '8';
        action = 'exit';
      } else if ((record.COD_MVT == 'SO' && record.TYP_MVT == '79') || (record.COD_MVT == 'SO' && record.TYP_MVT == '61')) {
        eventType = 'A-1'
        objectType = 'commande'
        objectSearchType = 'commande'
        action = 'exit'
        previousValue = ''
        currentValue = ''
        objectNumber = record.NUM_BL || record.CMD;
        cadre = record.CMD || record.NUM_BL;
        tier = record.COD_FOU || record.IDF_FOU || record.IDF_DES || record.COD_DES
        if (record.ETAT == '1') {
          actionDetail = 'loading_exit'
        } else if (record.ETAT == '2') {
          actionDetail = 'prepare_exit'
        } else if (record.ETAT == '0') {
          actionDetail = 'edit_update'
        }
      }

      if (objectSearchType === 'sscc') {
        referenceNumber = record.REF;
        lotNom = record.NUM_IDF;
        dluo = convertDLUO(record);
        cartonNumber = record.QTE_SORI
        qte = record.QTE;
        noCdns = [record.NUMERO];
      } else {
        // sscc = '';
        referenceNumber = '';
        lotNom = '';
        dluo = 0;
        cartonNumber = 0;
        qte = 0;
        noCdns = [];
      }



      if (previousValue == "LI") {
        previousValue = ''
      }
      if (currentValue == 'LI') {
        currentValue = '';
      }

      if (eventType == '') {
        continue
      }

      const convertedCreated = convertDateCreatedAt(record)
      const mappedRecord = {
        chrono: `${i + 1}`,
        created_at: convertedCreated,
        life_cycle_chrono: record.CHRONO,
        object_search_type: objectSearchType,
        object_type: objectType,
        object_number: objectNumber,
        event_type: eventType,
        action: action,
        action_detail: actionDetail,
        previous_value: previousValue,
        current_value: currentValue,
        location_address: locationAddress,
        qte: qte,
        conditionement_level: convertConditionnementLevel(record),
        carton_number: cartonNumber,
        cadre: cadre,
        client_id: 'cli_93873136-737b-42cd-ae68-46d771767e3b',
        warehouse_id: 'ware_90ef2825-f885-4b20-93a5-2925c03c4345',
        company_id: 'cpn_6857d468-bb1e-41b2-a6c4-bd44432ccb49',
        reference_number: referenceNumber,
        lot_nom: lotNom,
        dluo: dluo,
        sscc: sscc,
        no_cdn: noCdns,
        tier: tier,
        extra_data: extraData,
        user_code_nom: userCodeNom,
        movement_type: movementType,
        movement_state: movementState,
        code: code
      }
      mappedRecords.push(mappedRecord)
    }

    const result = await collection.insertMany(mappedRecords)
    // const result = await collection.insertOne(records[0]);
    // const result = await collection.insertMany(records);

    console.log(`Successfully inserted ${result.insertedCount} records`)

    // Optional: Show sample of first record
    // console.log('\nSample record:')
    // console.log(JSON.stringify(mappedRecords[0], null, 2))
  } catch (error) {
    console.error('Error:', error.message)
    throw error
  } finally {
    // Step 5: Close MongoDB connection
    if (client) {
      await client.close()
      console.log('MongoDB connection closed')
    }
  }
}

// Run the import
importDBFToMongoDB()
  .then(() => console.log('\nImport completed successfully!'))
  .catch((err) => console.error('\nImport failed:', err))

function convertDateCreatedAt(record) {
  let created_at = null

  if (record.DAT_VAL && record.HEU_VAL) {
    try {
      // Extract date part
      const date = new Date(record.DAT_VAL)

      // Parse time string (format: "HH:MM:SS")
      const timeParts = record.HEU_VAL.split(':')
      if (timeParts.length === 3) {
        date.setHours(parseInt(timeParts[0], 10))
        date.setMinutes(parseInt(timeParts[1], 10))
        date.setSeconds(parseInt(timeParts[2], 10))

        // Convert to Unix timestamp (seconds since epoch)
        created_at = Math.floor(date.getTime() / 1000)
      }
    } catch (error) {
      console.warn(`Failed to parse date/time for record:`, error.message)
    }
  }

  return created_at
}

function convertLocationAddress(record) {
  return `${record.ZONE}${record.ALLEE}${record.TRAVEE}${record.NIVEAU}`
}

function convertConditionnementLevel(record) {
  if (record.TYP_CDN == 'PAL') {
    return 3
  } else if (record.TYP_CDN == 'UD') {
    return 2
  }

  return 0
}

function convertDLUO(record) {
  let dluo = null

  if (record.DLUO) {
    try {
      // Parse ISO date string and convert to Unix timestamp (seconds since epoch)
      const date = new Date(record.DLUO)
      if (!isNaN(date.getTime())) {
        dluo = Math.floor(date.getTime() / 1000)
      }
    } catch (error) {
      console.warn(`Failed to parse DLUO date for record:`, error.message)
    }
  }

  return dluo
}
