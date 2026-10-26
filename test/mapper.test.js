const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const {
  mapRecords,
  mergeDateAndTime,
  refineLocationData,
  NEW_CODES,
  KEEP_WITHOUT_DAT_VAL,
  isNewCode,
} = require('../lib/mapper');

const COLUMNS = [
  'CHRONO', 'TYP_MVT', 'COD_MVT', 'ETAT', 'NUM_PAL', 'NUM_BL', 'NUM_CMD', 'REF', 'NUM_IDF', 'DLUO',
  'QTE', 'QTE_SCDN', 'QTE_SORI', 'NUMERO', 'TYP_CDN', 'ZONE', 'ALLEE', 'TRAVEE', 'NIVEAU',
  'ZON_ORI', 'ALL_ORI', 'TRA_ORI', 'NIV_ORI', 'DAT_CRE', 'HEU_CRE', 'UTI_CRE', 'DAT_VAL', 'HEU_VAL',
  'UTI_VAL', 'BLC_AVA', 'BLC_REF', 'COD_FOU', 'COD_DES',
];

const ctx = {
  clientId: 'cli_test',
  warehouseId: 'ware_test',
  companyId: 'cpn_test',
  mergedTable: 'eqhistormerged',
};

// Defaults mimic a typical NWF row; tests override what matters.
const BASE = {
  CHRONO: 1,
  TYP_MVT: '',
  COD_MVT: '',
  ETAT: '1',
  NUM_PAL: '',
  NUM_BL: '',
  NUM_CMD: '',
  REF: 'REF1',
  NUM_IDF: 'LOT1',
  DLUO: '2027-01-01',
  QTE: 10,
  QTE_SCDN: 0,
  QTE_SORI: 0,
  NUMERO: 'N1',
  TYP_CDN: 'PAL',
  ZONE: 'RK',
  ALLEE: 'REC',
  TRAVEE: '800',
  NIVEAU: '00',
  ZON_ORI: 'SD',
  ALL_ORI: '006',
  TRA_ORI: 'G31',
  NIV_ORI: '00',
  DAT_CRE: '2026-06-01',
  HEU_CRE: '10:00:00',
  UTI_CRE: 'UCRE',
  DAT_VAL: '2026-06-02',
  HEU_VAL: '11:00:00',
  UTI_VAL: 'UVAL',
  BLC_AVA: 'LB',
  BLC_REF: 'LB',
  COD_FOU: 'FOU1',
  COD_DES: 'DES1',
};

function openDB() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => (err ? reject(err) : resolve(db)));
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => (err ? reject(err) : resolve()));
  });
}

// Insert rows, select with the runner's ORDER BY, map.
async function run(rows) {
  const db = await openDB();
  try {
    const cols = COLUMNS.map((c) => (c === 'CHRONO' ? 'CHRONO REAL' : `${c} TEXT`)).join(', ');
    await runSql(db, `CREATE TABLE eqhistormerged (${cols})`);
    const placeholders = COLUMNS.map(() => '?').join(', ');
    for (const row of rows) {
      const full = { ...BASE, ...row };
      await runSql(
        db,
        `INSERT INTO eqhistormerged (${COLUMNS.join(', ')}) VALUES (${placeholders})`,
        COLUMNS.map((c) => (full[c] === undefined ? null : full[c]))
      );
    }
    const records = await all(
      db,
      'SELECT * FROM eqhistormerged ORDER BY CHRONO ASC, DAT_CRE ASC, HEU_CRE ASC'
    );
    return await mapRecords({ records, queryDB: (sql, params) => all(db, sql, params), ctx });
  } finally {
    db.close();
  }
}

function byType(docs, typMvt) {
  return docs.filter((d) => d.movement_type === typMvt);
}

describe('helpers', () => {
  test('NEW_CODES / isNewCode', () => {
    assert.deepEqual(NEW_CODES, [
      '7R', '2R', '7J', '2J', '92', '7Y', '2Y', '7Q', '2Q', '21', '22', '78', '7O', '2O', '7Z', '2Z',
      '90', '91', '9D',
    ]);
    assert.equal(isNewCode('7R'), true);
    assert.equal(isNewCode('12'), false);
    assert.equal(isNewCode('90'), true);
    assert.equal(isNewCode('79'), false);
    for (const c of ['12', '14', '7R', '2Z', '90', '91', '9D']) {
      assert.equal(KEEP_WITHOUT_DAT_VAL.has(c), true, c);
    }
    // r298: 13 / 61 / 79 etat-0 rows have DAT_VAL NULL and must still reach their branch
    for (const c of ['13', '61', '79']) {
      assert.equal(KEEP_WITHOUT_DAT_VAL.has(c), true, c);
    }
    for (const c of ['10', '24', '71']) {
      assert.equal(KEEP_WITHOUT_DAT_VAL.has(c), false, c);
    }
  });

  test('refineLocationData guards nulls and maps NIVEAU -1 to 00', () => {
    assert.equal(refineLocationData('-1', 'EX', 'SUP', 'POR'), 'EXSUPPOR00');
    assert.equal(refineLocationData(null, null, null, null), '   ');
    assert.equal(refineLocationData('00', 'RK', 'RE', '800'), 'RKRE 80000');
  });
});

describe('7R reconditionnement', () => {
  test('case 1: 12 -> 7R -> 71 chain on S1', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 140, QTE_SORI: 140 },
      { CHRONO: 2, TYP_MVT: '7R', COD_MVT: 'RC', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 84, QTE_SORI: 140, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 3, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 56, QTE_SORI: 56 },
    ]);

    const a1 = docs.find((d) => d.event_type === 'A-1');
    assert.ok(a1, 'A-1 attendu doc expected');
    assert.equal(a1.object_number, 'BL1');
    assert.equal(a1.extra_data.is_deffective_attendu, false);

    const r = byType(docs, '7R')[0];
    assert.equal(r.previous_value, '140');
    assert.equal(r.current_value, '56');
    assert.equal(r.action, 'exit');
    assert.equal(r.action_detail, 'reconditionnement');
    assert.equal(r.event_type, 'sscc_exit_by_recdn');
    assert.equal(r.cadre, 'BL1');
    assert.equal(r.tier, '');
    assert.equal(r.user_code_nom, 'UCRE');
    assert.equal(r.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
    assert.equal(r.object_search_type, 'sscc');
    assert.equal(r.object_number, 'S1');
    assert.equal(r.sscc, 'S1');
    // QTE_SCDN is passed through untouched; the test schema is TEXT (real NWF column is INTEGER)
    assert.equal(r.carton_number, '84');
    assert.equal(r.lot_nom, 'LOT1');
    assert.equal(r.movement_type, '7R');
    assert.equal(r.movement_state, '1');
    assert.equal(r.code, 'RC');
    assert.equal(r.life_cycle_chrono, 2);

    const s = byType(docs, '71')[0];
    assert.equal(s.previous_value, '56');
    assert.equal(s.current_value, '0');
  });
});

describe('2R reconditionnement', () => {
  test('case 2: running sum over three 2R rows, LB does not leak', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '2R', COD_MVT: 'RC', NUM_PAL: 'S2', QTE_SCDN: 84, DAT_VAL: null },
      { CHRONO: 2, TYP_MVT: '2R', COD_MVT: 'RC', NUM_PAL: 'S2', QTE_SCDN: 28, DAT_VAL: null },
      { CHRONO: 3, TYP_MVT: '2R', COD_MVT: 'RC', NUM_PAL: 'S2', QTE_SCDN: 28, DAT_VAL: null },
    ]);
    const r = byType(docs, '2R');
    assert.equal(r.length, 3);
    assert.deepEqual(
      r.map((d) => [d.previous_value, d.current_value]),
      [['0', '84'], ['84', '112'], ['112', '140']]
    );
    for (const d of r) {
      assert.equal(d.action, 'entry');
      assert.equal(d.action_detail, 'reconditionnement');
      assert.equal(d.event_type, 'sscc_enter_by_recdn');
      assert.equal(d.location_address, 'RKREC80000');
      assert.notEqual(d.previous_value, 'LB');
      assert.notEqual(d.current_value, 'LB');
    }
  });
});

describe('7J / 2J eclatement', () => {
  test('case 3: 7J decrements from QTE_SORI; QTE_SORI=0 gives empty values', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '7J', NUM_PAL: 'M1', QTE_SORI: 400, QTE_SCDN: 26 },
      { CHRONO: 2, TYP_MVT: '7J', NUM_PAL: 'M1', QTE_SORI: 400, QTE_SCDN: 24 },
      { CHRONO: 3, TYP_MVT: '7J', NUM_PAL: 'M2', QTE_SORI: 0, QTE_SCDN: 5 },
    ]);
    const r = byType(docs, '7J');
    assert.deepEqual(
      r.map((d) => [d.previous_value, d.current_value]),
      [['400', '374'], ['374', '350'], ['', '']]
    );
    assert.equal(r[0].action, 'exit');
    assert.equal(r[0].action_detail, 'via_eclatement');
    assert.equal(r[0].event_type, 'sscc_exit_by_eclatement');
  });

  test('case 4: 2J resolves mother by CHRONO', async () => {
    const docs = await run([
      { CHRONO: 10, TYP_MVT: '7J', NUM_PAL: 'M', QTE_SORI: 100, QTE_SCDN: 26, DAT_CRE: '2026-06-01' },
      { CHRONO: 10, TYP_MVT: '2J', NUM_PAL: 'C1', QTE_SCDN: 26, DAT_CRE: '2026-06-02' },
      { CHRONO: 11, TYP_MVT: '2J', NUM_PAL: 'C2', QTE_SCDN: 7 },
    ]);
    const r = byType(docs, '2J');
    assert.equal(r.length, 2);
    assert.equal(r[0].previous_value, 'No mère: M');
    assert.equal(r[0].current_value, '26');
    assert.equal(r[0].action, 'entry');
    assert.equal(r[0].action_detail, 'via_eclatement');
    assert.equal(r[0].event_type, 'sscc_enter_by_eclatement');
    assert.equal(r[1].previous_value, 'No mère: -');
    assert.equal(r[1].current_value, '7');
  });
});

describe('support codes', () => {
  test('case 5: 90 / 91 / 9D are support rows (round 3); 7Q / 2Q unchanged', async () => {
    const loc = { ZONE: 'EX', ALLEE: 'SUP', TRAVEE: 'POR', NIVEAU: '-1' };
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '90', COD_MVT: '', NUM_PAL: 'P1', NUM_BL: 'BL90', QTE_SCDN: 3, ...loc, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, TYP_MVT: '90', COD_MVT: 'EN', NUM_PAL: 'P1', QTE_SCDN: 3 },
      { CHRONO: 3, TYP_MVT: '91', COD_MVT: '', NUM_PAL: 'P1', QTE_SCDN: 3 },
      { CHRONO: 4, TYP_MVT: '91', COD_MVT: 'SR', NUM_PAL: 'P1', QTE_SCDN: 3 },
      { CHRONO: 5, TYP_MVT: '9D', COD_MVT: 'AC', NUM_PAL: 'P1', QTE_SCDN: 3 },
      { CHRONO: 6, TYP_MVT: '7Q', COD_MVT: 'RZ', NUM_PAL: 'P1', QTE_SCDN: 3 },
      { CHRONO: 7, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'P1', QTE_SCDN: 3 },
    ]);
    assert.deepEqual(
      docs.map((d) => [d.movement_type, d.action, d.action_detail, d.event_type]),
      [
        ['90', 'entry', 'support_entry', 'support_entry'],
        ['90', 'entry', 'regularization_positive', 'support_entry'],
        ['91', 'exit', 'support_exit', 'support_exit'],
        ['91', 'exit', 'regularization_negative', 'support_exit'],
        ['9D', 'entry', 'annulation_chargement', 'support_annulation_chargement'],
        ['7Q', 'exit', 'regroupement_article', 'sscc_exit_by_regroupement'],
        ['2Q', 'entry', 'regroupement_article', 'sscc_enter_by_regroupement'],
      ]
    );

    const [e90, e90en, e91, e91sr, e9d, e7q, e2q] = docs;
    // 90 with DAT_VAL NULL is kept (new-code guard) and dated from DAT_CRE/HEU_CRE
    assert.equal(e90.location_address, 'EXSUPPOR00');
    assert.equal(e90.cadre, 'BL90');
    assert.equal(e90.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
    assert.equal(e90.user_code_nom, 'UCRE');
    assert.equal(e90.carton_number, '3');
    assert.equal(e90en.code, 'EN');
    assert.equal(e91sr.code, 'SR');
    for (const d of [e90, e90en, e91, e91sr, e9d]) {
      assert.equal(d.object_search_type, 'sscc');
      assert.equal(d.object_number, 'P1');
      assert.equal(d.sscc, 'P1');
      assert.equal(d.previous_value, '');
      assert.equal(d.current_value, '');
      assert.equal(d.tier, '');
      assert.equal(d.lot_nom, '');
      assert.equal(d.dluo, 0);
    }

    assert.equal(e7q.previous_value, '');
    assert.equal(e7q.current_value, '');
    assert.equal(e2q.previous_value, '');
    assert.equal(e2q.current_value, '3');
    for (const d of [e7q, e2q]) {
      assert.equal(d.lot_nom, '');
      assert.equal(d.dluo, 0);
    }
  });

  test('case 5b: 90/RV keeps the retour-de-vides mapping', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '90', COD_MVT: 'RV', NUM_PAL: 'P1', NUM_BL: 'BLRV', QTE_SCDN: 3, ZONE: 'EX', ALLEE: 'SUP', TRAVEE: 'POR', NIVEAU: '-1' },
    ]);
    assert.equal(docs.length, 1);
    const d = docs[0];
    assert.equal(d.movement_type, '90');
    assert.equal(d.code, 'RV');
    assert.equal(d.object_search_type, 'sscc');
    assert.equal(d.object_number, 'P1');
    assert.equal(d.sscc, 'P1');
    assert.equal(d.action, 'entry');
    assert.equal(d.action_detail, 'retour_vide_entry');
    assert.equal(d.event_type, 'sscc_stock_retour_vide_created');
    assert.equal(d.previous_value, '');
    assert.equal(d.current_value, '');
    assert.equal(d.lot_nom, '');
    assert.equal(d.dluo, 0);
    assert.equal(d.location_address, 'EXSUPPOR00');
    assert.equal(d.cadre, 'BLRV');
    assert.equal(d.tier, '');
    assert.equal(d.user_code_nom, 'UCRE');
    assert.equal(d.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
    assert.equal(d.carton_number, '3');
  });

  test('case 6: 92 is not migrated (round 3)', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '92', COD_MVT: 'RV', NUM_PAL: '', REF: 'R1', NUM_IDF: 'SUPPORT', QTE_SCDN: 125, QTE: 125, NUMERO: 'N92', ALLEE: null, TRAVEE: null, NIVEAU: null },
      { CHRONO: 2, TYP_MVT: '92', COD_MVT: 'RV', NUM_PAL: '', REF: 'R1', NUM_IDF: 'SUPPORT', QTE_SCDN: 1, DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 3, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'P1', QTE_SCDN: 3 },
    ]);
    assert.deepEqual(docs.map((d) => d.movement_type), ['2Q']);
  });
});

describe('7Y / 2Y combine', () => {
  test('case 7: two docs, origin vs destination location, 2Y cur = BLC_REF', async () => {
    const docs = await run([
      { CHRONO: 5, TYP_MVT: '7Y', COD_MVT: 'PS', NUM_PAL: 'S7', QTE_SCDN: 468, BLC_AVA: 'LI', BLC_REF: 'LI', HEU_CRE: '23:47:01' },
      { CHRONO: 5, TYP_MVT: '2Y', COD_MVT: 'PS', NUM_PAL: 'S7', QTE_SCDN: 468, BLC_AVA: 'LI', BLC_REF: 'BL', HEU_CRE: '23:47:02' },
    ]);
    assert.equal(docs.length, 2);
    const [y7, y2] = docs;
    assert.equal(y7.movement_type, '7Y');
    assert.equal(y7.action, 'exit');
    assert.equal(y7.action_detail, 'combine_process');
    assert.equal(y7.event_type, 'sscc_exit_by_combine');
    assert.equal(y7.location_address, 'SD006G3100');
    assert.equal(y7.previous_value, '');
    assert.equal(y7.current_value, '');

    assert.equal(y2.movement_type, '2Y');
    assert.equal(y2.action, 'entry');
    assert.equal(y2.action_detail, 'combine_process');
    assert.equal(y2.event_type, 'sscc_enter_by_combine');
    assert.equal(y2.location_address, 'RKREC80000');
    assert.equal(y2.previous_value, '');
    assert.equal(y2.current_value, 'BL');
  });

  test('2Y previous_value is always empty (BLC_AVA ignored)', async () => {
    const docs = await run([
      { CHRONO: 5, TYP_MVT: '2Y', COD_MVT: 'PS', NUM_PAL: 'S7', QTE_SCDN: 1, BLC_AVA: 'DI', BLC_REF: 'BL' },
    ]);
    assert.equal(docs[0].previous_value, '');
    assert.equal(docs[0].current_value, 'BL');
  });
});

describe('ordering', () => {
  test('case 8: CHRONO 0.001 sorts first and life_cycle_chrono is an integer', async () => {
    const docs = await run([
      { CHRONO: 5, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'P5', QTE_SCDN: 1, DAT_CRE: '2026-06-03' },
      { CHRONO: 0.001, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'P0', QTE_SCDN: 1, DAT_CRE: '2026-06-01' },
    ]);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].object_number, 'P0');
    assert.equal(docs[0].life_cycle_chrono, 0);
    assert.equal(docs[0].chrono, '1');
    assert.equal(docs[1].object_number, 'P5');
    assert.equal(docs[1].life_cycle_chrono, 5);
    assert.equal(docs[1].chrono, '2');
  });
});

describe('old-code fixes', () => {
  test('case 9a: 12 DE gives one A-1 (EDI) + one sscc entry per received row', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 10 },
      { CHRONO: 2, TYP_MVT: '12', COD_MVT: 'RT', NUM_PAL: 'S2', NUM_BL: 'BL1', QTE_SCDN: 10 },
    ]);
    assert.deepEqual(
      docs.map((d) => d.event_type),
      ['A-1', 'sscc_legacy_entry', 'sscc_legacy_entry']
    );
    assert.equal(docs[0].object_search_type, 'attendu');
    assert.equal(docs[0].tier, 'FOU1');
    assert.equal(docs[0].sscc, '');
    assert.equal(docs[0].carton_number, 0);
    assert.equal(docs[1].sscc, 'S1');
    assert.equal(docs[2].sscc, 'S2');
  });

  test('case 9c (R10): 10 is an sscc creation line per row, no attendu doc', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '10', COD_MVT: 'CK', NUM_PAL: 'S1', NUM_BL: 'BLCK', QTE_SCDN: 10 },
      { CHRONO: 2, TYP_MVT: '10', COD_MVT: 'AR', NUM_PAL: 'S2', NUM_BL: 'BLCK', QTE_SCDN: 10 },
      { CHRONO: 3, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 4, QTE_SORI: 999 },
    ]);
    assert.equal(docs.length, 3);
    for (const d of docs.slice(0, 2)) {
      assert.equal(d.object_search_type, 'sscc');
      assert.equal(d.event_type, 'sscc_legacy_created');
      assert.equal(d.action, 'create');
      assert.equal(d.action_detail, 'manual');
      assert.equal(d.previous_value, '');
      assert.equal(d.current_value, 'created');
      assert.equal(d.cadre, 'BLCK');
      assert.equal(d.created_at, mergeDateAndTime('2026-06-02', '11:00:00'));
    }
    assert.equal(docs.some((d) => d.object_search_type == 'attendu'), false);
    // mapSscc seeded by 10
    assert.deepEqual([docs[2].previous_value, docs[2].current_value], ['10', '6']);
  });

  test('case 9d: 71 on an unseen SSCC falls back to QTE_SORI', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'SX', QTE_SCDN: 4, QTE_SORI: 12 },
      { CHRONO: 2, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'SX', QTE_SCDN: 3, QTE_SORI: 8 },
    ]);
    assert.equal(docs.length, 2);
    assert.equal(docs[0].event_type, 'regularization_sortie');
    assert.equal(docs[0].previous_value, '12');
    assert.equal(docs[0].current_value, '8');
    assert.equal(docs[1].previous_value, '8');
    assert.equal(docs[1].current_value, '5');
  });

  test('case 9e: DAT_VAL guard only applies to old codes; 30 always skipped', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'S1', QTE_SCDN: 3, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, TYP_MVT: '30', COD_MVT: 'XX', NUM_PAL: 'S1', QTE_SCDN: 3 },
      { CHRONO: 3, TYP_MVT: '24', COD_MVT: 'MV', NUM_PAL: 'S1', QTE_SCDN: 3, DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 4, TYP_MVT: '24', COD_MVT: 'MV', NUM_PAL: 'S1', QTE_SCDN: 3 },
      { CHRONO: 5, TYP_MVT: '10', COD_MVT: 'CK', NUM_PAL: 'S1', NUM_BL: 'BL10', QTE_SCDN: 3, DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 7, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 3, DAT_VAL: null, HEU_VAL: null },
    ]);
    assert.deepEqual(
      docs.map((d) => [d.movement_type, d.event_type]),
      [['2Q', 'sscc_enter_by_regroupement'], ['24', '6']]
    );
    assert.equal(docs[0].chrono, '1');
    assert.equal(docs[1].chrono, '4');
  });
});

describe('r298 R1: Paris time -> UTC', () => {
  test('winter and summer offsets', () => {
    assert.equal(mergeDateAndTime('2026-01-15', '10:00:00'), Date.UTC(2026, 0, 15, 9) / 1000);
    assert.equal(mergeDateAndTime('2026-07-15', '10:00:00'), Date.UTC(2026, 6, 15, 8) / 1000);
    assert.equal(mergeDateAndTime(null, '10:00:00'), null);
    assert.equal(mergeDateAndTime('2026-07-15', 'bad'), null);
  });
});

describe('r298 R2/R3: is_legacy and tier', () => {
  test('every doc is_legacy; sscc docs have empty tier', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 10 },
      { CHRONO: 2, TYP_MVT: '23', COD_MVT: 'EX', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 10 },
      { CHRONO: 3, TYP_MVT: '61', COD_MVT: 'PF', ETAT: '0', NUM_PAL: 'S1', NUM_CMD: 'C1', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 4, TYP_MVT: '79', COD_MVT: 'SO', ETAT: '0', NUM_PAL: 'S1', NUM_CMD: 'C1', DAT_VAL: null, HEU_VAL: null },
    ]);
    assert.ok(docs.length >= 6);
    for (const d of docs) {
      assert.equal(d.is_legacy, true);
      if (d.object_search_type == 'sscc') assert.equal(d.tier, '');
    }
    assert.equal(docs.find((d) => d.object_search_type == 'commande').tier, 'DES1');
  });
});

describe('r298 R4/R5: attendu 12 / 13 / 14', () => {
  test('12 etat 0 only -> exactly one A-1 (edi / EDI), nothing else', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '0', NUM_PAL: 'S1', NUM_BL: 'BL0', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '0', NUM_PAL: 'S2', NUM_BL: 'BL0', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
    ]);
    assert.equal(docs.length, 1);
    const d = docs[0];
    assert.deepEqual(
      [d.event_type, d.action, d.action_detail, d.user_code_nom, d.previous_value, d.current_value, d.object_search_type, d.object_number, d.cadre, d.tier],
      ['A-1', 'create', 'edi', 'EDI', '', 'created', 'attendu', 'BL0', 'BL0', 'FOU1']
    );
    assert.equal(d.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
  });

  test('12 etat-0 + etat-1 -> A-1 from first row + sscc entry from the received row', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '0', NUM_PAL: 'S1', NUM_BL: 'BLM', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '1', NUM_PAL: 'S2', NUM_BL: 'BLM', QTE_SCDN: 10, DAT_VAL: '2026-06-05', HEU_VAL: '09:30:00' },
    ]);
    assert.deepEqual(docs.map((d) => d.event_type), ['A-1', 'sscc_legacy_entry']);
    assert.equal(docs[0].movement_state, '0');
    const e = docs[1];
    assert.deepEqual(
      [e.object_search_type, e.action, e.action_detail, e.previous_value, e.current_value, e.sscc, e.user_code_nom, e.tier],
      ['sscc', 'entry', '', '', '', 'S2', 'UVAL', '']
    );
    assert.equal(e.created_at, mergeDateAndTime('2026-06-05', '09:30:00'));
  });

  test('13/PO BL -> A-1 + sscc entry', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '13', COD_MVT: 'PO', ETAT: '0', NUM_PAL: 'S1', NUM_BL: 'BL13', COD_FOU: 'FOU13', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, TYP_MVT: '13', COD_MVT: 'PO', ETAT: '1', NUM_PAL: 'S2', NUM_BL: 'BL13', COD_FOU: 'FOU13', QTE_SCDN: 10 },
    ]);
    assert.deepEqual(docs.map((d) => [d.object_number, d.event_type]), [['BL13', 'A-1'], ['S2', 'sscc_legacy_entry']]);
    assert.equal(docs[0].tier, 'FOU13');
  });

  test('14/CK: one A-1 per BL; received rows seed mapSscc', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '14', COD_MVT: 'CK', ETAT: '1', NUM_PAL: 'S1', NUM_BL: 'BL14A', QTE_SCDN: 10 },
      { CHRONO: 2, TYP_MVT: '14', COD_MVT: 'CK', ETAT: '0', NUM_PAL: 'S2', NUM_BL: 'BL14B', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 3, TYP_MVT: '14', COD_MVT: 'CK', ETAT: '0', NUM_PAL: 'S3', NUM_BL: 'BL14B', QTE_SCDN: 10, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 4, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 3, QTE_SORI: 999 },
    ]);
    assert.deepEqual(
      docs.map((d) => [d.object_number, d.event_type]),
      [['BL14A', 'A-1'], ['S1', 'sscc_legacy_entry'], ['BL14B', 'A-1'], ['S1', 'regularization_sortie']]
    );
    assert.deepEqual([docs[3].previous_value, docs[3].current_value], ['10', '7']);
  });
});

describe('r298 R6: 23/EX', () => {
  test('same location -> A-9-1 received_at_dock + sscc_received_at_dock', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '23', COD_MVT: 'EX', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 5, ZON_ORI: 'RK', ALL_ORI: 'REC', TRA_ORI: '800', NIV_ORI: '00' },
    ]);
    assert.equal(docs.length, 2);
    const [a, s] = docs;
    assert.deepEqual(
      [a.object_search_type, a.event_type, a.action_detail, a.previous_value, a.current_value, a.object_number, a.tier, a.location_address],
      ['attendu', 'A-9-1', 'received_at_dock', 'in_reception', 'reput_away', 'BL1', 'FOU1', 'RKREC80000']
    );
    assert.deepEqual(
      [s.object_search_type, s.event_type, s.action_detail, s.previous_value, s.current_value, s.sscc, s.tier, s.location_address],
      ['sscc', 'sscc_received_at_dock', 'received_at_dock', 'in_reception', 'reput_away', 'S1', '', 'RKREC80000']
    );
  });

  test('different location -> A-9-2 put_in_stock + sscc_putaway_done', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '23', COD_MVT: 'EX', NUM_PAL: 'S1', NUM_BL: 'BL1', QTE_SCDN: 5 },
    ]);
    assert.equal(docs.length, 2);
    const [a, s] = docs;
    assert.deepEqual(
      [a.object_search_type, a.event_type, a.action_detail, a.previous_value, a.current_value, a.location_address],
      ['attendu', 'A-9-2', 'put_in_stock', 'in_storage', 'put_away', 'SD006G3100']
    );
    assert.deepEqual(
      [s.event_type, s.action_detail, s.previous_value, s.current_value, s.location_address, s.carton_number, s.reference_number],
      ['sscc_putaway_done', 'put_in_stock', 'in_storage', 'put_away', 'RKREC80000', '5', 'REF1']
    );
  });
});

describe('r298 R7/R8/R9: commande 61 / 79', () => {
  const C61 = { TYP_MVT: '61', COD_MVT: 'PF', NUM_PAL: 'S1', QTE_SCDN: 10 };
  const C79 = { TYP_MVT: '79', COD_MVT: 'SO', NUM_PAL: 'S9', QTE_SCDN: 10 };
  const commande = (docs) => docs.filter((d) => d.object_search_type == 'commande');

  test('any 79 etat 1 -> no commande docs, no 79-1 sscc doc', async () => {
    const docs = await run([
      { CHRONO: 1, ...C61, ETAT: '0', NUM_CMD: 'CMDM', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 2, ...C79, ETAT: '0', NUM_CMD: 'CMDM', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 3, ...C79, ETAT: '1', NUM_CMD: 'CMDM' },
    ]);
    assert.deepEqual(commande(docs), []);
    assert.deepEqual(docs.map((d) => [d.movement_type, d.movement_state]), [['79', '0']]);
  });

  test('61 etat 0 only -> C-1 only, no sscc doc for 61', async () => {
    const docs = await run([
      { CHRONO: 1, ...C61, ETAT: '0', NUM_CMD: 'CMD0', DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
      { CHRONO: 2, ...C61, ETAT: '0', NUM_PAL: 'S2', NUM_CMD: 'CMD0', DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
    ]);
    assert.equal(docs.length, 1);
    const d = docs[0];
    assert.deepEqual(
      [d.event_type, d.action, d.action_detail, d.user_code_nom, d.previous_value, d.current_value, d.object_number, d.cadre, d.tier, d.object_type],
      ['C-1', 'create', 'edi', 'EDI', '', 'created', 'CMD0', 'CMD0', 'DES1', 'commande']
    );
    assert.equal(d.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
  });

  test('61 etat 1 only -> nothing', async () => {
    const docs = await run([{ CHRONO: 1, ...C61, ETAT: '1', NUM_CMD: 'CMDU' }]);
    assert.deepEqual(docs, []);
  });

  test('61-0 + 79-0 -> C-1 + C-8 prepa_sent + 79 reserved sscc line', async () => {
    const docs = await run([
      { CHRONO: 1, ...C61, ETAT: '0', NUM_CMD: 'CMDP', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 2, ...C79, ETAT: '0', NUM_CMD: 'CMDP', UTI_CRE: 'PREP', HEU_CRE: '12:00:00', DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
    ]);
    assert.deepEqual(docs.map((d) => d.event_type), ['C-1', 'C-8', '24']);
    const e = docs[1];
    assert.deepEqual(
      [e.action, e.action_detail, e.previous_value, e.current_value, e.user_code_nom, e.tier],
      ['edit', 'edit_update', '', 'prepa_sent', 'PREP', 'DES1']
    );
    assert.equal(e.created_at, mergeDateAndTime('2026-06-01', '12:00:00'));
    const s = docs[2];
    assert.deepEqual(
      [s.object_search_type, s.action, s.action_detail, s.previous_value, s.current_value, s.cadre, s.user_code_nom, s.tier],
      ['sscc', 'exit', 'reserved', 'dispo', 'reserved', 'CMDP', 'PREP', '']
    );
    assert.equal(s.created_at, mergeDateAndTime('2026-06-01', '12:00:00'));
  });

  test('79-2 -> C-8 preparing (wins over 79-0) + prepared sscc line', async () => {
    const docs = await run([
      { CHRONO: 1, ...C79, ETAT: '0', NUM_CMD: 'CMD2', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 2, ...C79, ETAT: '2', NUM_CMD: 'CMD2', UTI_CRE: 'P2', DAT_VAL: '2026-06-09', HEU_VAL: '12:00:00' },
    ]);
    assert.deepEqual(docs.map((d) => [d.event_type, d.current_value]), [
      ['C-1', 'created'], ['C-8', 'preparing'], ['24', 'reserved'], ['24', 'prepared'],
    ]);
    assert.equal(docs[1].user_code_nom, 'P2');
    assert.equal(docs[1].created_at, mergeDateAndTime('2026-06-09', '12:00:00'));
    assert.deepEqual([docs[3].action_detail, docs[3].previous_value, docs[3].user_code_nom], ['prepared', 'preparing', 'UVAL']);
  });

  test('commande docs are emitted once, at its first row, and do not disturb sscc chains', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '2Z', COD_MVT: 'CK', NUM_PAL: 'S1', QTE_SCDN: 8 },
      { CHRONO: 2, ...C61, ETAT: '0', NUM_CMD: 'CMDA', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 3, ...C61, ETAT: '0', NUM_CMD: 'CMDA', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 4, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 3, QTE_SORI: 999 },
    ]);
    assert.deepEqual(docs.map((d) => d.event_type), ['sscc_enter_by_copacking', 'C-1', 'regularization_sortie']);
    assert.deepEqual([docs[2].previous_value, docs[2].current_value], ['8', '5']);
  });
});

describe('r298 R11: support SSCC keep-set', () => {
  test('support kept only when latest 30 row has QTE_SCDN > 0', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '90', COD_MVT: 'EN', NUM_PAL: 'K1', REF: '009A', QTE_SCDN: 3 },
      { CHRONO: 2, TYP_MVT: '90', COD_MVT: 'EN', NUM_PAL: 'K2', REF: '009A', QTE_SCDN: 3 },
      { CHRONO: 3, TYP_MVT: '90', COD_MVT: 'EN', NUM_PAL: 'K3', REF: '009A', QTE_SCDN: 3 },
      { CHRONO: 4, TYP_MVT: '30', COD_MVT: 'XX', NUM_PAL: 'K1', REF: '009A', QTE_SCDN: 0 },
      { CHRONO: 5, TYP_MVT: '30', COD_MVT: 'XX', NUM_PAL: 'K1', REF: '009A', QTE_SCDN: 2 },
      { CHRONO: 4, TYP_MVT: '30', COD_MVT: 'XX', NUM_PAL: 'K2', REF: '009A', QTE_SCDN: 2 },
      { CHRONO: 5, TYP_MVT: '30', COD_MVT: 'XX', NUM_PAL: 'K2', REF: '009A', QTE_SCDN: 0 },
      { CHRONO: 6, TYP_MVT: '91', COD_MVT: 'SR', NUM_PAL: 'K2', REF: '009A', QTE_SCDN: 1 },
      { CHRONO: 7, TYP_MVT: '2Q', COD_MVT: 'RZ', NUM_PAL: 'P1', QTE_SCDN: 3 },
    ]);
    assert.deepEqual(docs.map((d) => d.sscc), ['K1', 'P1']);
  });
});

describe('round 2: new sscc codes', () => {
  const COMMON = { NUM_BL: 'BLX', ZONE: 'RK', ALLEE: 'REC', TRAVEE: '800', NIVEAU: '00' };

  function assertCommon(d, { movementType, code, action, actionDetail, eventType, prev, cur, location = 'RKREC80000' }) {
    assert.equal(d.movement_type, movementType);
    assert.equal(d.code, code);
    assert.equal(d.object_search_type, 'sscc');
    assert.equal(d.object_type, 'stock');
    assert.equal(d.object_number, 'S1');
    assert.equal(d.sscc, 'S1');
    assert.equal(d.action, action);
    assert.equal(d.action_detail, actionDetail);
    assert.equal(d.event_type, eventType);
    assert.equal(d.previous_value, prev);
    assert.equal(d.current_value, cur);
    assert.equal(d.location_address, location);
    assert.equal(d.cadre, 'BLX');
    assert.equal(d.tier, '');
    assert.equal(d.user_code_nom, 'UCRE');
    assert.equal(d.created_at, mergeDateAndTime('2026-06-01', '10:00:00'));
    assert.equal(d.reference_number, 'REF1');
    assert.equal(d.lot_nom, 'LOT1');
    assert.equal(d.dluo, Math.floor(new Date('2027-01-01').getTime() / 1000));
    assert.deepEqual(d.no_cdn, ['N1']);
  }

  test('21/RV retour de vides', async () => {
    const docs = await run([{ CHRONO: 1, TYP_MVT: '21', COD_MVT: 'RV', NUM_PAL: 'S1', QTE_SCDN: 5, ...COMMON }]);
    assert.equal(docs.length, 1);
    assertCommon(docs[0], {
      movementType: '21', code: 'RV', action: 'entry', actionDetail: 'retour_vide_entry',
      eventType: 'sscc_stock_retour_vide_created', prev: '', cur: '5',
    });
    assert.equal(docs[0].carton_number, '5');
  });

  test('21/RV retour de vides of a support is movement 92', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '21', COD_MVT: 'RV', NUM_PAL: 'S1', REF: '0090029301', QTE_SCDN: 1, ...COMMON },
      { CHRONO: 2, TYP_MVT: '30', COD_MVT: '', ETAT: '0', NUM_PAL: 'S1', REF: '0090029301', QTE_SCDN: 1, ...COMMON },
    ]);
    const rv = docs.filter((d) => d.event_type == 'sscc_stock_retour_vide_created');
    assert.equal(rv.length, 1);
    assert.equal(rv[0].movement_type, '92');
    assert.equal(rv[0].code, 'RV');
  });

  test('22 transfert inter-dépôts entrée (CK and TF)', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '22', COD_MVT: 'CK', NUM_PAL: 'S1', QTE_SCDN: 12, ...COMMON },
      { CHRONO: 2, TYP_MVT: '22', COD_MVT: 'TF', NUM_PAL: 'S1', QTE_SCDN: 7, ...COMMON },
    ]);
    assert.equal(docs.length, 2);
    assertCommon(docs[0], {
      movementType: '22', code: 'CK', action: 'entry', actionDetail: 'transfert_inter_depots',
      eventType: 'sscc_enter_by_transfert', prev: '', cur: '12',
    });
    assert.equal(docs[1].code, 'TF');
    assert.equal(docs[1].current_value, '7');
  });

  test('78/TF transfert inter-dépôts sortie', async () => {
    const docs = await run([{ CHRONO: 1, TYP_MVT: '78', COD_MVT: 'TF', NUM_PAL: 'S1', QTE_SCDN: 9, ...COMMON }]);
    assert.equal(docs.length, 1);
    assertCommon(docs[0], {
      movementType: '78', code: 'TF', action: 'exit', actionDetail: 'transfert_inter_depots',
      eventType: 'sscc_exit_by_transfert', prev: '', cur: '',
    });
    assert.equal(docs[0].carton_number, '9');
  });

  test('7O/CA (DAT_VAL NULL) exit to copacking, location from ZON_ORI parts', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '7O', COD_MVT: 'CA', NUM_PAL: 'S1', QTE_SCDN: 4, ...COMMON, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null, ZON_ORI: 'SD', ALL_ORI: '006', TRA_ORI: 'G31', NIV_ORI: '00' },
    ]);
    assert.equal(docs.length, 1);
    assertCommon(docs[0], {
      movementType: '7O', code: 'CA', action: 'exit', actionDetail: 'mouvement_vers_copacking',
      eventType: 'sscc_exit_to_copacking', prev: '', cur: '', location: 'SD006G3100',
    });
  });

  test('2O/CA (DAT_VAL NULL) enter to copacking, location from ZONE parts', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '2O', COD_MVT: 'CA', NUM_PAL: 'S1', QTE_SCDN: 4, ...COMMON, DAT_VAL: null, HEU_VAL: null, UTI_VAL: null },
    ]);
    assert.equal(docs.length, 1);
    assertCommon(docs[0], {
      movementType: '2O', code: 'CA', action: 'entry', actionDetail: 'mouvement_vers_copacking',
      eventType: 'sscc_enter_to_copacking', prev: '', cur: '',
    });
  });

  test('7Z/CK chain: 12 DE 702 -> 7Z 162 gives prev 702 cur 540 and updates mapSscc', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', NUM_PAL: 'S1', NUM_BL: 'BLX', QTE_SCDN: 702, QTE_SORI: 702 },
      { CHRONO: 2, TYP_MVT: '7Z', COD_MVT: 'CK', NUM_PAL: 'S1', QTE_SCDN: 162, QTE_SORI: 702, ...COMMON },
      { CHRONO: 3, TYP_MVT: '7Z', COD_MVT: 'CK', NUM_PAL: 'S1', QTE_SCDN: 40, QTE_SORI: 702, ...COMMON },
      { CHRONO: 4, TYP_MVT: '7Z', COD_MVT: 'CK', NUM_PAL: 'S9', QTE_SCDN: 10, QTE_SORI: 50, ...COMMON },
    ]);
    const z = byType(docs, '7Z');
    assert.equal(z.length, 3);
    assertCommon(z[0], {
      movementType: '7Z', code: 'CK', action: 'exit', actionDetail: 'copacking_palette',
      eventType: 'sscc_exit_by_copacking', prev: '702', cur: '540',
    });
    assert.equal(z[0].carton_number, '162');
    assert.deepEqual([z[1].previous_value, z[1].current_value], ['540', '500']);
    // unseen SSCC falls back to QTE_SORI
    assert.deepEqual([z[2].previous_value, z[2].current_value], ['50', '40']);
  });

  test('2Z/CK child enter by copacking (prev empty, cur QTE_SCDN) and seeds mapSscc', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '2Z', COD_MVT: 'CK', NUM_PAL: 'S1', QTE_SCDN: 8, ...COMMON },
      { CHRONO: 2, TYP_MVT: '71', COD_MVT: 'SR', NUM_PAL: 'S1', QTE_SCDN: 3, QTE_SORI: 999 },
    ]);
    assert.equal(docs.length, 2);
    assertCommon(docs[0], {
      movementType: '2Z', code: 'CK', action: 'entry', actionDetail: 'copacking_palette',
      eventType: 'sscc_enter_by_copacking', prev: '', cur: '8',
    });
    assert.equal(docs[0].carton_number, '8');
    // 71 after 2Z reads the seeded carton_number (8), not QTE_SORI
    assert.deepEqual([docs[1].previous_value, docs[1].current_value], ['8', '5']);
  });
});

describe('r298 review fixes', () => {
  // 009 support with no 30 row -> not in the keep-set -> dropped
  const SUP = { REF: '009SUP', NUM_PAL: 'SUP1', QTE_SCDN: 10 };

  test('dropped-support etat-0 attendu BL -> exactly one A-1, no sscc doc', async () => {
    const docs = await run([
      { CHRONO: 1, ...SUP, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '0', NUM_BL: 'BLS', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 2, ...SUP, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '1', NUM_BL: 'BLS' },
    ]);
    assert.deepEqual(docs.map((d) => [d.object_search_type, d.event_type]), [['attendu', 'A-1']]);
  });

  test('dropped-support 79-0 commande -> C-1 + C-8, no sscc 79 line', async () => {
    const docs = await run([
      { CHRONO: 1, ...SUP, TYP_MVT: '79', COD_MVT: 'SO', ETAT: '0', NUM_CMD: 'CMDS', DAT_VAL: null, HEU_VAL: null },
    ]);
    assert.deepEqual(docs.map((d) => [d.object_search_type, d.event_type]), [['commande', 'C-1'], ['commande', 'C-8']]);
  });

  test('empty NUM_CMD 61 row -> no commande doc', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '61', COD_MVT: 'PF', ETAT: '0', NUM_PAL: 'S1', NUM_CMD: '', DAT_VAL: null, HEU_VAL: null },
      { CHRONO: 2, TYP_MVT: '61', COD_MVT: 'PF', ETAT: '0', NUM_PAL: 'S2', NUM_CMD: null, DAT_VAL: null, HEU_VAL: null },
    ]);
    assert.deepEqual(docs.filter((d) => d.object_search_type == 'commande'), []);
  });

  test('sscc_legacy_entry user = UTI_VAL (fallback UTI_CRE)', async () => {
    const docs = await run([
      { CHRONO: 1, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '1', NUM_PAL: 'S1', NUM_BL: 'BLU', UTI_VAL: 'VALU', UTI_CRE: 'CREU' },
      { CHRONO: 2, TYP_MVT: '12', COD_MVT: 'DE', ETAT: '1', NUM_PAL: 'S2', NUM_BL: 'BLU', UTI_VAL: null, UTI_CRE: 'CREU' },
    ]);
    const e = docs.filter((d) => d.event_type == 'sscc_legacy_entry');
    assert.deepEqual(e.map((d) => d.user_code_nom), ['VALU', 'CREU']);
  });
});
