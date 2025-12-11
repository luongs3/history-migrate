const DBFFile = require('dbffile').default;
const { MongoClient } = require('mongodb');

async function importDBFToMongoDB() {
  // Configuration
  const dbfFilePaths = [
    '/Users/luongnp/Downloads/sto/eqhistor.dbf',
    '/Users/luongnp/Downloads/sto/eq202511.dbf',
    '/Users/luongnp/Downloads/sto/eq202510.dbf',
    '/Users/luongnp/Downloads/sto/eq202509.dbf',
    '/Users/luongnp/Downloads/sto/eq202508.dbf',
    '/Users/luongnp/Downloads/sto/eq202507.dbf',
    '/Users/luongnp/Downloads/sto/eq202506.dbf',
    '/Users/luongnp/Downloads/sto/eq202505.dbf',
    '/Users/luongnp/Downloads/sto/eq202504.dbf',
    '/Users/luongnp/Downloads/sto/eq202503.dbf',
    '/Users/luongnp/Downloads/sto/eq202502.dbf',
  ];
  const mongoUri = 'mongodb://admin:password@localhost:27017'; // Update with your MongoDB URI
  const databaseName = 'logs'; // Update with your database name
  const collectionName = 'histories_migrated';

  let client;
  let allRecords = [];

  try {
    // Step 1: Read all DBF files and collect records
    console.log('Reading DBF files...');
    for (const filePath of dbfFilePaths) {
      console.log(`Processing file: ${filePath}`);
      const dbf = await DBFFile.open(filePath);
      const records = await dbf.readRecords();
      console.log(`Found ${records.length} records in ${filePath}`);
      allRecords = allRecords.concat(records);
    }

    console.log(`Total records to process: ${allRecords.length}`);

    if (allRecords.length === 0) {
      console.log('No records to import');
      return;
    }

    // Step 2: Connect to MongoDB
    console.log('Connecting to MongoDB...');
    client = new MongoClient(mongoUri);
    await client.connect();
    console.log('Connected to MongoDB');

    // Step 3: Get database and collection
    const db = client.db(databaseName);
    const collection = db.collection(collectionName);

    // Step 4: Insert records into MongoDB - Insert only 1 for now
    console.log('Inserting records into MongoDB...');

    // linh
    // let clientId = 'cli_8a4e507a-857a-4671-9a77-a35626bd3f88';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_845a5be6-5c48-4cd7-a3c7-bc181406ae3b';

    // ta11
    // let clientId = 'cli_3f538cc1-15f1-4dca-ad4f-9eb7a79d4ec1';
    // let warehouseId = 'ware_acf69c06-b600-4b4d-936c-bb7045fb9f4f';
    // let companyId = 'cpn_56806096-2665-462d-9817-2e17c5d30693';

    // ta22
    // let clientId = 'cli_6e699a4a-5bc7-4c3c-a763-963cf6a352a4';
    // let warehouseId = 'ware_0213df8a-6665-4ba4-a834-21b04c69199d';
    // let companyId = 'cpn_ea3fe4ab-0ae3-4bc6-a244-fa668e084fec';

    // clie31
    // let clientId = 'cli_93873136-737b-42cd-ae68-46d771767e3b';
    // let warehouseId = 'ware_90ef2825-f885-4b20-93a5-2925c03c4345';
    // let companyId = 'cpn_6857d468-bb1e-41b2-a6c4-bd44432ccb49';

    // staging-app
    // let clientId = 'cli_3270ce39-b53a-462b-9498-079480cd9a0c';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_ae6e8d21-b6eb-4202-b0bf-75f2989c7f4f';

    // preprod
    let clientId = 'cli_86a59b08-af61-465c-abf6-63e96957b213';
    let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    let companyId = 'cpn_ec37519e-c113-4e8b-b262-8f8882a0561e';

    // prod
    // let clientId = 'cli_2feccdab-3684-47c8-b87a-3a93983bdfc1';
    // let warehouseId = 'ware_e65ab86e-b754-4c5e-9fae-ef5d9a034f8b';
    // let companyId = 'cpn_4de26cdc-5a1d-4bde-8c03-3a1e6ba1988a';

    // testmigrat
    // let clientId = 'cli_6436372e-015b-48c0-9ca7-d6f60c4d9620';
    // let warehouseId = 'ware_0213df8a-6665-4ba4-a834-21b04c69199d';
    // let companyId = 'cpn_e86a10e2-a820-4eaa-962e-414016832805';

    const mappedRecords = [];
    let extraEvent = null;
    const processedAttendu = new Map();
    const processedCommande = new Map();

    for (let i = 0; i < allRecords.length; i++) {
      const record = allRecords[i];
      extraEvent = null;
      // if (record.COD_CLI != 'STO') {
      //   continue;
      // }
      // if (!(record.COD_MVT == 'EP' && record.TYP_MVT == '7K')) {
      //   continue
      // }

      if (record.TYP_MVT == '30') {
        continue;
      }
      // console.log(
      //   `Processing i[${i}]: COD_MVT=${record.COD_MVT}, TYP_MVT=${record.TYP_MVT}, chrono ${record.CHRONO}, TYP_CDN ${record.TYP_CDN}`
      // );

      let createdAt = mergeDateAndTime(record.DAT_VAL, record.HEU_VAL);
      let currentValue = record.BLC_REF;
      let previousValue = record.BLC_AVA;
      let objectSearchType = 'sscc';
      let action = 'create';
      let actionDetail = 'manual';
      let cadre = '';
      let eventType = '';
      let objectType = 'stock';
      let objectNumber = record.NUM_PAL;
      let sscc = record.NUM_PAL;
      let referenceNumber = '';
      let lotNom = '';
      let dluo = 0;
      let cartonNumber = 0;
      let qte = 0;
      let locationAddress = '';
      let extraData = {};
      let noCdns = [];
      let tier = '';
      let userCodeNom = record.UTI_VAL;
      let movementType = record.TYP_MVT;
      let movementState = record.ETAT;
      let code = record.COD_MVT;

      if (
        (record.COD_MVT == 'AM' && record.TYP_MVT == '12') ||
        (record.COD_MVT == 'AT' && record.TYP_MVT == '12')
      ) {
        if (processedAttendu.has(record.NUM_BL)) {
          continue;
        }
        // console.log(
        //   `Processing i[${i}]: COD_MVT=${record.COD_MVT}, TYP_MVT=${record.TYP_MVT}, chrono ${record.CHRONO}, NUM_PAL ${record.NUM_PAL}`
        // );
        action = 'create';
        actionDetail = 'file';
        eventType = 'A-1';
        objectType = 'attendu';
        objectSearchType = 'attendu';
        previousValue = '';
        currentValue = 'created';
        objectNumber = record.NUM_BL;
        cadre = record.NUM_BL;
        extraData = { is_deffective_attendu: false };
        tier = record.COD_FOU;
        userCodeNom = record.UTI_CRE;
        createdAt = mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
        processedAttendu.set(record.NUM_BL, true);

        // create extra attendu entre event
        let ssccs = [];
        for (let k = 0; k < allRecords.length; k++) {
          let tempRecord = allRecords[k];
          if (
            tempRecord.NUM_BL == record.NUM_BL &&
            tempRecord.COD_MVT == 'EX' &&
            tempRecord.TYP_MVT == '23'
          ) {
            ssccs.push(tempRecord);
          }
        }

        if (ssccs.length > 0) {
          // in here, find the record
          extraEvent = {
            chrono: `${i + 1}`,
            created_at: mergeDateAndTime(ssccs[0].DAT_VAL, ssccs[0].HEU_VAL),
            // sscc: ssccs[0].NUM_PAL,
            life_cycle_chrono: ssccs[0].CHRONO,
            object_search_type: objectSearchType,
            object_type: objectType,
            object_number: objectNumber,
            event_type: 'A-10',
            action: 'entry',
            cadre: record.NUM_BL,
            client_id: clientId,
            warehouse_id: warehouseId,
            company_id: companyId,
            tier: tier,
            user_code_nom: userCodeNom,
            movement_type: '23',
            movement_state: '1',
            code: 'EX',
          };
        }
      } else if (record.COD_MVT == 'EX' && record.TYP_MVT == '23') {
        eventType = 'A-9-1';
        action = 'entry';
        actionDetail = 'received_at_dock';
        previousValue = 'in_reception';
        currentValue = 'reput_away';
        cadre = record.NUM_BL || record.NUM_CMD;
        let currentLocation = convertLocationAddress(record);
        let previousLocation = convertLocationAddressOut(record);
        locationAddress = currentLocation;
        if (previousLocation != currentLocation) {
          locationAddress = previousLocation;
          mappedRecords.push({
            chrono: `${i + 2}`,
            created_at: createdAt,
            life_cycle_chrono: record.CHRONO,
            object_search_type: 'sscc',
            object_type: 'stock',
            object_number: record.NUM_PAL,
            event_type: 'sscc_putaway_done',
            action: 'entry',
            action_detail: 'put_in_stock',
            previous_value: 'in_storage',
            current_value: 'put_away',
            location_address: currentLocation,
            reference_number: record.REF,
            carton_number: record.QTE_SCDN,
            lot_nom: record.NUM_IDF,
            dluo: convertDLUO(record),
            no_cdn: [record.NUMERO],
            sscc: record.NUM_PAL,
            qte: qte,
            conditionement_level: convertConditionnementLevel(record),
            cadre: record.NUM_BL || record.NUM_CMD,
            client_id: clientId,
            warehouse_id: warehouseId,
            company_id: companyId,
            tier: tier,
            user_code_nom: userCodeNom,
            movement_type: movementType,
            movement_state: movementState,
            code: code,
          });
        }
      } else if (
        (record.COD_MVT == 'MV' && record.TYP_MVT == '24') ||
        (record.COD_MVT == 'ME' && record.TYP_MVT == '2G')
      ) {
        eventType = '6';
        action = 'entry';
        locationAddress = convertLocationAddress(record);
        cadre = record.NUM_BL || record.NUM_CMD;
      } else if (record.COD_MVT == 'ME' && record.TYP_MVT == '7G') {
        eventType = '6';
        action = 'exit';
        locationAddress = convertLocationAddressOut(record);
        cadre = record.NUM_CMD || record.NUM_BL;
      } else if (record.COD_MVT == 'RE' && record.TYP_MVT == '2+') {
        eventType = 'regularization_entree';
        action = 'entry';
        actionDetail = 'regularization_positive';
        previousValue = `${record.QTE_SORI}`;
        currentValue = `${record.QTE_SORI + record.QTE_SCDN}`;
        cartonNumber = record.QTE_SORI + record.QTE_SCDN;
      } else if (record.COD_MVT == 'AP' && (record.TYP_MVT == '2L' || record.TYP_MVT == '7L')) {
        eventType = 'cancel_picking';
        action = 'entry';
        actionDetail = 'cancel_picking';
        previousValue = 'UD';
        currentValue = 'PAL';
        // aggregate all adjacent chEvents
        let palRecord = record;
        if (record.TYP_CDN == 'PAL') {
          palRecord = record;
        }

        for (let j = i + 1; j < allRecords.length; j++) {
          const jRecord = allRecords[j];
          if (jRecord.COD_MVT !== 'AP' || jRecord.CHRONO != record.CHRONO) {
            i = j - 1;
            break;
          }

          if (jRecord.TYP_CDN == 'PAL') {
            palRecord = jRecord;
          }
        }

        if (palRecord.TYP_MVT == '7L') {
          previousValue = 'PAL';
          currentValue = 'UD';
        }
        cartonNumber = palRecord.QTE_SORI;
      } else if (record.COD_MVT == 'CH' && (record.TYP_MVT == '2A' || record.TYP_MVT == '7A')) {
        action = 'edit';
        actionDetail = 'edit_update';
        eventType = 'sscc_stock_wrapped';
        previousValue = 'UD';
        currentValue = 'PAL';
        // aggregate all adjacent chEvents
        let palRecord = record;
        if (record.TYP_CDN == 'PAL') {
          palRecord = record;
        }

        for (let j = i + 1; j < allRecords.length; j++) {
          const jRecord = allRecords[j];
          if (jRecord.COD_MVT !== 'CH' || jRecord.CHRONO != record.CHRONO) {
            i = j - 1;
            break;
          }

          if (jRecord.TYP_CDN == 'PAL') {
            palRecord = jRecord;
          }
        }

        // pal => ud
        if (palRecord.TYP_MVT == '7A') {
          eventType = 'sscc_stock_unwrapped';
          previousValue = 'PAL';
          currentValue = 'UD';
        }
        cartonNumber = palRecord.QTE_SCDN;
      } else if (record.COD_MVT == 'MV' && record.TYP_MVT == '74') {
        eventType = '8';
        action = 'exit';
        cadre = record.NUM_CMD || record.NUM_BL;
        locationAddress = convertLocationAddressOut(record);
      } else if (record.COD_MVT == 'SO' && record.TYP_MVT == '79') {
        eventType = '25-1';
        objectType = 'stock';
        action = 'exit';
        actionDetail = 'loading_exit';
        previousValue = 'loading';
        currentValue = 'loaded';
        locationAddress = convertLocationAddress(record);
        cadre = record.NUM_CMD;
      } else if (
        (record.COD_MVT == 'SO' && record.TYP_MVT == '61') ||
        (record.COD_MVT == 'CM' && record.TYP_MVT == '61')
      ) {
        if (processedCommande.has(record.NUM_CMD)) {
          continue;
        }
        eventType = 'C-1';
        objectType = 'commande';
        objectSearchType = 'commande';
        action = 'create';
        previousValue = '';
        currentValue = '';
        objectNumber = record.NUM_CMD || record.NUM_BL;
        // sscc = record.NUM_PAL;
        cadre = record.NUM_CMD || record.NUM_BL;
        tier = record.COD_DES;
        userCodeNom = record.UTI_CRE;
        createdAt = mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
        if (record.ETAT == '1') {
          actionDetail = 'file';
          previousValue = '';
          currentValue = 'created';
        }

        processedCommande.set(record.NUM_CMD, true);
        // create extra sortie commande event
        let ssccs = [];
        for (let k = 0; k < allRecords.length; k++) {
          let tempRecord = allRecords[k];
          if (tempRecord.NUM_CMD == record.NUM_CMD) {
            ssccs.push(tempRecord);
          }
        }

        if (ssccs.length > 0) {
          // in here, find the record
          extraEvent = {
            chrono: `${i + 1}`,
            created_at: mergeDateAndTime(ssccs[0].DAT_VAL, ssccs[0].HEU_VAL),
            // sscc: ssccs[0].NUM_PAL,
            life_cycle_chrono: ssccs[0].CHRONO,
            object_search_type: objectSearchType,
            object_type: objectType,
            object_number: objectNumber,
            event_type: 'C-17',
            action: 'exit',
            action_detail: 'loading_exit',
            previous_value: 'loading',
            current_value: 'loaded',
            cadre: record.NUM_CMD || record.NUM_BL,
            client_id: clientId,
            warehouse_id: warehouseId,
            company_id: companyId,
            tier: tier,
            user_code_nom: userCodeNom,
            movement_type: '79',
            movement_state: '1',
            code: 'SO',
          };
        }
      } else if (record.COD_MVT == 'AR' && record.TYP_MVT == '10') {
        action = 'create';
        actionDetail = 'file';
        eventType = 'A-1';
        objectType = 'attendu';
        objectSearchType = 'attendu';
        previousValue = '';
        currentValue = 'created';
        objectNumber = record.NUM_BL;
        cadre = record.NUM_BL;
        extraData = { is_deffective_attendu: true };
        tier = record.COD_FOU;
        userCodeNom = record.UTI_CRE;
        createdAt = mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
        processedAttendu.set(record.NUM_BL, true);
      } else if (record.COD_MVT == 'SR' && record.TYP_MVT == '71') {
        action = 'exit';
        actionDetail = 'regularization_negative';
        eventType = 'regularization_sortie';
        previousValue = `${record.QTE_SCDN}`;
        currentValue = '0';
        locationAddress = convertLocationAddress(record);
      } else if (record.COD_MVT == 'EP' && record.TYP_MVT == '7K') {
        action = 'exit';
        actionDetail = 'via_reappro';
        eventType = 'sscc_exit_by_reappro';
        previousValue = 'Dispo';
        currentValue = '-';
        cartonNumber = record.QTE_SCDN;
        locationAddress = convertLocationAddress(record);

        let ssccs = [];
        for (let k = 0; k < allRecords.length; k++) {
          let tempRecord = allRecords[k];
          if (
            tempRecord.NUM_PAL == record.NUM_PAL &&
            tempRecord.CHRONO == record.CHRONO &&
            tempRecord.COD_MVT == 'EP' &&
            tempRecord.TYP_MVT == '2K'
          ) {
            ssccs.push(tempRecord);
          }
        }

        let noCdns = [];
        for (let i = 0; i < ssccs.length; i++) {
          const sscc = ssccs[i];
          noCdns.push(sscc.NUMERO);
        }

        if (ssccs.length > 0) {
          extraEvent = {
            chrono: `${i + 1}`,
            created_at: mergeDateAndTime(ssccs[0].DAT_VAL, ssccs[0].HEU_VAL),
            // sscc: ssccs[0].NUM_PAL,
            life_cycle_chrono: ssccs[0].CHRONO,
            object_search_type: objectSearchType,
            object_type: objectType,
            object_number: objectNumber,
            carton_number: cartonNumber,
            location_address: convertLocationAddress(record),
            event_type: 'sscc_enter_by_reappro',
            action: 'entry',
            action_detail: 'via_reappro',
            previous_value: `No mère: ${record.NUM_PAL}`,
            current_value: 'UD',
            client_id: clientId,
            warehouse_id: warehouseId,
            company_id: companyId,
            user_code_nom: userCodeNom,
            movement_type: '2K',
            movement_state: '1',
            code: 'EP',
            no_cdn: noCdns,
          };
        }
      }

      if (objectSearchType === 'sscc') {
        referenceNumber = record.REF;
        lotNom = record.NUM_IDF;
        dluo = convertDLUO(record);
        qte = record.QTE;
        noCdns = [record.NUMERO];
      } else {
        sscc = '';
        referenceNumber = '';
        lotNom = '';
        dluo = 0;
        cartonNumber = 0;
        qte = 0;
        noCdns = [];
      }

      if (objectSearchType === 'sscc' && cartonNumber == 0) {
        cartonNumber = record.QTE_SCDN;
      }

      if (objectSearchType === 'sscc' && locationAddress == '') {
        locationAddress = convertLocationAddress(record);
      }

      if (extraEvent != null && extraEvent.object_search_type == 'sscc') {
        extraEvent.reference_number = record.REF;
        extraEvent.lot_nom = record.NUM_IDF;
        extraEvent.dluo = convertDLUO(record);
        extraEvent.carton_number = record.QTE_SCDN;
        extraEvent.qte = record.QTE;
        extraEvent.sscc = record.NUM_PAL;
      }

      if (
        extraEvent != null &&
        extraEvent.object_search_type == 'sscc' &&
        extraEvent.no_cdn.length == 0
      ) {
        extraEvent.no_cdn = [record.NUMERO];
      }

      if (
        extraEvent != null &&
        extraEvent.object_search_type == 'sscc' &&
        extraEvent.carton_number == 0
      ) {
        extraEvent.carton_number = record.QTE_SCDN;
      }

      if (previousValue == 'LI') {
        previousValue = '';
      }
      if (currentValue == 'LI') {
        currentValue = '';
      }

      if (eventType == '') {
        continue;
      }

      const mappedRecord = {
        chrono: `${i + 1}`,
        created_at: createdAt,
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
        client_id: clientId,
        warehouse_id: warehouseId,
        company_id: companyId,
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
        code: code,
      };
      mappedRecords.push(mappedRecord);

      if (extraEvent != null) {
        mappedRecords.push(extraEvent);
      }
    }

    const result = await collection.insertMany(mappedRecords);
    // const result = await collection.insertOne(records[0]);
    // const result = await collection.insertMany(records);

    console.log(`Successfully inserted ${result.insertedCount} records`);

    // Optional: Show sample of first record
    // console.log('\nSample record:')
    // console.log(JSON.stringify(mappedRecords[0], null, 2))
  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    // Step 5: Close MongoDB connection
    if (client) {
      await client.close();
      console.log('MongoDB connection closed');
    }
  }
}

// Run the import
importDBFToMongoDB()
  .then(() => console.log('\nImport completed successfully!'))
  .catch((err) => console.error('\nImport failed:', err));

function mergeDateAndTime(date, time) {
  let created_at = null;

  if (date && time) {
    try {
      // Create Date object from the input date
      const dateObj = new Date(date);

      // Parse time string (format: "HH:MM:SS")
      const timeParts = time.split(':');
      if (timeParts.length === 3) {
        // Set time components using UTC methods to avoid local timezone issues
        dateObj.setUTCHours(parseInt(timeParts[0], 10));
        dateObj.setUTCMinutes(parseInt(timeParts[1], 10));
        dateObj.setUTCSeconds(parseInt(timeParts[2], 10));
        dateObj.setUTCMilliseconds(0);

        // Convert to Unix timestamp (seconds since epoch)
        // Input is UTC+1, so subtract 3600 seconds to get UTC+0
        created_at = Math.floor(dateObj.getTime() / 1000) - 3600;
      }
    } catch (error) {
      console.warn(`Failed to parse date/time for record:`, error.message);
    }
  }

  return created_at;
}

function convertLocationAddress(record) {
  if (record.NIVEAU == '-1') {
    return `${record.ZONE}${record.ALLEE}${record.TRAVEE}00`;
  }

  return `${record.ZONE}${record.ALLEE}${record.TRAVEE}${record.NIVEAU}`;
}

function convertLocationAddressOut(record) {
  if (record.NIV_ORI == '-1') {
    return `${record.ZON_ORI}${record.ALL_ORI}${record.TRA_ORI}00`;
  }

  return `${record.ZON_ORI}${record.ALL_ORI}${record.TRA_ORI}${record.NIV_ORI}`;
}

function convertConditionnementLevel(record) {
  if (record.TYP_CDN == 'PAL') {
    return 3;
  } else if (record.TYP_CDN == 'UD') {
    return 2;
  }

  return 0;
}

function convertDLUO(record) {
  let dluo = null;

  if (record.DLUO) {
    try {
      // Parse ISO date string and convert to Unix timestamp (seconds since epoch)
      const date = new Date(record.DLUO);
      if (!isNaN(date.getTime())) {
        dluo = Math.floor(date.getTime() / 1000);
      }
    } catch (error) {
      console.warn(`Failed to parse DLUO date for record:`, error.message);
    }
  }

  return dluo;
}
