// Pure mapping logic: legacy history rows (sqlite) -> histories_migrated docs.
// No I/O here; `queryDB(sql, params)` is injected so tests can back it with an in-memory sqlite.

// ROUND 3 (.hermes/notes/NWF-history-ROUND3.md): 90/91/9D migrated again as support rows, 92 and 13 dropped.
// ROUND 3b (BA 2026-10-14): 79 rows are not migrated at all; the only '79' doc is the C-17 "Chargé"
// extra event emitted from the 61 branch, and only once the commande has a 79 etat-1 row.
const NEW_CODES = ['7R', '2R', '7J', '2J', '92', '7Y', '2Y', '7Q', '2Q', '21', '22', '78', '7O', '2O', '7Z', '2Z', '90', '91', '9D'];
// Support rows: lot_nom '' / dluo 0
const SUPPORT_CODES = ['7Q', '2Q', '90', '91', '9D'];
// Codes kept even when DAT_VAL is null (etat 0 rows still produce a doc)
const KEEP_WITHOUT_DAT_VAL = new Set([...NEW_CODES, '12', '13', '14', '61', '79']);
// r298: every BL with a 12/13/14 row gets one A-1 (EDI); received rows also get an sscc entry line
const ATTENDU_CODES = ['12', '13', '14'];

function isNewCode(typMvt) {
  return NEW_CODES.includes(typMvt);
}

function lifeCycleChrono(chrono) {
  return Math.trunc(Number(chrono) || 0);
}

function toNumber(value) {
  return Number(value) || 0;
}

async function mapRecords({ records, queryDB, ctx }) {
  const { clientId, warehouseId, companyId, mergedTable } = ctx;

  const mappedRecords = [];
  let extraEvent = null;
  const processedAttendu = new Map();
  const mapSscc = new Map();
  const recdnInBySscc = new Map();
  const eclatOutBySscc = new Map();
  const processedCommande = new Set();

  // r298 R7: 61/79 rows per NUM_CMD, in (CHRONO, DAT_CRE, HEU_CRE) order
  const commandeRows = new Map();
  for (const row of await queryDB(
    `SELECT NUM_CMD, TYP_MVT, ETAT, UTI_CRE, DAT_CRE, HEU_CRE, DAT_VAL, HEU_VAL, COD_DES, CHRONO FROM ${mergedTable} WHERE TYP_MVT IN ('61', '79') ORDER BY CHRONO, DAT_CRE, HEU_CRE`,
    []
  )) {
    if (!commandeRows.has(row.NUM_CMD)) commandeRows.set(row.NUM_CMD, []);
    commandeRows.get(row.NUM_CMD).push(row);
  }

  // r298 R11: support SSCC kept only when its latest 30 row still has cartons
  const supportKeep = new Set(
    (
      await queryDB(
        `SELECT NUM_PAL, QTE_SCDN FROM (SELECT NUM_PAL, QTE_SCDN, ROW_NUMBER() OVER (PARTITION BY NUM_PAL ORDER BY CHRONO DESC, DAT_CRE DESC, HEU_CRE DESC) AS rn FROM ${mergedTable} WHERE TYP_MVT = '30' AND REF LIKE '009%') WHERE rn = 1`,
        []
      )
    )
      .filter((r) => toNumber(r.QTE_SCDN) > 0)
      .map((r) => r.NUM_PAL)
  );

  const baseDoc = (record, i) => ({
    chrono: `${i + 1}`,
    life_cycle_chrono: lifeCycleChrono(record.CHRONO),
    location_address: '',
    qte: 0,
    conditionement_level: 0,
    carton_number: 0,
    client_id: clientId,
    warehouse_id: warehouseId,
    company_id: companyId,
    reference_number: '',
    lot_nom: '',
    dluo: 0,
    sscc: '',
    no_cdn: [],
    extra_data: {},
    movement_type: record.TYP_MVT,
    movement_state: record.ETAT,
    code: record.COD_MVT,
  });

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    extraEvent = null;
    const preDocs = [];

    if (String(record.REF ?? '').startsWith('009') && !supportKeep.has(record.NUM_PAL)) {
      continue;
    }

    if (
      record.TYP_MVT == '30' ||
      (!KEEP_WITHOUT_DAT_VAL.has(record.TYP_MVT) && record.DAT_VAL == null)
    ) {
      continue;
    }

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

    if (isNewCode(record.TYP_MVT)) {
      // NWF new codes: see .hermes/notes/NWF-history-DECISIONS.md
      createdAt = mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
      userCodeNom = record.UTI_CRE;
      cadre = record.NUM_BL || '';
      tier = '';
      previousValue = '';
      currentValue = '';
      cartonNumber = record.QTE_SCDN;
      locationAddress = convertLocationAddress(record);
      const qteScdn = toNumber(record.QTE_SCDN);

      switch (record.TYP_MVT) {
        case '7R': {
          action = 'exit';
          actionDetail = 'reconditionnement';
          eventType = 'sscc_exit_by_recdn';
          const before = toNumber(mapSscc.get(record.NUM_PAL)?.carton_number ?? record.QTE_SORI);
          previousValue = `${before}`;
          currentValue = `${before - qteScdn}`;
          mapSscc.set(record.NUM_PAL, { carton_number: before - qteScdn });
          break;
        }
        case '2R': {
          action = 'entry';
          actionDetail = 'reconditionnement';
          eventType = 'sscc_enter_by_recdn';
          const before = recdnInBySscc.get(record.NUM_PAL) ?? 0;
          const sum = before + qteScdn;
          previousValue = `${before}`;
          currentValue = `${sum}`;
          recdnInBySscc.set(record.NUM_PAL, sum);
          mapSscc.set(record.NUM_PAL, { carton_number: sum });
          break;
        }
        case '7J': {
          action = 'exit';
          actionDetail = 'via_eclatement';
          eventType = 'sscc_exit_by_eclatement';
          const qteSori = toNumber(record.QTE_SORI);
          const removed = eclatOutBySscc.get(record.NUM_PAL) ?? 0;
          if (qteSori != 0) {
            const before = qteSori - removed;
            previousValue = `${before}`;
            currentValue = `${before - qteScdn}`;
          }
          eclatOutBySscc.set(record.NUM_PAL, removed + qteScdn);
          break;
        }
        case '2J': {
          action = 'entry';
          actionDetail = 'via_eclatement';
          eventType = 'sscc_enter_by_eclatement';
          const mothers = await queryDB(
            `SELECT NUM_PAL FROM ${mergedTable} WHERE CHRONO = ? AND TYP_MVT = '7J' LIMIT 1`,
            [record.CHRONO]
          );
          const mother = mothers.length > 0 ? mothers[0].NUM_PAL : '-';
          previousValue = `No mère: ${mother}`;
          currentValue = `${record.QTE_SCDN}`;
          break;
        }
        case '90':
          // support entry; 90/RV keeps the round-2 retour-de-vides mapping
          action = 'entry';
          if (record.COD_MVT == 'RV') {
            actionDetail = 'retour_vide_entry';
            eventType = 'sscc_stock_retour_vide_created';
          } else {
            actionDetail = record.COD_MVT == 'EN' ? 'regularization_positive' : 'support_entry';
            eventType = 'support_entry';
          }
          break;
        case '91':
          action = 'exit';
          actionDetail = record.COD_MVT == 'SR' ? 'regularization_negative' : 'support_exit';
          eventType = 'support_exit';
          break;
        case '9D':
          action = 'entry';
          actionDetail = 'annulation_chargement';
          eventType = 'support_annulation_chargement';
          break;
        case '7Y':
          action = 'exit';
          actionDetail = 'combine_process';
          eventType = 'sscc_exit_by_combine';
          locationAddress = convertLocationAddressOut(record);
          break;
        case '2Y':
          action = 'entry';
          actionDetail = 'combine_process';
          eventType = 'sscc_enter_by_combine';
          previousValue = '';
          currentValue = record.BLC_REF;
          break;
        case '7Q':
          action = 'exit';
          actionDetail = 'regroupement_article';
          eventType = 'sscc_exit_by_regroupement';
          break;
        case '2Q':
          action = 'entry';
          actionDetail = 'regroupement_article';
          eventType = 'sscc_enter_by_regroupement';
          currentValue = `${record.QTE_SCDN}`;
          break;
        case '21':
          action = 'entry';
          actionDetail = 'retour_vide_entry';
          eventType = 'sscc_stock_retour_vide_created';
          currentValue = `${record.QTE_SCDN}`;
          break;
        case '22':
          action = 'entry';
          actionDetail = 'transfert_inter_depots';
          eventType = 'sscc_enter_by_transfert';
          currentValue = `${record.QTE_SCDN}`;
          break;
        case '78':
          action = 'exit';
          actionDetail = 'transfert_inter_depots';
          eventType = 'sscc_exit_by_transfert';
          break;
        case '7O':
          action = 'exit';
          actionDetail = 'mouvement_vers_copacking';
          eventType = 'sscc_exit_to_copacking';
          locationAddress = convertLocationAddressOut(record);
          break;
        case '2O':
          action = 'entry';
          actionDetail = 'mouvement_vers_copacking';
          eventType = 'sscc_enter_to_copacking';
          break;
        case '7Z': {
          // mother SSCC loses QTE_SCDN cartons to copacking
          action = 'exit';
          actionDetail = 'copacking_palette';
          eventType = 'sscc_exit_by_copacking';
          const before = toNumber(mapSscc.get(record.NUM_PAL)?.carton_number ?? record.QTE_SORI);
          previousValue = `${before}`;
          currentValue = `${before - qteScdn}`;
          mapSscc.set(record.NUM_PAL, { carton_number: before - qteScdn });
          break;
        }
        case '2Z':
          // child SSCC created by copacking
          action = 'entry';
          actionDetail = 'copacking_palette';
          eventType = 'sscc_enter_by_copacking';
          currentValue = `${record.QTE_SCDN}`;
          mapSscc.set(record.NUM_PAL, { carton_number: qteScdn });
          break;
      }
    } else if (ATTENDU_CODES.includes(record.TYP_MVT)) {
      if (!processedAttendu.has(record.NUM_BL)) {
        processedAttendu.set(record.NUM_BL, true);
        preDocs.push({
          ...baseDoc(record, i),
          created_at: mergeDateAndTime(record.DAT_CRE, record.HEU_CRE),
          object_search_type: 'attendu',
          object_type: 'attendu',
          object_number: record.NUM_BL,
          event_type: 'A-1',
          action: 'create',
          action_detail: 'edi',
          previous_value: '',
          current_value: 'created',
          cadre: record.NUM_BL,
          tier: record.COD_FOU,
          extra_data: { is_deffective_attendu: false },
          user_code_nom: 'EDI',
        });
      }
      if (record.ETAT == '1') {
        action = 'entry';
        actionDetail = '';
        eventType = 'sscc_legacy_entry';
        previousValue = '';
        currentValue = '';
        cadre = record.NUM_BL;
        createdAt =
          mergeDateAndTime(record.DAT_VAL, record.HEU_VAL) ?? mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
        mapSscc.set(record.NUM_PAL, { carton_number: record.QTE_SCDN || 0 });
      }
    } else if (record.COD_MVT == 'EX' && record.TYP_MVT == '23') {
      // r298 R6: one attendu-level doc (origin loc) + one sscc doc (current loc)
      const currentLocation = convertLocationAddress(record);
      const previousLocation = convertLocationAddressOut(record);
      const sameLoc = previousLocation == currentLocation;
      eventType = sameLoc ? 'A-9-1' : 'A-9-2';
      action = 'entry';
      actionDetail = sameLoc ? 'received_at_dock' : 'put_in_stock';
      previousValue = sameLoc ? 'in_reception' : 'in_storage';
      currentValue = sameLoc ? 'reput_away' : 'put_away';
      cadre = record.NUM_BL || record.NUM_CMD;
      objectSearchType = 'attendu';
      objectType = 'attendu';
      objectNumber = record.NUM_BL;
      tier = record.COD_FOU;
      locationAddress = previousLocation;
      extraEvent = {
        ...baseDoc(record, i + 1),
        created_at: createdAt,
        object_search_type: 'sscc',
        object_type: 'stock',
        object_number: record.NUM_PAL,
        event_type: sameLoc ? 'sscc_received_at_dock' : 'sscc_putaway_done',
        action: 'entry',
        action_detail: actionDetail,
        previous_value: previousValue,
        current_value: currentValue,
        location_address: currentLocation,
        conditionement_level: convertConditionnementLevel(record),
        no_cdn: [record.NUMERO],
        cadre: cadre,
        tier: '',
        user_code_nom: userCodeNom,
      };
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
      cartonNumber = record.QTE_SCDN;
      let ssccRecord = mapSscc.get(record.NUM_PAL);
      if (!ssccRecord) {
        previousValue = '0';
        currentValue = `${record.QTE_SCDN}`;
        mapSscc.set(record.NUM_PAL, { carton_number: record.QTE_SCDN });
      } else {
        previousValue = `${ssccRecord.carton_number}`;
        mapSscc.set(record.NUM_PAL, {
          carton_number: ssccRecord?.carton_number + record.QTE_SCDN,
        });
        currentValue = `${ssccRecord.carton_number + record.QTE_SCDN}`;
      }
      cadre = record.NUM_BL;
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

      for (let j = i + 1; j < records.length; j++) {
        const jRecord = records[j];
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
      let cartonRecord = record;
      if (record.TYP_CDN == 'PAL') {
        palRecord = record;
      }

      for (let j = i + 1; j < records.length; j++) {
        const jRecord = records[j];
        if (jRecord.COD_MVT !== 'CH' || jRecord.CHRONO != record.CHRONO) {
          i = j - 1;
          break;
        }

        if (jRecord.TYP_CDN == 'PAL') {
          palRecord = jRecord;
        }

        if (jRecord.TYP_CDN == 'UD') {
          cartonRecord = jRecord;
        }
      }

      // pal => ud
      if (palRecord.TYP_MVT == '7A') {
        eventType = 'sscc_stock_unwrapped';
        previousValue = 'PAL';
        currentValue = 'UD';
      }

      createdAt = mergeDateAndTime(cartonRecord.DAT_VAL, cartonRecord.HEU_VAL);
      userCodeNom = cartonRecord.UTI_VAL;

      cartonNumber = palRecord.QTE_SCDN;
    } else if (record.COD_MVT == 'MV' && record.TYP_MVT == '74') {
      eventType = '8';
      action = 'exit';
      cadre = record.NUM_BL || record.NUM_CMD;
      locationAddress = convertLocationAddressOut(record);
    } else if (record.TYP_MVT == '61' || record.TYP_MVT == '79') {
      if (!processedCommande.has(record.NUM_CMD)) {
        processedCommande.add(record.NUM_CMD);
        preDocs.push(...commandeDocs(record, i, commandeRows.get(record.NUM_CMD) || [record], baseDoc));
      }
      // R9: no sscc line for 61; R8: 79-0 reserved / 79-2 prepared, 79-1 nothing
      if (record.TYP_MVT == '79' && (record.ETAT == '0' || record.ETAT == '2')) {
        action = 'exit';
        eventType = '24';
        actionDetail = record.ETAT == '0' ? 'reserved' : 'prepared';
        previousValue = record.ETAT == '0' ? 'dispo' : 'preparing';
        currentValue = record.ETAT == '0' ? 'reserved' : 'prepared';
        cadre = record.NUM_CMD;
        if (record.DAT_VAL == null) {
          createdAt = mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);
          userCodeNom = record.UTI_CRE;
        }
      }
    } else if (record.TYP_MVT == '10') {
      // r298 R10: "Sans Attendu" is an sscc creation line
      action = 'create';
      actionDetail = 'manual';
      eventType = 'sscc_legacy_created';
      previousValue = '';
      currentValue = 'created';
      cadre = record.NUM_BL;
      createdAt =
        mergeDateAndTime(record.DAT_VAL, record.HEU_VAL) ?? mergeDateAndTime(record.DAT_CRE, record.HEU_CRE);

      const query = `SELECT * FROM ${mergedTable} where NUM_BL = ? and TYP_MVT = '10' order by DAT_VAL desc, HEU_VAL desc`;
      const params = [record.NUM_BL];
      const ssccs = await queryDB(query, params);

      for (let j = 0; j < ssccs.length; j++) {
        let ssccRecord = ssccs[j];
        mapSscc.set(ssccRecord.NUM_PAL, { carton_number: ssccRecord.QTE_SCDN || 0 });
      }
    } else if (record.COD_MVT == 'SR' && record.TYP_MVT == '71') {
      action = 'exit';
      actionDetail = 'regularization_negative';
      eventType = 'regularization_sortie';
      cartonNumber = record.QTE_SCDN;
      locationAddress = convertLocationAddress(record);
      let ssccRecord = mapSscc.get(record.NUM_PAL);
      if (!ssccRecord) {
        // SSCC never seen before (no prior 12/10/61/2+/2R): start from QTE_SORI
        ssccRecord = { carton_number: record.QTE_SORI };
      }
      previousValue = `${ssccRecord.carton_number}`;
      mapSscc.set(record.NUM_PAL, {
        carton_number: ssccRecord?.carton_number - record.QTE_SCDN,
      });
      currentValue = `${previousValue - record.QTE_SCDN}`;
    } else if (record.COD_MVT == 'EP' && record.TYP_MVT == '7K') {
      action = 'exit';
      actionDetail = 'via_reappro';
      eventType = 'sscc_exit_by_reappro';
      previousValue = 'Dispo';
      currentValue = '-';
      cartonNumber = record.QTE_SCDN;
      locationAddress = convertLocationAddress(record);

      const ssccs = await queryDB(
        `SELECT * FROM ${mergedTable} where NUM_PAL = ? and CHRONO = ? and COD_MVT = ? and TYP_MVT = ? order by DAT_VAL desc, HEU_VAL desc`,
        [record.NUM_PAL, record.CHRONO, 'EP', '2K']
      );
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
          life_cycle_chrono: lifeCycleChrono(ssccs[0].CHRONO),
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

    if (objectSearchType === 'sscc' && locationAddress == '') {
      locationAddress = convertLocationAddress(record);
    }

    if (objectSearchType === 'sscc' && cartonNumber == 0) {
      cartonNumber = record.QTE_SCDN;
    }

    if (SUPPORT_CODES.includes(record.TYP_MVT)) {
      lotNom = '';
      dluo = 0;
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

    mappedRecords.push(...preDocs);

    if (eventType == '') {
      continue;
    }

    const mappedRecord = {
      chrono: `${i + 1}`,
      created_at: createdAt,
      life_cycle_chrono: lifeCycleChrono(record.CHRONO),
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

  // r298 R2/R3
  for (const d of mappedRecords) {
    d.is_legacy = true;
    if (d.object_search_type === 'sscc') d.tier = '';
  }

  return mappedRecords;
}

// r298 R7: Création (+ Edition when in progress) docs for one commande, or none
function commandeDocs(record, i, rows, baseDoc) {
  if (rows.some((r) => r.TYP_MVT == '79' && r.ETAT == '1')) return [];
  const has = (typ, etat) => rows.find((r) => r.TYP_MVT == typ && r.ETAT == etat);
  if (!has('61', '0') && !has('79', '0') && !has('79', '2')) return [];
  const commande = (fields) => ({
    ...baseDoc(record, i),
    object_search_type: 'commande',
    object_type: 'commande',
    object_number: record.NUM_CMD,
    cadre: record.NUM_CMD,
    tier: record.COD_DES,
    previous_value: '',
    ...fields,
  });
  const docs = [
    commande({
      created_at: mergeDateAndTime(record.DAT_CRE, record.HEU_CRE),
      event_type: 'C-1',
      action: 'create',
      action_detail: 'edi',
      current_value: 'created',
      user_code_nom: 'EDI',
    }),
  ];
  const statusRow = has('79', '2') || has('79', '0');
  if (statusRow) {
    docs.push(
      commande({
        created_at:
          mergeDateAndTime(statusRow.DAT_VAL, statusRow.HEU_VAL) ??
          mergeDateAndTime(statusRow.DAT_CRE, statusRow.HEU_CRE),
        event_type: 'C-8',
        action: 'edit',
        action_detail: 'edit_update',
        current_value: statusRow.ETAT == '2' ? 'preparing' : 'prepa_sent',
        user_code_nom: statusRow.UTI_CRE,
      })
    );
  }
  return docs;
}

const parisFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Paris',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

// offset (ms) of Europe/Paris vs UTC at the given instant
function parisOffset(ms) {
  const p = Object.fromEntries(parisFormat.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
}

// r298 R1: legacy date/time is Paris wall clock -> UTC epoch seconds (DST-aware)
function mergeDateAndTime(date, time) {
  let created_at = null;

  if (date && time) {
    try {
      const dateObj = new Date(date);
      const timeParts = String(time).split(':');
      if (timeParts.length === 3 && !isNaN(dateObj.getTime())) {
        dateObj.setUTCHours(parseInt(timeParts[0], 10), parseInt(timeParts[1], 10), parseInt(timeParts[2], 10), 0);
        const wall = dateObj.getTime();
        if (!isNaN(wall)) {
          let utc = wall - parisOffset(wall);
          utc = wall - parisOffset(utc);
          created_at = Math.floor(utc / 1000);
        }
      }
    } catch (error) {
      console.warn(`Failed to parse date/time for record:`, error.message);
    }
  }

  return created_at;
}

function convertLocationAddress(record) {
  let niv = record.NIVEAU;
  let zone = record.ZONE;
  let allee = record.ALLEE;
  let trave = record.TRAVEE;

  return refineLocationData(niv, zone, allee, trave);
}

function convertLocationAddressOut(record) {
  let niv = record.NIV_ORI;
  let zone = record.ZON_ORI;
  let allee = record.ALL_ORI;
  let trave = record.TRA_ORI;

  return refineLocationData(niv, zone, allee, trave);
}

function refineLocationData(niv, zone, allee, trave) {
  niv = String(niv ?? '');
  zone = String(zone ?? '');
  allee = String(allee ?? '');
  trave = String(trave ?? '');

  if (niv == '-1') {
    niv = '00';
  }

  while (allee.length < 3) {
    allee = allee + ' ';
  }

  if ((trave.length == 2 && niv.includes('D')) || niv.includes('E') || niv.includes('F')) {
    trave = ' ' + trave;
  }

  if ((trave.length == 2 && niv.includes('A')) || niv.includes('B') || niv.includes('C')) {
    trave = trave + ' ';
  }

  return `${zone}${allee}${trave}${niv}`;
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

module.exports = {
  mapRecords,
  mergeDateAndTime,
  convertLocationAddress,
  convertLocationAddressOut,
  refineLocationData,
  convertConditionnementLevel,
  convertDLUO,
  NEW_CODES,
  KEEP_WITHOUT_DAT_VAL,
  isNewCode,
};
