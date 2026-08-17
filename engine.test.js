// Testes do motor de agendamento.
//
// O app é um HTML único com JSX transpilado no navegador, então não dá pra
// importar nada. Este harness extrai do arquivo as funções puras do motor (as
// que não tocam em React) pelo nome, avalia num sandbox e roda asserções em
// cima. Rodar com:  node Cronogramas/engine.test.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");

const SRC = fs.readFileSync(path.join(__dirname, "Cronogramas_v2.html"), "utf8");

// Nomes exportados pro sandbox. Ordem não importa: são declarações de função
// (hoisted) e constantes de topo, avaliadas todas juntas.
const FN_NAMES = [
  "dayWindow", "withinAvailability", "activityTimes", "blockedWindow", "bookingMatchesResource",
  "fieldFree", "loadOf", "equipAccessoryOptions", "equipCombinationFree", "participantLimit",
  "unionDayWindow", "rowResourcePool", "dayBoundsForRow", "findSlotOnDay", "validateBooking",
  "baseTypeName", "typeCandidates", "nextCalibrationDate", "calibrationStatus", "bookingCost",
  "suggestCombo", "scorePlan", "planItemFrom", "tentativeBooking", "rowCriteria",
  "planSameDay", "planSpread", "diagnoseRows", "timepointWindow", "protocolDeviation",
  "normalizeProtocol", "makeRow", "makeTimepointDraft", "draftWindow",
  "groupRows", "groupWindow", "suggestGroup", "dayBoundsForGroup", "findGroupSlotOnDay",
  "mergeIntervals", "roomBookedMinutesOnDate", "roomAvailableMinutesOnDate", "dailyCapacityPct", "bookingsCost",
  "bookingStatusFor", "trainingBookingFrom", "trainingsNeededFor",
  "holdExpired", "bookingOccupies", "bookingTypeOf", "estimateEffectiveStatus",
  "absenceOn", "absenceLabel", "easterSunday", "nationalHolidays",
  "studyWindow", "studyFit", "protocolEnd", "protocolSpan",
  "normalizeRoleCapabilities",
  "estimateAsStudyShape", "estimateConversionBlockers", "bookingFromEstimateBooking", "timepointsFromEstimate",
  "supplyOutlook", "capacityReuse", "conversionStats",
  "seedStudiesBundle", "seedLocations", "seedActivities", "seedEquipment",
  "seedCollaborators", "seedDoctors", "seedSupplies", "seedSponsors", "seedNiches",
];
const CONST_NAMES = [
  "genId", "toMin", "overlaps", "fmtDate", "addDays", "weekdayKey", "weekdayLabel", "todayStr",
  "DEFAULT_AVAIL", "WEEKDAYS", "bookingBlock", "addMinutes", "SLOT_STEP_MIN", "minToHHMM",
  "PLAN_WEIGHTS", "STUDY_STATUS", "isStudyOpen",
  "TRAINING_STATUS_META", "TRAINING_DEFAULT_MIN", "isTrainingBooking", "pickList",
  "BOOKING_TYPE_META", "isEstimateBooking", "nowStamp", "nowHHMM",
  "ESTIMATE_STATUS_META", "ESTIMATE_OPEN", "ESTIMATE_CLOSED", "isEstimateOpen", "estimateHoldsNow",
  "ABSENCE_KINDS", "ABSENCE_KIND_META", "daysBetween",
  "ACTIVITY_NAMES", "LOCATION_NAMES", "SPONSOR_NAMES", "CUSTOM_NICHE_SPONSORS",
  // Ordem importa: o harness emite os `const` na sequência desta lista, e
  // DEFAULT_ROLE_SCREENS usa TELAS_DO_DIA_A_DIA.
  "SCREENS", "screenCap", "SCREEN_CAPS", "TELAS_DO_DIA_A_DIA", "DEFAULT_ROLE_SCREENS",
  "CAPABILITIES", "CAP_GROUPS", "DEFAULT_ROLE_CAPABILITIES", "EDITABLE_ROLES",
];

// Anda pelo texto contando (){}[] fora de string/comentário e devolve a
// declaração inteira — funciona tanto pra `function f(){...}` quanto pra
// `const X = {...}` de várias linhas ou de uma linha só com comentário no fim.
function grab(name, isConst) {
  const head = isConst ? `\nconst ${name} = ` : `\nfunction ${name}(`;
  const at = SRC.indexOf(head);
  if (at < 0) throw new Error(`não achei ${name} no arquivo`);
  let i = at + 1, depth = 0, started = false;
  let str = null, inLine = false, inBlock = false;
  for (; i < SRC.length; i++) {
    const c = SRC[i], n = SRC[i + 1];
    if (inLine) { if (c === "\n") inLine = false; continue; }
    if (inBlock) { if (c === "*" && n === "/") { inBlock = false; i++; } continue; }
    if (str) {
      if (c === "\\") { i++; continue; }
      if (c === str) str = null;
      continue;
    }
    if (c === "/" && n === "/") { inLine = true; i++; continue; }
    if (c === "/" && n === "*") { inBlock = true; i++; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if ("({[".includes(c)) { depth++; started = true; continue; }
    if (")}]".includes(c)) {
      depth--;
      // Função termina no `}` do corpo. O `)` da lista de parâmetros também
      // zera a profundidade, mas não é o fim da declaração.
      if (!isConst && started && depth === 0 && c === "}") return SRC.slice(at + 1, i + 1);
      continue;
    }
    // Const termina no `;` ou na quebra de linha em profundidade zero — assim
    // tanto `const X = 15; // nota` quanto um objeto de várias linhas funcionam.
    if (isConst && depth === 0 && (c === ";" || c === "\n")) return SRC.slice(at + 1, i + 1);
  }
  throw new Error(`não consegui delimitar ${name}`);
}

const ALL = [...CONST_NAMES, ...FN_NAMES];
// `const`/`function` num vm.Script ficam no escopo do script, não viram
// propriedade do sandbox — daí a linha final que exporta tudo explicitamente.
const code = [
  ...CONST_NAMES.map((n) => grab(n, true)),
  ...FN_NAMES.map((n) => grab(n, false)),
  `globalThis.__E = { ${ALL.join(", ")} };`,
].join("\n");
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const E = sandbox.__E;

/* ---------------------------------------------------------------------- */
/* Cenário base                                                            */
/* ---------------------------------------------------------------------- */
const AVAIL = (start, end, extra) => ({ mon: true, tue: true, wed: true, thu: true, fri: true, sat: false, sun: false, start, end, ...extra });
// Uma segunda-feira, pra não cair em dia fechado.
const MON = "2026-08-17";
assert.equal(E.weekdayKey(MON), "mon", "data base precisa ser segunda");

function scenario(over = {}) {
  return {
    activities: [
      { id: "act1", name: "Corneometria", durationMin: 60, setupMin: 15, teardownMin: 10, minGapMin: 5, staffCount: 1, maxParticipants: 8 },
      { id: "act2", name: "Dupla", durationMin: 60, setupMin: 0, teardownMin: 0, minGapMin: 0, staffCount: 2 },
    ],
    locations: [{ id: "loc1", name: "Sala A", availability: AVAIL("08:00", "18:00"), active: true, capacity: 10, hourlyCost: 20 }],
    equipment: [
      { id: "eq1", name: "Corneometer A-EM-100", isAccessory: false, accessoryIds: [], availability: AVAIL("08:00", "18:00"), active: true, hourlyCost: 10 },
      { id: "eq2", name: "Corneometer A-EM-200", isAccessory: false, accessoryIds: [], availability: AVAIL("08:00", "18:00"), active: true, hourlyCost: 10 },
    ],
    collaborators: [
      { id: "col1", name: "Ana", levels: { act1: 2, act2: 2 }, availability: AVAIL("08:00", "18:00"), active: true, hourlyCost: 25 },
      { id: "col2", name: "Bruno", levels: { act1: 2, act2: 2 }, availability: AVAIL("08:00", "18:00"), active: true, hourlyCost: 25 },
    ],
    doctors: [{ id: "doc1", name: "Dra. Rita", availability: AVAIL("08:00", "18:00"), active: true, hourlyCost: 120 }],
    supplies: [],
    ...over,
  };
}
const ROW = (over = {}) => ({ rowId: "r1", activityId: "act1", durationMin: 60, roomId: null, equipmentId: null, accessoryIds: [], needDoctor: false, participants: null, minLevel: 1, ...over });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message); }
}

/* ---------------------------------------------------------------------- */
console.log("\nJanela do dia a partir dos horários cadastrados (sem 08:00/20:00 fixo)");

test("usa a interseção real das janelas cadastradas", () => {
  const data = scenario();
  data.locations[0].availability = AVAIL("07:00", "22:00");
  data.collaborators.forEach((c) => (c.availability = AVAIL("09:00", "16:00")));
  const b = E.dayBoundsForRow(E.rowCriteria(ROW()), data, MON);
  assert.deepEqual(b, { startMin: 9 * 60, endMin: 16 * 60 });
});

test("sala que abre cedo permite agendar antes das 08:00", () => {
  const data = scenario();
  data.locations[0].availability = AVAIL("06:00", "18:00");
  data.collaborators.forEach((c) => (c.availability = AVAIL("06:00", "18:00")));
  data.equipment.forEach((e) => (e.availability = AVAIL("06:00", "18:00")));
  const slot = E.findSlotOnDay(E.rowCriteria(ROW()), MON, data, [], undefined, {});
  assert.equal(slot.start, "06:15", "preparo de 15min tem que caber depois das 06:00");
});

test("dia sem nenhum recurso aberto devolve null", () => {
  const data = scenario();
  const sunday = "2026-08-16";
  assert.equal(E.dayBoundsForRow(E.rowCriteria(ROW()), data, sunday), null);
});

test("horário por dia da semana (perDay) sobrepõe o geral", () => {
  const data = scenario();
  data.locations[0].availability = AVAIL("08:00", "18:00", { sat: true, perDay: { sat: { start: "08:00", end: "12:00" } } });
  const sat = "2026-08-22";
  assert.equal(E.dayWindow(data.locations[0], sat).end, "12:00");
});

/* ---------------------------------------------------------------------- */
console.log("\nBusca de horário de 15 em 15 minutos");

test("acha o primeiro slot livre em vez de desistir num horário fixo", () => {
  const data = scenario();
  // Bloqueia 08:00–12:00 com a sala ocupada; a busca precisa pular pra depois.
  const busy = [{ id: "b0", date: MON, start: "07:45", end: "12:00", blockStart: "07:45", blockEnd: "12:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  const slot = E.findSlotOnDay(E.rowCriteria(ROW()), MON, data, busy, undefined, {});
  assert.ok(slot, "deveria achar horário à tarde");
  assert.ok(E.toMin(slot.start) >= 12 * 60 + 15, `começou ${slot.start}, esperado >= 12:15`);
});

test("a granularidade é de 15 minutos", () => {
  const data = scenario();
  const busy = [{ id: "b0", date: MON, start: "08:00", end: "09:20", blockStart: "08:00", blockEnd: "09:20", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  const slot = E.findSlotOnDay(E.rowCriteria(ROW()), MON, data, busy, undefined, {});
  assert.equal(E.toMin(slot.start) % 15, 0, `slot ${slot.start} não é múltiplo de 15min`);
});

test("dia lotado não devolve slot", () => {
  const data = scenario();
  const busy = [{ id: "b0", date: MON, start: "08:00", end: "18:00", blockStart: "07:00", blockEnd: "19:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  assert.equal(E.findSlotOnDay(E.rowCriteria(ROW()), MON, data, busy, undefined, {}), null);
});

/* ---------------------------------------------------------------------- */
console.log("\nEquipamento por tipo, não por patrimônio");

test("cai pra outra unidade do mesmo tipo quando a pedida está ocupada", () => {
  const data = scenario();
  // Só o equipamento está ocupado — a sala continua livre, senão o teste
  // reprovaria por falta de sala e não pelo motivo que interessa.
  const busy = [{ id: "b0", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: "eq1", collaboratorIds: [], accessoryIds: [] }];
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 }, data, busy);
  assert.ok(r.success, "deveria fechar usando a segunda unidade: " + JSON.stringify(r.missing));
  assert.equal(r.equipment.id, "eq2");
  assert.ok(r.equipmentSwapped, "precisa avisar que trocou de patrimônio");
});

test("lockEquipmentUnit força o patrimônio exato", () => {
  const data = scenario();
  const busy = [{ id: "b0", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: "eq1", collaboratorIds: [], accessoryIds: [] }];
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 },
    data, busy, undefined, { lockEquipmentUnit: true });
  assert.equal(r.success, false);
});

test("unidade com calibração vencida é pulada, não derruba o agendamento", () => {
  const data = scenario();
  data.equipment[0].lastCalibration = "2025-01-01";
  data.equipment[0].calibrationIntervalDays = 30;
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 }, data, []);
  assert.ok(r.success);
  assert.equal(r.equipment.id, "eq2");
});

test("todas as unidades ocupadas reprova com mensagem de tipo", () => {
  const data = scenario();
  const busy = ["eq1", "eq2"].map((id, i) => ({ id: "b" + i, date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: id, collaboratorIds: [], accessoryIds: [] }));
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 }, data, busy);
  assert.equal(r.success, false);
  assert.ok(r.missing.some((m) => m.includes("Corneometer")), "mensagem deveria citar o tipo: " + JSON.stringify(r.missing));
});

/* ---------------------------------------------------------------------- */
console.log("\nPreparo, desmontagem e intervalo mínimo");

test("a janela bloqueada inclui preparo e desmontagem", () => {
  const data = scenario();
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1, accessoryIds: [] }, data, []);
  assert.equal(r.blockStart, "08:45");
  assert.equal(r.blockEnd, "10:10");
});

test("conflito é medido contra a janela bloqueada, não contra o horário exibido", () => {
  const data = scenario();
  // Reserva existente 10:15–11:15: não encosta em 09:00–10:00, mas a desmontagem
  // desta (até 10:10) e o preparo daquela (10:00) se cruzam.
  const busy = [{ id: "b0", date: MON, start: "10:15", end: "11:15", blockStart: "10:00", blockEnd: "11:25", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  assert.equal(E.fieldFree("loc1", "location", MON, "08:45", "10:10", busy), false);
});

test("planSameDay respeita o intervalo mínimo entre atividades", () => {
  const data = scenario();
  const rows = [ROW({ rowId: "r1" }), ROW({ rowId: "r2" })];
  const plan = E.planSameDay({ dateMin: MON, dateMax: MON, rows }, data, []);
  assert.ok(plan, "plano do mesmo dia deveria fechar");
  const [a, b] = plan.items;
  const t = E.activityTimes(data.activities[0]);
  assert.ok(E.toMin(b.start) - t.setup >= E.toMin(a.end) + t.teardown + t.gap,
    `segunda atividade começou cedo demais: ${a.end} -> ${b.start}`);
});

/* ---------------------------------------------------------------------- */
console.log("\nEquipe de mais de uma pessoa e participantes");

test("atividade com staffCount 2 aloca duas pessoas", () => {
  const data = scenario();
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act2", minLevel: 1, accessoryIds: [] }, data, []);
  assert.ok(r.success);
  assert.equal(r.collaborators.length, 2);
});

test("sala pequena demais pro grupo é rejeitada", () => {
  const data = scenario();
  data.locations[0].capacity = 4;
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1, participants: 6, accessoryIds: [] }, data, []);
  assert.equal(r.success, false);
});

/* ---------------------------------------------------------------------- */
console.log("\nValidação de edição manual de reserva");

const EDITED = (over = {}) => ({
  id: "bk1", date: MON, start: "09:00", end: "10:00", locationId: "loc1", activityId: "act1",
  equipmentId: null, accessoryIds: [], collaboratorIds: ["col1"], doctorId: null, participants: 2, ...over,
});

test("edição válida passa sem erro", () => {
  const v = E.validateBooking(EDITED(), scenario(), [], "bk1");
  assert.deepEqual(v.errors, []);
});

test("recalcula blockStart/blockEnd com o novo horário", () => {
  const v = E.validateBooking(EDITED({ start: "14:00", end: "15:00" }), scenario(), [], "bk1");
  assert.equal(v.blockStart, "13:45");
  assert.equal(v.blockEnd, "15:10");
});

test("pega conflito de sala criado à mão", () => {
  const other = [{ id: "bk2", date: MON, start: "09:30", end: "10:30", blockStart: "09:15", blockEnd: "10:40", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  const v = E.validateBooking(EDITED(), scenario(), other, "bk1");
  assert.ok(v.errors.some((e) => e.includes("sala")), JSON.stringify(v.errors));
});

test("pega conflito de colaborador criado à mão", () => {
  const other = [{ id: "bk2", date: MON, start: "09:30", end: "10:30", blockStart: "09:30", blockEnd: "10:30", locationId: null, collaboratorIds: ["col1"], accessoryIds: [] }];
  const v = E.validateBooking(EDITED(), scenario(), other, "bk1");
  assert.ok(v.errors.some((e) => e.includes("colaborador")), JSON.stringify(v.errors));
});

test("pega conflito de médico criado à mão", () => {
  const other = [{ id: "bk2", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: null, collaboratorIds: [], doctorId: "doc1", accessoryIds: [] }];
  const v = E.validateBooking(EDITED({ doctorId: "doc1" }), scenario(), other, "bk1");
  assert.ok(v.errors.some((e) => e.includes("médico")), JSON.stringify(v.errors));
});

test("pega conflito de equipamento criado à mão", () => {
  const other = [{ id: "bk2", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: "eq1", collaboratorIds: [], accessoryIds: [] }];
  const v = E.validateBooking(EDITED({ equipmentId: "eq1" }), scenario(), other, "bk1");
  assert.ok(v.errors.some((e) => e.includes("equipamento")), JSON.stringify(v.errors));
});

test("a própria reserva não conflita consigo mesma", () => {
  const self = [{ id: "bk1", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: "loc1", collaboratorIds: ["col1"], accessoryIds: [] }];
  const v = E.validateBooking(EDITED(), scenario(), self, "bk1");
  assert.deepEqual(v.errors, []);
});

test("fim antes do início é erro", () => {
  const v = E.validateBooking(EDITED({ start: "10:00", end: "09:00" }), scenario(), [], "bk1");
  assert.ok(v.errors.length > 0);
});

test("fora do horário cadastrado vira aviso de hora extra, não erro", () => {
  const v = E.validateBooking(EDITED({ start: "19:00", end: "20:00" }), scenario(), [], "bk1");
  assert.deepEqual(v.errors, [], "não deveria travar: " + JSON.stringify(v.errors));
  assert.ok(v.warnings.some((w) => w.includes("hora extra")), JSON.stringify(v.warnings));
});

test("participantes acima da capacidade da sala é erro", () => {
  const data = scenario();
  data.locations[0].capacity = 3;
  const v = E.validateBooking(EDITED({ participants: 9 }), data, [], "bk1");
  assert.ok(v.errors.some((e) => e.includes("comporta")), JSON.stringify(v.errors));
});

test("sem treinamento numa atividade que exige nível é erro", () => {
  // Passou a ser erro (era aviso): a edição manual não pode colocar numa
  // reserva confirmada alguém que o planejamento automático recusaria.
  const data = scenario();
  data.activities[0].minLevel = 3;
  data.collaborators[0].levels = {};
  const v = E.validateBooking(EDITED(), data, [], "bk1");
  assert.ok(v.errors.some((e) => e.includes("treinamento")), JSON.stringify(v.errors));
});

test("método sem nível mínimo definido só avisa, não trava", () => {
  const data = scenario(); // act1 não define minLevel
  data.collaborators[0].levels = {};
  const v = E.validateBooking(EDITED(), data, [], "bk1");
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => w.includes("treinamento")), JSON.stringify(v.warnings));
});

/* ---------------------------------------------------------------------- */
console.log("\nPontuação do plano");

const ITEM = (over = {}) => ({
  date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10",
  location: { id: "loc1" }, collaborators: [{ id: "col1" }], doctor: null, row: {}, ...over,
});

test("hora extra piora a pontuação", () => {
  const base = E.scorePlan([ITEM()], [], scenario(), { dateMin: MON });
  const ot = E.scorePlan([ITEM({ overtimeNeeded: { collaboratorId: "col1" } })], [], scenario(), { dateMin: MON });
  assert.ok(ot > base, `${ot} deveria ser pior que ${base}`);
});

test("trocar de sala entre atividades piora a pontuação", () => {
  const same = E.scorePlan([ITEM(), ITEM({ start: "11:00", end: "12:00" })], [], scenario(), { dateMin: MON });
  const diff = E.scorePlan([ITEM(), ITEM({ start: "11:00", end: "12:00", location: { id: "loc9" } })], [], scenario(), { dateMin: MON });
  assert.ok(diff > same, `${diff} deveria ser pior que ${same}`);
});

test("gastar a tolerância do protocolo piora a pontuação", () => {
  const cedo = E.scorePlan([ITEM()], [], scenario(), { dateMin: MON });
  const tarde = E.scorePlan([ITEM({ date: E.addDays(MON, 5) })], [], scenario(), { dateMin: MON });
  assert.ok(tarde > cedo, `${tarde} deveria ser pior que ${cedo}`);
});

test("plano mais caro piora a pontuação", () => {
  const barato = scenario();
  const caro = scenario();
  caro.locations[0].hourlyCost = 2000;
  assert.ok(E.scorePlan([ITEM()], [], caro, { dateMin: MON }) > E.scorePlan([ITEM()], [], barato, { dateMin: MON }));
});

test("equipe desequilibrada piora a pontuação", () => {
  const data = scenario();
  const carga = Array.from({ length: 6 }, (_, i) => ({
    id: "x" + i, date: MON, start: "09:00", end: "10:00", locationId: null, collaboratorIds: ["col2"], accessoryIds: [],
  }));
  const equilibrado = E.scorePlan([ITEM()], [], data, { dateMin: MON });
  const desequilibrado = E.scorePlan([ITEM({ collaborators: [{ id: "col1" }, { id: "col2" }] })], carga, data, { dateMin: MON });
  assert.ok(desequilibrado > equilibrado, `${desequilibrado} deveria ser pior que ${equilibrado}`);
});

test("plano vazio tem pontuação infinita (nunca vence uma ordenação)", () => {
  assert.equal(E.scorePlan([], [], scenario(), {}), Infinity);
});

/* ---------------------------------------------------------------------- */
console.log("\nDiagnóstico e protocolo");

test("diagnóstico varre o dia inteiro antes de reprovar", () => {
  const data = scenario();
  // Sala ocupada só de manhã: o diagnóstico não pode dizer que não cabe.
  const busy = [{ id: "b0", date: MON, start: "08:00", end: "12:00", blockStart: "08:00", blockEnd: "12:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  const d = E.diagnoseRows([ROW()], MON, MON, data, busy);
  assert.equal(d[0].ok, true, JSON.stringify(d[0]));
});

test("janela do timepoint sai do baseline + deslocamento", () => {
  const w = E.timepointWindow({ offsetDays: 7, toleranceDays: 2 }, "2026-08-17");
  assert.equal(w.target, "2026-08-24");
  assert.equal(w.dateMin, "2026-08-22");
  assert.equal(w.dateMax, "2026-08-26");
});

test("desvio de protocolo é detectado fora da tolerância", () => {
  const dev = E.protocolDeviation({ offsetDays: 7, toleranceDays: 2 }, "2026-08-17", "2026-08-28");
  assert.equal(dev.outOfWindow, true);
  assert.equal(dev.diff, 4);
});

/* ---------------------------------------------------------------------- */
console.log("\nUnificação Estudo + Protocolo + Timepoints");

test("estudo sem baseline adota a visita mais cedo como D0", () => {
  const studies = [{ id: "s1", name: "X", createdAt: "2026-01-01T00:00:00Z" }];
  const tps = [
    { id: "t2", studyId: "s1", label: "V2", dateMin: "2026-08-24", dateMax: "2026-08-28" },
    { id: "t1", studyId: "s1", label: "V1", dateMin: "2026-08-17", dateMax: "2026-08-17" },
  ];
  const n = E.normalizeProtocol(studies, tps);
  assert.equal(n.studies[0].baselineDate, "2026-08-17");
});

test("visita solta vira deslocamento + tolerância", () => {
  const studies = [{ id: "s1", name: "X", baselineDate: "2026-08-17" }];
  const tps = [{ id: "t2", studyId: "s1", label: "V2", dateMin: "2026-08-22", dateMax: "2026-08-26" }];
  const n = E.normalizeProtocol(studies, tps);
  assert.equal(n.timepoints[0].offsetDays, 7);
  assert.equal(n.timepoints[0].toleranceDays, 2);
});

test("a conversão não encolhe nem desloca a janela original", () => {
  const studies = [{ id: "s1", name: "X", baselineDate: "2026-08-17" }];
  for (const [min, max] of [["2026-08-20", "2026-08-24"], ["2026-08-20", "2026-08-25"], ["2026-08-19", "2026-08-19"]]) {
    const n = E.normalizeProtocol(studies, [{ id: "t", studyId: "s1", dateMin: min, dateMax: max }]);
    const w = E.timepointWindow(n.timepoints[0], "2026-08-17");
    assert.ok(w.dateMin <= min && w.dateMax >= max, `janela ${min}..${max} virou ${w.dateMin}..${w.dateMax}`);
  }
});

test("visita já no formato de protocolo não é tocada", () => {
  const studies = [{ id: "s1", name: "X", baselineDate: "2026-08-17" }];
  const tps = [{ id: "t1", studyId: "s1", offsetDays: 7, toleranceDays: 2, dateMin: "2026-08-22", dateMax: "2026-08-26" }];
  const n = E.normalizeProtocol(studies, tps);
  assert.strictEqual(n.timepoints[0], tps[0], "a visita fica idêntica");
  // O ESTUDO muda: ganha a janela contratada, que ele ainda não tinha.
  assert.equal(n.changed, true);
  assert.equal(n.studies[0].startMin, "2026-08-17");
});

test("normalizeProtocol é idempotente — não grava a cada carga", () => {
  // Roda em TODA carga da página; reportar `changed` sempre faria o app
  // escrever no banco sem nada ter mudado.
  const studies = [{ id: "s1", name: "X", baselineDate: "2026-08-17" }];
  const tps = [{ id: "t1", studyId: "s1", offsetDays: 7, toleranceDays: 2 }];
  const um = E.normalizeProtocol(studies, tps);
  const dois = E.normalizeProtocol(um.studies, um.timepoints);
  assert.equal(dois.changed, false, "a segunda passada não pode mudar nada");
  assert.strictEqual(dois.studies[0], um.studies[0]);
});

test("rascunho do assistente nasce como D0 e depois D+7±2", () => {
  const data = scenario();
  const d1 = E.makeTimepointDraft(data, 1), d2 = E.makeTimepointDraft(data, 2);
  assert.equal(d1.offsetDays, 0);
  assert.equal(d1.toleranceDays, 0);
  assert.equal(d2.offsetDays, 7);
  assert.equal(d2.toleranceDays, 2);
  assert.deepEqual(E.draftWindow(d1, MON), E.timepointWindow({ offsetDays: 0, toleranceDays: 0 }, MON));
});

/* ---------------------------------------------------------------------- */
console.log("\nDuas atividades na mesma sala ao mesmo tempo");

// Cenário do pedido: Apoio + Lavagem de cabelo juntas, mesma sala, 2 pessoas.
function scenarioGrupo() {
  const data = scenario();
  data.activities.push(
    { id: "apoio", name: "Apoio", durationMin: 60, setupMin: 0, teardownMin: 0, minGapMin: 0, staffCount: 1 },
    { id: "lavagem", name: "Lavagem de cabelo", durationMin: 90, setupMin: 0, teardownMin: 0, minGapMin: 0, staffCount: 1 }
  );
  data.collaborators.forEach((c) => { c.levels.apoio = 2; c.levels.lavagem = 2; });
  return data;
}
const GROUP = () => [
  ROW({ rowId: "g1", activityId: "apoio", groupKey: "A", durationMin: 60 }),
  ROW({ rowId: "g2", activityId: "lavagem", durationMin: 90, groupKey: "A" }),
];

test("mesma letra junta, sem letra fica sozinha", () => {
  const gs = E.groupRows([ROW({ rowId: "a", groupKey: "A" }), ROW({ rowId: "b", groupKey: "A" }), ROW({ rowId: "c" })]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[0].map((r) => r.rowId), ["a", "b"]);
  assert.deepEqual(gs[1].map((r) => r.rowId), ["c"]);
});

test("agrupa atividades que NÃO estão lado a lado", () => {
  const gs = E.groupRows([ROW({ rowId: "a", groupKey: "A" }), ROW({ rowId: "meio" }), ROW({ rowId: "b", groupKey: "A" })]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[0].map((r) => r.rowId), ["a", "b"], "as duas do grupo A têm que ficar juntas");
  assert.deepEqual(gs[1].map((r) => r.rowId), ["meio"]);
});

test("aceita três ou mais na mesma sala, e dois grupos distintos", () => {
  const gs = E.groupRows([
    ROW({ rowId: "a1", groupKey: "A" }), ROW({ rowId: "b1", groupKey: "B" }),
    ROW({ rowId: "a2", groupKey: "A" }), ROW({ rowId: "a3", groupKey: "A" }), ROW({ rowId: "b2", groupKey: "B" }),
  ]);
  assert.equal(gs.length, 2);
  assert.deepEqual(gs[0].map((r) => r.rowId), ["a1", "a2", "a3"]);
  assert.deepEqual(gs[1].map((r) => r.rowId), ["b1", "b2"]);
});

test("grupo com letra mas sozinho não quebra", () => {
  const gs = E.groupRows([ROW({ rowId: "a", groupKey: "A" })]);
  assert.equal(gs.length, 1);
  assert.equal(gs[0].length, 1);
});

test("três atividades juntas na mesma sala, três pessoas diferentes", () => {
  const data = scenarioGrupo();
  data.collaborators.push({ id: "col3", name: "Carla", levels: { apoio: 2, lavagem: 2, act1: 2 }, availability: AVAIL("08:00", "18:00"), active: true });
  const trio = [
    ROW({ rowId: "t1", activityId: "apoio", groupKey: "A" }),
    ROW({ rowId: "t2", activityId: "lavagem", groupKey: "A" }),
    ROW({ rowId: "t3", activityId: "act1", groupKey: "A" }),
  ];
  const r = E.suggestGroup(trio, MON, "09:00", data, [], undefined, {});
  assert.ok(r.success, JSON.stringify(r.missing));
  const pessoas = r.items.flatMap((i) => i.result.collaborators.map((c) => c.id));
  assert.equal(new Set(pessoas).size, pessoas.length, "ninguém pode se repetir: " + pessoas.join(","));
  assert.equal(new Set(r.items.map((i) => i.result.location.id)).size, 1, "tem que ser uma sala só");
});

test("as duas atividades saem na MESMA sala e no MESMO horário de início", () => {
  const r = E.suggestGroup(GROUP(), MON, "09:00", scenarioGrupo(), [], undefined, {});
  assert.ok(r.success, JSON.stringify(r.missing));
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].result.location.id, r.items[1].result.location.id, "salas diferentes");
  assert.equal(r.items[0].start, r.items[1].start, "inícios diferentes");
});

test("cada atividade mantém a própria duração", () => {
  const r = E.suggestGroup(GROUP(), MON, "09:00", scenarioGrupo(), [], undefined, {});
  assert.equal(r.items[0].end, "10:00");
  assert.equal(r.items[1].end, "10:30");
});

test("a sala fica bloqueada pela união das janelas", () => {
  const r = E.suggestGroup(GROUP(), MON, "09:00", scenarioGrupo(), [], undefined, {});
  assert.equal(r.blockStart, "09:00");
  assert.equal(r.blockEnd, "10:30", "tem que cobrir a atividade mais longa");
});

test("são duas PESSOAS diferentes, uma por atividade", () => {
  const r = E.suggestGroup(GROUP(), MON, "09:00", scenarioGrupo(), [], undefined, {});
  const p1 = r.items[0].result.collaborators.map((c) => c.id);
  const p2 = r.items[1].result.collaborators.map((c) => c.id);
  assert.equal(p1.length, 1);
  assert.equal(p2.length, 1);
  assert.notEqual(p1[0], p2[0], "a mesma pessoa não pode fazer as duas ao mesmo tempo");
});

test("com uma pessoa só o grupo não fecha", () => {
  const data = scenarioGrupo();
  data.collaborators = [data.collaborators[0]];
  const r = E.suggestGroup(GROUP(), MON, "09:00", data, [], undefined, {});
  assert.equal(r.success, false);
});

test("sala pequena demais pra soma dos participantes é rejeitada", () => {
  const data = scenarioGrupo();
  data.locations[0].capacity = 5;
  const group = [
    ROW({ rowId: "g1", activityId: "apoio", groupKey: "A", participants: 3 }),
    ROW({ rowId: "g2", activityId: "lavagem", participants: 4, groupKey: "A" }),
  ];
  const r = E.suggestGroup(group, MON, "09:00", data, [], undefined, {});
  assert.equal(r.success, false, "3+4=7 não cabe numa sala de 5");
  assert.ok(r.groupRoomRejected.some((x) => /comporta 5/.test(x.reason)), JSON.stringify(r.groupRoomRejected));
});

test("sala ocupada por terceiro derruba o grupo inteiro, não só uma atividade", () => {
  const busy = [{ id: "b0", date: MON, start: "09:00", end: "10:30", blockStart: "09:00", blockEnd: "10:30", locationId: "loc1", collaboratorIds: [], accessoryIds: [] }];
  const r = E.suggestGroup(GROUP(), MON, "09:00", scenarioGrupo(), busy, undefined, {});
  assert.equal(r.success, false);
});

test("as duas atividades podem usar equipamentos diferentes do mesmo tipo", () => {
  const data = scenarioGrupo();
  const group = [
    ROW({ rowId: "g1", activityId: "apoio", groupKey: "A", equipmentId: "eq1" }),
    ROW({ rowId: "g2", activityId: "lavagem", equipmentId: "eq1", groupKey: "A" }),
  ];
  const r = E.suggestGroup(group, MON, "09:00", data, [], undefined, {});
  assert.ok(r.success, JSON.stringify(r.missing));
  assert.notEqual(r.items[0].result.equipment.id, r.items[1].result.equipment.id, "não dá pra usar o mesmo aparelho nas duas");
});

test("grupo de uma linha só se comporta igual ao motor de sempre", () => {
  const data = scenarioGrupo();
  const one = [ROW({ rowId: "s", activityId: "apoio" })];
  const g = E.suggestGroup(one, MON, "09:00", data, [], undefined, {});
  const c = E.suggestCombo({ ...E.rowCriteria(one[0]), date: MON, start: "09:00", end: "10:00" }, data, [], undefined, {});
  assert.equal(g.success, c.success);
  assert.equal(g.items[0].result.location.id, c.location.id);
});

test("planSameDay agenda o grupo junto e a atividade seguinte depois", () => {
  const data = scenarioGrupo();
  const rows = [...GROUP(), ROW({ rowId: "depois", activityId: "apoio", durationMin: 30 })];
  const plan = E.planSameDay({ dateMin: MON, dateMax: MON, rows }, data, []);
  assert.ok(plan, "o plano deveria fechar");
  assert.equal(plan.items.length, 3);
  const [a, b, c] = plan.items;
  assert.equal(a.start, b.start, "as duas do grupo começam juntas");
  assert.equal(a.location.id, b.location.id, "e na mesma sala");
  assert.equal(a.groupId, b.groupId);
  assert.equal(a.groupSize, 2);
  assert.ok(E.toMin(c.start) >= E.toMin(b.end), `a terceira (${c.start}) tem que vir depois do fim do grupo (${b.end})`);
  assert.equal(c.groupSize, 1);
});

test("planSpread mantém o grupo no mesmo dia e horário", () => {
  const data = scenarioGrupo();
  const plan = E.planSpread({ dateMin: MON, dateMax: E.addDays(MON, 4), rows: GROUP() }, data, []);
  assert.ok(plan);
  assert.equal(plan.items[0].date, plan.items[1].date);
  assert.equal(plan.items[0].start, plan.items[1].start);
  assert.equal(plan.items[0].location.id, plan.items[1].location.id);
});

test("diagnóstico devolve um veredito por linha, compartilhado no grupo", () => {
  const data = scenarioGrupo();
  data.collaborators = [data.collaborators[0]]; // só uma pessoa: o grupo não fecha
  const d = E.diagnoseRows(GROUP(), MON, MON, data, []);
  assert.equal(d.length, 2, "a UI procura o diagnóstico por rowId, precisa ter os dois");
  assert.equal(d[0].ok, false);
  assert.equal(d[0].groupSize, 2);
});

test("colegas de grupo não contam como conflito de sala entre si", () => {
  const data = scenarioGrupo();
  const irmas = [
    { id: "x1", groupId: "tp:g1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", activityId: "apoio", collaboratorIds: ["col1"], accessoryIds: [] },
    { id: "x2", groupId: "tp:g1", date: MON, start: "09:00", end: "10:30", blockStart: "09:00", blockEnd: "10:30", locationId: "loc1", activityId: "lavagem", collaboratorIds: ["col2"], accessoryIds: [] },
  ];
  const v = E.validateBooking({ ...irmas[0] }, data, irmas, "x1");
  assert.deepEqual(v.errors, [], "a irmã de grupo não pode aparecer como conflito: " + JSON.stringify(v.errors));
});

test("mas a mesma PESSOA nas duas continua sendo erro", () => {
  const data = scenarioGrupo();
  const irmas = [
    { id: "x1", groupId: "tp:g1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", activityId: "apoio", collaboratorIds: ["col1"], accessoryIds: [] },
    { id: "x2", groupId: "tp:g1", date: MON, start: "09:00", end: "10:30", blockStart: "09:00", blockEnd: "10:30", locationId: "loc1", activityId: "lavagem", collaboratorIds: ["col1"], accessoryIds: [] },
  ];
  const v = E.validateBooking({ ...irmas[0] }, data, irmas, "x1");
  assert.ok(v.errors.some((e) => e.includes("colaborador")), JSON.stringify(v.errors));
});

test("reserva de outro estudo na mesma sala continua sendo conflito", () => {
  const data = scenarioGrupo();
  const minha = { id: "x1", groupId: "tp:g1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", activityId: "apoio", collaboratorIds: ["col1"], accessoryIds: [] };
  const alheia = { id: "z9", date: MON, start: "09:30", end: "10:30", blockStart: "09:30", blockEnd: "10:30", locationId: "loc1", collaboratorIds: [], accessoryIds: [] };
  const v = E.validateBooking(minha, data, [minha, alheia], "x1");
  assert.ok(v.errors.some((e) => e.includes("sala")), JSON.stringify(v.errors));
});

/* ---------------------------------------------------------------------- */
console.log("\nCorreções do teste destrutivo");

test("nível ABAIXO do exigido é erro, não aviso", () => {
  const data = scenario();
  data.activities[0].minLevel = 3;
  data.collaborators[0].levels = { act1: 1 }; // tem treinamento, mas nível 1
  const v = E.validateBooking(EDITED(), data, [], "bk1");
  assert.ok(v.errors.some((e) => /nível 1/.test(e) && /3/.test(e)), JSON.stringify({ errors: v.errors, warnings: v.warnings }));
});

test("nível exatamente igual ao exigido passa", () => {
  const data = scenario();
  data.activities[0].minLevel = 2;
  data.collaborators[0].levels = { act1: 2 };
  assert.deepEqual(E.validateBooking(EDITED(), data, [], "bk1").errors, []);
});

test("acessório inativo é erro", () => {
  const data = scenario();
  data.equipment[0].accessoryIds = ["acc1"];
  data.equipment.push({ id: "acc1", name: "Sonda", isAccessory: true, active: false, availability: AVAIL("08:00", "18:00") });
  const v = E.validateBooking(EDITED({ equipmentId: "eq1", accessoryIds: ["acc1"] }), data, [], "bk1");
  assert.ok(v.errors.some((e) => /acessório/.test(e) && /inativo/.test(e)), JSON.stringify(v.errors));
});

test("acessório com calibração vencida é erro", () => {
  const data = scenario();
  data.equipment[0].accessoryIds = ["acc2"];
  data.equipment.push({ id: "acc2", name: "Probe", isAccessory: true, active: true, availability: AVAIL("08:00", "18:00"), lastCalibration: "2025-01-01", calibrationIntervalDays: 30 });
  const v = E.validateBooking(EDITED({ equipmentId: "eq1", accessoryIds: ["acc2"] }), data, [], "bk1");
  assert.ok(v.errors.some((e) => /calibração vencida/.test(e)), JSON.stringify(v.errors));
});

test("acessório que não pertence ao aparelho é erro", () => {
  const data = scenario();
  data.equipment[0].accessoryIds = [];
  data.equipment.push({ id: "acc3", name: "Sonda do outro", isAccessory: true, active: true, availability: AVAIL("08:00", "18:00") });
  const v = E.validateBooking(EDITED({ equipmentId: "eq1", accessoryIds: ["acc3"] }), data, [], "bk1");
  assert.ok(v.errors.some((e) => /não é compatível/.test(e)), JSON.stringify(v.errors));
});

test("troca automática de patrimônio respeita o acessório pedido", () => {
  const data = scenario();
  // A sonda só existe no eq1. Se eq1 estiver ocupado, NÃO pode cair no eq2.
  data.equipment[0].accessoryIds = ["sonda"];
  data.equipment[1].accessoryIds = [];
  data.equipment.push({ id: "sonda", name: "Sonda A", isAccessory: true, active: true, availability: AVAIL("08:00", "18:00") });
  const busy = [{ id: "b0", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: "eq1", collaboratorIds: [], accessoryIds: [] }];
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: ["sonda"], activityId: "act1", minLevel: 1 }, data, busy);
  assert.equal(r.success, false, "não pode montar MPA B + sonda do MPA A");
  assert.ok(r.rejected.some((x) => /não aceita/.test(x.reason)), JSON.stringify(r.rejected));
});

test("troca automática acontece quando o acessório serve nas duas unidades", () => {
  const data = scenario();
  data.equipment[0].accessoryIds = ["univ"];
  data.equipment[1].accessoryIds = ["univ"];
  data.equipment.push({ id: "univ", name: "Sonda universal", isAccessory: true, active: true, availability: AVAIL("08:00", "18:00") });
  const busy = [{ id: "b0", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10", locationId: null, equipmentId: "eq1", collaboratorIds: [], accessoryIds: [] }];
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: ["univ"], activityId: "act1", minLevel: 1 }, data, busy);
  assert.ok(r.success, JSON.stringify(r.missing));
  assert.equal(r.equipment.id, "eq2");
});

test("ocupação da sala usa união, não soma (atividades simultâneas)", () => {
  const data = scenario();
  const sala = data.locations[0]; // 08:00-18:00 = 600 min
  const grupo = [
    { id: "g1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", groupId: "G", collaboratorIds: [] },
    { id: "g2", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", groupId: "G", collaboratorIds: [] },
  ];
  assert.equal(E.roomBookedMinutesOnDate(sala, grupo, MON), 60, "duas atividades juntas ocupam 60min, não 120");
  assert.equal(E.dailyCapacityPct(sala, grupo, MON), 10);
});

test("reservas em horários distintos continuam somando", () => {
  const data = scenario();
  const sala = data.locations[0];
  const duas = [
    { id: "a", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: [] },
    { id: "b", date: MON, start: "14:00", end: "15:00", blockStart: "14:00", blockEnd: "15:00", locationId: "loc1", collaboratorIds: [] },
  ];
  assert.equal(E.roomBookedMinutesOnDate(sala, duas, MON), 120);
});

test("intervalos que se encostam viram um só", () => {
  assert.deepEqual(E.mergeIntervals([{ s: 0, e: 60 }, { s: 60, e: 120 }]), [{ s: 0, e: 120 }]);
  assert.deepEqual(E.mergeIntervals([{ s: 0, e: 30 }, { s: 60, e: 90 }]), [{ s: 0, e: 30 }, { s: 60, e: 90 }]);
});

test("custo não cobra a sala duas vezes num grupo simultâneo", () => {
  const data = scenario(); // sala custa 20/h
  const grupo = [
    { id: "g1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", groupId: "G", collaboratorIds: [], accessoryIds: [] },
    { id: "g2", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", groupId: "G", collaboratorIds: [], accessoryIds: [] },
  ];
  assert.equal(E.bookingsCost(grupo, data), 20, "a sala entra uma vez só");
});

test("reservas sem grupo cobram a sala de cada uma", () => {
  const data = scenario();
  const duas = [
    { id: "a", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] },
    { id: "b", date: MON, start: "14:00", end: "15:00", blockStart: "14:00", blockEnd: "15:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] },
  ];
  assert.equal(E.bookingsCost(duas, data), 40);
});

test("data de hoje usa o calendário local, não UTC", () => {
  // 22:30 do dia 13 no fuso local: com toISOString viraria dia 14 em UTC-3.
  const noite = new Date(2026, 7, 13, 22, 30, 0);
  assert.equal(E.fmtDate(noite), "2026-08-13");
  const madrugada = new Date(2026, 7, 13, 0, 5, 0);
  assert.equal(E.fmtDate(madrugada), "2026-08-13");
});

test("addDays continua correto com a formatação local", () => {
  assert.equal(E.addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(E.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(E.addDays("2026-03-01", -1), "2026-02-28");
});

/* ---------------------------------------------------------------------- */
console.log("\nSegunda rodada do teste destrutivo");

test("reserva CONFIRMADA sem equipe suficiente é erro", () => {
  const data = scenario();
  data.activities[0].staffCount = 2;
  const v = E.validateBooking(EDITED({ collaboratorIds: ["col1"], status: "confirmado" }), data, [], "bk1");
  assert.ok(v.errors.some((e) => /equipe completa/.test(e)), JSON.stringify(v.errors));
});

test("reserva em pendente_equipe pode ficar incompleta (só avisa)", () => {
  const data = scenario();
  data.activities[0].staffCount = 2;
  const v = E.validateBooking(EDITED({ collaboratorIds: ["col1"], status: "pendente_equipe" }), data, [], "bk1");
  assert.deepEqual(v.errors, []);
  assert.ok(v.warnings.some((w) => /pede 2/.test(w)), JSON.stringify(v.warnings));
});

test("status sai de confirmado quando falta gente, e volta quando completa", () => {
  const act = { id: "act1", staffCount: 2 };
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a"] }, act), "pendente_equipe");
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a", "b"] }, act), "confirmado");
});

test("needDoctor sem médico impede confirmar", () => {
  const act = { id: "act1", staffCount: 1 };
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a"], needDoctor: true, doctorId: null }, act), "pendente_equipe");
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a"], needDoctor: true, doctorId: "d1" }, act), "confirmado");
});

test("tirar o médico de uma reserva que exige médico é erro", () => {
  const v = E.validateBooking(EDITED({ needDoctor: true, doctorId: null }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /exige médico/.test(e)), JSON.stringify(v.errors));
});

test("reserva sem needDoctor não é obrigada a ter médico", () => {
  const v = E.validateBooking(EDITED({ doctorId: null }), scenario(), [], "bk1");
  assert.ok(!v.errors.some((e) => /exige médico/.test(e)), JSON.stringify(v.errors));
});

test("sala fora das permitidas pelo método é erro, não aviso", () => {
  const data = scenario();
  data.activities[0].locationIds = ["outraSala"];
  const v = E.validateBooking(EDITED(), data, [], "bk1");
  assert.ok(v.errors.some((e) => /não está entre as salas/.test(e)), JSON.stringify(v.errors));
});

test("custo da sala do grupo usa a janela inteira, não a da primeira atividade", () => {
  const data = scenario(); // sala 20/h
  // A dura 30min, B dura 2h, simultâneas na mesma sala. A sala fica presa 2h.
  const grupo = [
    { id: "a", date: MON, start: "09:00", end: "09:30", blockStart: "09:00", blockEnd: "09:30", locationId: "loc1", groupId: "G", collaboratorIds: [], accessoryIds: [] },
    { id: "b", date: MON, start: "09:00", end: "11:00", blockStart: "09:00", blockEnd: "11:00", locationId: "loc1", groupId: "G", collaboratorIds: [], accessoryIds: [] },
  ];
  assert.equal(E.bookingsCost(grupo, data), 40, "2h x R$20 = 40; cobrar só os 30min daria 10");
});

test("custo da sala soma dias diferentes separadamente", () => {
  const data = scenario();
  const duas = [
    { id: "a", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] },
    { id: "b", date: E.addDays(MON, 1), start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] },
  ];
  assert.equal(E.bookingsCost(duas, data), 40);
});

test("rodar junto custa menos sala do que rodar em sequência", () => {
  // É esta a propriedade que importa pra pontuação: duas atividades de 1h
  // simultâneas prendem a sala 1h; em sequência, 2h. O plano agrupado tem que
  // sair mais barato — antes a soma simples cobrava 2h nos dois casos.
  const data = scenario();
  const item = (over) => ({
    date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00",
    location: { id: "loc1" }, collaborators: [], doctor: null, row: {}, ...over,
  });
  const juntas = [item({ groupId: "G" }), item({ groupId: "G" })];
  const emSequencia = [item({}), item({ start: "10:00", end: "11:00", blockStart: "10:00", blockEnd: "11:00" })];
  const custoJuntas = E.bookingsCost(juntas.map((i) => ({ ...i, locationId: i.location.id, collaboratorIds: [] })), data);
  const custoSeq = E.bookingsCost(emSequencia.map((i) => ({ ...i, locationId: i.location.id, collaboratorIds: [] })), data);
  assert.equal(custoJuntas, 20, "1h de sala");
  assert.equal(custoSeq, 40, "2h de sala");
  assert.ok(E.scorePlan(juntas, [], data, { dateMin: MON }) < E.scorePlan(emSequencia, [], data, { dateMin: MON }));
});

/* ---------------------------------------------------------------------- */
console.log("\nReferência quebrada (recurso excluído do cadastro)");

test("equipamento que não existe mais é erro", () => {
  const v = E.validateBooking(EDITED({ equipmentId: "eq_apagado" }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

test("acessório que não existe mais é erro", () => {
  const v = E.validateBooking(EDITED({ equipmentId: "eq1", accessoryIds: ["acc_apagado"] }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

test("médico que não existe mais é erro (mesmo com needDoctor)", () => {
  const v = E.validateBooking(EDITED({ needDoctor: true, doctorId: "doc_apagado" }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

test("colaborador que não existe mais é erro", () => {
  const v = E.validateBooking(EDITED({ collaboratorIds: ["col_apagado"] }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

test("sala que não existe mais é erro, com mensagem própria", () => {
  const v = E.validateBooking(EDITED({ locationId: "loc_apagada" }), scenario(), [], "bk1");
  assert.ok(v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

test("reserva com tudo existente não acusa referência quebrada", () => {
  const v = E.validateBooking(EDITED(), scenario(), [], "bk1");
  assert.ok(!v.errors.some((e) => /não existe mais/.test(e)), JSON.stringify(v.errors));
});

/* ---------------------------------------------------------------------- */
console.log("\nTreinamento agendado ocupa a agenda e só habilita ao concluir");

const REQ = (over = {}) => ({
  id: "trn1", activityId: "act1", activityName: "Corneometria", studyName: "Estudo X",
  collaboratorId: "col1", collaboratorName: "Ana", requiredLevel: 3,
  deadlineDate: MON, status: "agendado", scheduledDate: MON, scheduledStart: "09:00",
  durationMin: 90, locationId: null, ...over,
});

test("a aula vira uma reserva com o horário certo", () => {
  const aula = E.trainingBookingFrom(REQ(), scenario().activities[0]);
  assert.equal(aula.date, MON);
  assert.equal(aula.start, "09:00");
  assert.equal(aula.end, "10:30", "90 minutos");
  assert.deepEqual(aula.collaboratorIds, ["col1"]);
  assert.ok(E.isTrainingBooking(aula));
});

test("duração padrão quando a equipe não informa", () => {
  const aula = E.trainingBookingFrom(REQ({ durationMin: null }), scenario().activities[0]);
  assert.equal(E.toMin(aula.end) - E.toMin(aula.start), E.TRAINING_DEFAULT_MIN);
});

test("o colaborador FICA INDISPONÍVEL no horário do treinamento", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ(), data.activities[0]);
  // Ana está em treinamento 09:00-10:30; o motor não pode escalá-la nesse horário.
  const r = E.suggestCombo({ date: MON, start: "09:30", end: "10:00", activityId: "act1", minLevel: 1, accessoryIds: [] }, data, [aula]);
  const escolhidos = r.success ? r.collaborators.map((c) => c.id) : [];
  assert.ok(!escolhidos.includes("col1"), "Ana não podia ser escalada durante o próprio treinamento");
});

test("fora do horário do treinamento ela continua disponível", () => {
  const data = scenario();
  data.collaborators = [data.collaborators[0]]; // só Ana
  const aula = E.trainingBookingFrom(REQ(), data.activities[0]);
  const r = E.suggestCombo({ date: MON, start: "14:00", end: "15:00", activityId: "act1", minLevel: 1, accessoryIds: [] }, data, [aula]);
  assert.ok(r.success, JSON.stringify(r.missing));
  assert.deepEqual(r.collaborators.map((c) => c.id), ["col1"]);
});

test("a validação manual também barra reserva em cima do treinamento", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ(), data.activities[0]);
  const v = E.validateBooking(EDITED({ start: "09:30", end: "10:00" }), data, [aula], "bk1");
  assert.ok(v.errors.some((e) => /já tem outra reserva/.test(e)), JSON.stringify(v.errors));
});

test("a aula em si não exige sala nem nível — é o que a pessoa vai aprender", () => {
  const data = scenario();
  data.activities[0].minLevel = 3;
  data.collaborators[0].levels = {}; // ainda não sabe nada, é justamente o motivo
  const aula = E.trainingBookingFrom(REQ(), data.activities[0]);
  const v = E.validateBooking(aula, data, [aula], aula.id);
  assert.deepEqual(v.errors, [], JSON.stringify(v.errors));
});

test("dois treinamentos no mesmo horário pra mesma pessoa conflitam", () => {
  const data = scenario();
  const a1 = E.trainingBookingFrom(REQ(), data.activities[0]);
  const a2 = E.trainingBookingFrom(REQ({ id: "trn2" }), data.activities[0]);
  a2.id = "outra";
  const v = E.validateBooking(a2, data, [a1, a2], a2.id);
  assert.ok(v.errors.some((e) => /já tem outra reserva/.test(e)), JSON.stringify(v.errors));
});

test("os estados do treinamento existem e agendado != concluido", () => {
  assert.ok(E.TRAINING_STATUS_META.pendente && E.TRAINING_STATUS_META.agendado);
  assert.ok(E.TRAINING_STATUS_META.concluido && E.TRAINING_STATUS_META.recusado);
  assert.notEqual(E.TRAINING_STATUS_META.agendado.label, E.TRAINING_STATUS_META.concluido.label);
});

/* ---------------------------------------------------------------------- */
console.log("\nAjustes da revisão do treinamento");

test("treinamento pode acontecer em sala fora das permitidas do método", () => {
  // Executar Corneometria exige a sala do equipamento; ENSINAR pode ser numa
  // sala de treinamento qualquer.
  const data = scenario();
  data.activities[0].locationIds = ["outraSala"];
  const aula = E.trainingBookingFrom(REQ({ locationId: "loc1" }), data.activities[0]);
  const v = E.validateBooking(aula, data, [aula], aula.id);
  assert.ok(!v.errors.some((e) => /não está entre as salas/.test(e)), JSON.stringify(v.errors));
});

test("reserva normal continua presa às salas do método", () => {
  const data = scenario();
  data.activities[0].locationIds = ["outraSala"];
  const v = E.validateBooking(EDITED(), data, [], "bk1");
  assert.ok(v.errors.some((e) => /não está entre as salas/.test(e)), JSON.stringify(v.errors));
});

test("a sala do treinamento também entra na checagem de conflito", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ({ locationId: "loc1" }), data.activities[0]);
  const outra = { id: "z1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: [], accessoryIds: [] };
  const v = E.validateBooking(aula, data, [aula, outra], aula.id);
  assert.ok(v.errors.some((e) => /sala/.test(e)), JSON.stringify(v.errors));
});

test("custo do setor separa treinamento da execução dos estudos", () => {
  const data = scenario(); // sala 20/h, Ana 25/h
  const estudo = { id: "e1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: "loc1", collaboratorIds: ["col1"], accessoryIds: [] };
  const aula = E.trainingBookingFrom(REQ({ durationMin: 60, scheduledStart: "14:00" }), data.activities[0]);
  const soEstudo = E.bookingsCost([estudo], data);
  const soTreino = E.bookingsCost([aula], data);
  assert.equal(soEstudo, 45, "sala 20 + Ana 25");
  assert.equal(soTreino, 25, "só a hora da Ana — treinamento sem sala");
  // A separação é o ponto: somados dariam 70, mas cada um conta na sua linha.
  assert.equal(soEstudo + soTreino, 70);
});

/* ---------------------------------------------------------------------- */
console.log("\nConclusão do treinamento valida contra o cadastro DEPOIS dele");

test("com o cadastro antigo a pessoa é reprovada (o bug)", () => {
  const data = scenario();
  data.activities[0].minLevel = 3;
  data.collaborators[0].levels = {}; // nível 0, é o que o treinamento resolve
  const alvo = EDITED({ collaboratorIds: [], status: "pendente_equipe" });
  const comAPessoa = { ...alvo, collaboratorIds: ["col1"] };
  const v = E.validateBooking(comAPessoa, data, [comAPessoa], alvo.id);
  assert.ok(v.errors.some((e) => /treinamento/.test(e)), "o cadastro antigo tem que reprovar: " + JSON.stringify(v.errors));
});

test("com o cadastro depois do treinamento ela entra", () => {
  const data = scenario();
  data.activities[0].minLevel = 3;
  data.collaborators[0].levels = {};
  // É isto que concludeTraining monta agora antes de validar.
  const dataDepois = { ...data, collaborators: data.collaborators.map((c) => (c.id === "col1" ? { ...c, levels: { act1: 3 } } : c)) };
  const alvo = EDITED({ collaboratorIds: [], status: "pendente_equipe" });
  const comAPessoa = { ...alvo, collaboratorIds: ["col1"] };
  const v = E.validateBooking(comAPessoa, dataDepois, [comAPessoa], alvo.id);
  assert.deepEqual(v.errors, [], JSON.stringify(v.errors));
  assert.equal(E.bookingStatusFor(comAPessoa, dataDepois.activities[0]), "confirmado");
});

test("mas se ela ficou ocupada nesse meio-tempo, continua sem entrar", () => {
  const data = scenario();
  data.activities[0].minLevel = 3;
  const dataDepois = { ...data, collaborators: data.collaborators.map((c) => (c.id === "col1" ? { ...c, levels: { act1: 3 } } : c)) };
  const alvo = EDITED({ collaboratorIds: [], status: "pendente_equipe" });
  const comAPessoa = { ...alvo, collaboratorIds: ["col1"] };
  const outra = { id: "z9", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: null, collaboratorIds: ["col1"], accessoryIds: [] };
  const v = E.validateBooking(comAPessoa, dataDepois, [comAPessoa, outra], alvo.id);
  assert.ok(v.errors.some((e) => /já tem outra reserva/.test(e)), JSON.stringify(v.errors));
});

console.log("\nTreinamento ocupa instrutor e equipamento");

test("instrutor entra na aula e fica ocupado", () => {
  const aula = E.trainingBookingFrom(REQ({ trainerId: "col2" }), scenario().activities[0]);
  assert.deepEqual(aula.collaboratorIds.sort(), ["col1", "col2"]);
  assert.equal(aula.trainerId, "col2");
  assert.equal(aula.traineeId, "col1");
});

test("instrutor já ocupado impede agendar a aula", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ({ trainerId: "col2" }), data.activities[0]);
  const outra = { id: "z1", date: MON, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00", locationId: null, collaboratorIds: ["col2"], accessoryIds: [] };
  const v = E.validateBooking(aula, data, [aula, outra], aula.id);
  assert.ok(v.errors.some((e) => /já tem outra reserva/.test(e)), JSON.stringify(v.errors));
});

test("equipamento da aula fica indisponível pro estudo no mesmo horário", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ({ equipmentId: "eq1" }), data.activities[0]);
  // O estudo tenta usar o MESMO aparelho, sem deixar o motor trocar de unidade.
  const r = E.suggestCombo({ date: MON, start: "09:30", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 },
    data, [aula], undefined, { lockEquipmentUnit: true });
  assert.equal(r.success, false, "o Corneometer estava na aula");
});

test("sem instrutor e sem equipamento continua válido — os dois são opcionais", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom(REQ(), data.activities[0]);
  assert.equal(aula.trainerId, null);
  assert.equal(aula.equipmentId, null);
  assert.deepEqual(E.validateBooking(aula, data, [aula], aula.id).errors, []);
});

/* ---- Treinamento pra atividade de várias pessoas ---------------------- */
/* Uma atividade de 3 pessoas com 1 qualificada precisa de DOIS treinamentos.
 * Antes o fluxo pedia um só, a aula acontecia, o nível subia e a reserva
 * continuava em "pendente_equipe" porque ainda faltava a segunda pessoa. */

test("faltando 2 de 3, precisa de 2 treinamentos", () => {
  assert.equal(E.trainingsNeededFor({ collaboratorMissing: true, staffNeeded: 3, staffFound: 1 }), 2);
});

test("atividade de 1 pessoa sem ninguém precisa de 1", () => {
  assert.equal(E.trainingsNeededFor({ collaboratorMissing: true, staffNeeded: 1, staffFound: 0 }), 1);
});

test("linha com equipe completa não precisa de treinamento", () => {
  assert.equal(E.trainingsNeededFor({ collaboratorMissing: false, staffNeeded: 3, staffFound: 3 }), 0);
  assert.equal(E.trainingsNeededFor({}), 0);
  assert.equal(E.trainingsNeededFor(null), 0);
});

test("plano antigo sem staffFound cai pra 1, nunca pra 0", () => {
  // Sem o Math.max(1, ...) o gate deixaria confirmar uma reserva sem equipe.
  assert.equal(E.trainingsNeededFor({ collaboratorMissing: true }), 1);
  assert.equal(E.trainingsNeededFor({ collaboratorMissing: true, staffNeeded: 2, staffFound: 5 }), 1);
});

test("pickList aceita o formato antigo (id solto) e o novo (lista)", () => {
  // Rascunho aberto antes da mudança guarda um id string — não pode quebrar.
  assert.deepEqual(E.pickList("train-1"), ["train-1"]);
  assert.deepEqual(E.pickList(["a", "b"]), ["a", "b"]);
  assert.deepEqual(E.pickList(undefined), []);
  assert.deepEqual(E.pickList(null), []);
  assert.deepEqual(E.pickList([]), []);
});

test("o gate de confirmar só libera com um pedido por pessoa que falta", () => {
  // Reproduz a conta que o PlanCard faz em `semEquipe`.
  const it = { rowId: "r1", date: MON, collaboratorMissing: true, staffNeeded: 3, staffFound: 1 };
  const bloqueia = (pedidos) => E.pickList(pedidos).length < E.trainingsNeededFor(it);
  assert.equal(bloqueia(undefined), true, "sem pedido nenhum");
  assert.equal(bloqueia(["t1"]), true, "um pedido só não cobre as 2 vagas");
  assert.equal(bloqueia(["t1", "t2"]), false, "os 2 pedidos liberam");
});

test("cada treinamento concluído soma uma pessoa até sair de pendente_equipe", () => {
  const act = { id: "act1", staffCount: 3 };
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a"], activityId: "act1" }, act), "pendente_equipe");
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a", "b"], activityId: "act1" }, act), "pendente_equipe");
  assert.equal(E.bookingStatusFor({ collaboratorIds: ["a", "b", "c"], activityId: "act1" }, act), "confirmado");
});

/* ---- Estimativa: nível de compromisso da ocupação --------------------- */
/* PREVISÃO ≠ PRÉ-RESERVA ≠ RESERVA CONFIRMADA. A previsão entra em custo e
 * capacidade, mas não tira o horário de ninguém. */

// Uma ocupação de estimativa, com os campos que o motor lê.
const EST_BK = (over = {}) => ({
  id: "bk-est", bookingType: "estimate", estimateId: "est1",
  studyName: "XPTO", date: MON, start: "09:00", end: "10:00",
  blockStart: "08:45", blockEnd: "10:10",
  locationId: "loc1", equipmentId: null, accessoryIds: [], collaboratorIds: ["col1"],
  holdsResources: true, holdUntil: "2099-12-31", ...over,
});
const ONTEM = E.addDays(E.todayStr(), -1);

console.log("\nNível de compromisso: previsão, pré-reserva e reserva");

test("reserva sem bookingType continua sendo reserva oficial", () => {
  // Base antiga não tem o campo. Não pode virar previsão de repente.
  assert.equal(E.bookingTypeOf({ id: "x" }), "reservation");
  assert.equal(E.bookingOccupies({ id: "x" }), true);
});

test("aula de treinamento é reconhecida pelo kind antigo e bloqueia", () => {
  assert.equal(E.bookingTypeOf({ kind: "treinamento" }), "training");
  assert.equal(E.bookingOccupies({ kind: "treinamento" }), true);
});

test("estimativa SEM bloqueio não gera conflito", () => {
  const data = scenario();
  const previsao = EST_BK({ holdsResources: false, holdUntil: null });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 },
    data, [previsao]);
  assert.equal(r.success, true, "previsão não pode segurar a sala");
  assert.equal(r.location.id, "loc1");
});

test("estimativa COM bloqueio no prazo gera conflito", () => {
  const data = scenario();
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1, roomId: "loc1" },
    data, [EST_BK()]);
  assert.equal(r.success, false, "pré-reserva válida tem que segurar a sala");
});

test("estimativa com prazo VENCIDO deixa de bloquear", () => {
  const data = scenario();
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 },
    data, [EST_BK({ holdUntil: ONTEM })]);
  assert.equal(r.success, true, "prazo vencido não segura mais nada");
});

test("pré-reserva sem holdUntil não bloqueia (e é erro de integridade)", () => {
  assert.equal(E.bookingOccupies(EST_BK({ holdUntil: null })), false);
  const data = scenario();
  const v = E.validateBooking(EST_BK({ holdUntil: null }), data, [EST_BK({ holdUntil: null })], "bk-est");
  assert.ok(v.errors.some((e) => /data limite/.test(e)), v.errors.join("; "));
});

test("ocupação de estimativa sem estimateId é rejeitada", () => {
  const data = scenario();
  const v = E.validateBooking(EST_BK({ estimateId: null }), data, [], null);
  assert.ok(v.errors.some((e) => /não aponta pra nenhuma estimativa/.test(e)), v.errors.join("; "));
});

test("reserva normal não pode apontar pra estimativa", () => {
  const data = scenario();
  const b = { id: "b1", date: MON, start: "09:00", end: "10:00", locationId: "loc1", estimateId: "est1", collaboratorIds: [], activityId: "act1" };
  const v = E.validateBooking(b, data, [], null);
  assert.ok(v.errors.some((e) => /só ocupação de estimativa/.test(e)), v.errors.join("; "));
});

test("reserva oficial conflita com pré-reserva válida e diz de quem é", () => {
  const data = scenario();
  const oficial = { id: "b1", date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10",
    locationId: "loc1", collaboratorIds: ["col2"], activityId: "act1", accessoryIds: [] };
  const v = E.validateBooking(oficial, data, [EST_BK(), oficial], "b1");
  assert.ok(v.errors.some((e) => /pré-reserva da estimativa "XPTO"/.test(e)), v.errors.join("; "));
  // `blockers` é o que a tela usa pra oferecer manter/liberar/remanejar.
  assert.equal(v.blockers.length, 1);
  assert.equal(v.blockers[0].booking.estimateId, "est1");
});

test("treinamento conflita normalmente com os recursos da pré-reserva", () => {
  const data = scenario();
  const aula = E.trainingBookingFrom({
    id: "tr1", collaboratorId: "col1", activityId: "act1", requiredLevel: 3,
    scheduledDate: MON, scheduledStart: "09:00", durationMin: 60, locationId: "loc1",
  }, data.activities[0]);
  const v = E.validateBooking(aula, data, [EST_BK(), aula], aula.id);
  assert.ok(v.errors.length > 0, "a pessoa está segurada pela pré-reserva");
});

test("previsão não conta como carga na hora de distribuir trabalho", () => {
  // Senão o motor evitaria a Ana por causa de um estudo que talvez nem exista.
  const previsao = EST_BK({ holdsResources: false, holdUntil: null, date: MON });
  assert.equal(E.loadOf("col1", "collaborator", [previsao], MON), 0);
  assert.equal(E.loadOf("col1", "collaborator", [EST_BK()], MON), 1);
});

test("holdExpired trata data pura e data com hora", () => {
  // "até dia 18" vale o dia 18 inteiro; "até 18 14:00" acaba às 14:00.
  assert.equal(E.holdExpired("2026-08-18", "2026-08-18T23:59"), false);
  assert.equal(E.holdExpired("2026-08-18", "2026-08-19T00:01"), true);
  assert.equal(E.holdExpired("2026-08-18T14:00", "2026-08-18T13:59"), false);
  assert.equal(E.holdExpired("2026-08-18T14:00", "2026-08-18T14:01"), true);
  assert.equal(E.holdExpired(null), true, "sem prazo não vale");
});

test("status da estimativa expira sozinho quando o prazo passa", () => {
  // A tela nunca deve dizer "pré-reserva" de um prazo que venceu ontem, mesmo
  // que ninguém tenha rodado a rotina de expiração ainda.
  assert.equal(E.estimateEffectiveStatus({ status: "pre_reserva", holdUntil: "2099-12-31" }), "pre_reserva");
  assert.equal(E.estimateEffectiveStatus({ status: "pre_reserva", holdUntil: ONTEM }), "expirada");
  assert.equal(E.estimateEffectiveStatus({ status: "aberta" }), "aberta");
  assert.equal(E.estimateEffectiveStatus({ status: "convertida", holdUntil: ONTEM }), "convertida");
});

test("estimativa aberta não conta como encerrada (denominador da conversão)", () => {
  assert.ok(E.isEstimateOpen({ status: "aberta" }));
  assert.ok(E.isEstimateOpen({ status: "pre_reserva" }));
  assert.ok(!E.isEstimateOpen({ status: "convertida" }));
  assert.deepEqual(E.ESTIMATE_CLOSED, ["convertida", "cancelada", "expirada"]);
});

test("duas estimativas com bloqueio disputam o recurso entre si", () => {
  const data = scenario();
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1, roomId: "loc1" },
    data, [EST_BK({ id: "outra", estimateId: "est2" })]);
  assert.equal(r.success, false, "pré-reserva vale contra outra estimativa também");
});

test("equipamento segurado por pré-reserva bloqueia; previsão não", () => {
  const data = scenario();
  const comHold = EST_BK({ locationId: null, equipmentId: "eq1" });
  const r1 = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 },
    data, [comHold], undefined, { lockEquipmentUnit: true });
  assert.equal(r1.success, false);
  const semHold = EST_BK({ locationId: null, equipmentId: "eq1", holdsResources: false, holdUntil: null });
  const r2 = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 },
    data, [semHold], undefined, { lockEquipmentUnit: true });
  assert.equal(r2.success, true);
});

/* ---- Calendário: férias, folga, feriado, evento, manutenção ------------ */
/* A disponibilidade cadastrada é a REGRA ("a Ana trabalha de seg a sex");
 * o calendário é a EXCEÇÃO daquele ano. Coisas diferentes de propósito. */

const FERIAS = (over = {}) => ({
  id: "c1", kind: "ferias", title: "Férias", scope: "recurso", targetIds: ["col1"],
  dateStart: MON, dateEnd: E.addDays(MON, 14), allDay: true, start: null, end: null, ...over,
});
const FERIADO = (over = {}) => ({
  id: "c2", kind: "feriado", title: "Natal", scope: "todos", targetIds: [],
  dateStart: MON, dateEnd: MON, allDay: true, start: null, end: null, ...over,
});

console.log("\nCalendário de ausências");

test("sem calendário nada muda — base antiga continua funcionando", () => {
  const data = scenario();
  assert.equal(data.calendar, undefined);
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(r.success, true);
});

test("colaborador de férias não é escalado, e o motivo aparece", () => {
  const data = scenario({ calendar: [FERIAS()] });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  // Sobra o Bruno.
  assert.equal(r.success, true);
  assert.equal(r.collaborator.id, "col2");
  assert.ok(r.rejected.some((x) => x.name === "Ana" && /Férias/.test(x.reason)), JSON.stringify(r.rejected));
});

test("férias fora do período não atrapalham", () => {
  const data = scenario({ calendar: [FERIAS({ dateStart: E.addDays(MON, 30), dateEnd: E.addDays(MON, 40) })] });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(r.collaborator.id, "col1", "a Ana volta a ser a primeira opção");
});

test("feriado derruba o dia inteiro, inclusive a sala", () => {
  // Num feriado ninguém vem — não adianta a sala estar teoricamente aberta.
  const data = scenario({ calendar: [FERIADO()] });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(r.success, false);
  assert.ok(r.missing.join(" ").includes("local"), r.missing.join("; "));
  assert.ok(r.rejected.some((x) => /Natal/.test(x.reason)), JSON.stringify(r.rejected));
});

test("evento com hora só atrapalha quem encosta na faixa", () => {
  const confra = FERIADO({ kind: "evento", title: "Confraternização", allDay: false, start: "16:00", end: "20:00" });
  const data = scenario({ calendar: [confra] });
  const cedo = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(cedo.success, true, "de manhã a festa não interfere");
  const tarde = E.suggestCombo({ date: MON, start: "16:30", end: "17:30", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(tarde.success, false, "às 16:30 a festa já começou");
});

test("a faixa considerada é a BLOQUEADA, com preparo e desmontagem", () => {
  // act1 tem 15min de preparo: 16:00–17:00 de execução ocupa desde 15:45.
  const data = scenario({ calendar: [FERIADO({ kind: "evento", allDay: false, start: "15:50", end: "20:00" })] });
  const r = E.suggestCombo({ date: MON, start: "16:00", end: "17:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(r.success, false, "o preparo já entra no horário da festa");
});

test("equipamento em manutenção sai da lista", () => {
  const data = scenario({ calendar: [{ id: "c3", kind: "manutencao", title: "Manutenção", scope: "recurso",
    targetIds: ["eq1"], dateStart: MON, dateEnd: MON, allDay: true }] });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 },
    data, [], undefined, { lockEquipmentUnit: true });
  assert.equal(r.success, false);
  const livre = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", equipmentId: "eq1", accessoryIds: [], activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(livre.equipment.id, "eq2", "o motor troca pra outra unidade do mesmo tipo");
});

test("uma entrada pode cobrir várias pessoas de uma vez", () => {
  const data = scenario({ calendar: [FERIAS({ title: "Recesso da equipe", targetIds: ["col1", "col2"] })] });
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1 }, data, []);
  assert.equal(r.success, false, "os dois estão fora");
});

test("edição manual também respeita a ausência — e é ERRO, não aviso", () => {
  // Não existe hora extra pra quem está de férias: a pessoa não está. O
  // encaixe pode furar horário; não pode furar ausência.
  const data = scenario({ calendar: [FERIAS()] });
  const b = { id: "b1", date: MON, start: "09:00", end: "10:00", locationId: "loc1",
    collaboratorIds: ["col1"], activityId: "act1", accessoryIds: [], status: "confirmado" };
  const v = E.validateBooking(b, data, [b], "b1");
  assert.ok(v.errors.some((e) => /Férias/.test(e)), v.errors.join("; "));
});

test("ausência com dateEnd vazio vale só o dia de início", () => {
  const c = { id: "c9", kind: "folga", scope: "recurso", targetIds: ["col1"], dateStart: MON, allDay: true };
  assert.ok(E.absenceOn([c], "col1", MON));
  assert.equal(E.absenceOn([c], "col1", E.addDays(MON, 1)), null);
});

test("absenceLabel diz o que é e até quando", () => {
  // Com o ano: o calendário atravessa anos, "até 31/08" seria ambíguo.
  assert.equal(E.absenceLabel(FERIAS({ dateStart: "2026-08-17", dateEnd: "2026-08-31" })), "Férias até 31/08/2026");
  assert.equal(E.absenceLabel({ kind: "feriado", dateStart: "2026-12-25", dateEnd: "2026-12-25" }), "Feriado");
});

test("feriados nacionais saem certos, inclusive os móveis", () => {
  // Páscoa de 2026: 5 de abril. Carnaval 16-17/02, Sexta Santa 03/04,
  // Corpus Christi 04/06 — conferíveis em qualquer calendário.
  const h = E.nationalHolidays(2026);
  const acha = (t) => h.filter((x) => x.title === t).map((x) => x.date);
  assert.equal(E.fmtDate(E.easterSunday(2026)), "2026-04-05");
  assert.deepEqual(acha("Carnaval"), ["2026-02-16", "2026-02-17"]);
  assert.deepEqual(acha("Sexta-feira Santa"), ["2026-04-03"]);
  assert.deepEqual(acha("Corpus Christi"), ["2026-06-04"]);
  assert.deepEqual(acha("Natal"), ["2026-12-25"]);
  assert.equal(E.fmtDate(E.easterSunday(2027)), "2027-03-28");
});

/* ---- Janela contratada do estudo --------------------------------------- */
/* O protocolo diz a FORMA do cronograma (D0, D7±2, D28±3). A janela diz
 * ONDE ela cabe no calendário. Perguntas diferentes. */

// D0 · D7±2 · D28±3 — o protocolo leva 31 dias (28 + 3 de tolerância).
const PROTO = [
  { id: "t0", label: "D0", offsetDays: 0, toleranceDays: 0 },
  { id: "t7", label: "D7", offsetDays: 7, toleranceDays: 2 },
  { id: "t28", label: "D28", offsetDays: 28, toleranceDays: 3 },
];

console.log("\nJanela contratada do estudo");

test("estudo antigo, sem janela, continua funcionando", () => {
  // Só tem baselineDate: a janela de início vira aquele dia e não há prazo.
  const w = E.studyWindow({ baselineDate: "2026-09-01" });
  assert.deepEqual(w, { startMin: "2026-09-01", startMax: "2026-09-01", endDate: null });
  const fit = E.studyFit({ baselineDate: "2026-09-01" }, PROTO);
  assert.deepEqual(fit.problems, [], "sem prazo combinado nada pode estourar");
});

test("o protocolo tem uma duração calculável em dias", () => {
  assert.equal(E.protocolSpan(PROTO), 31, "D28 + 3 de tolerância");
  assert.equal(E.protocolEnd(PROTO, "2026-09-01"), "2026-10-02");
});

test("cabe no prazo: nenhum problema", () => {
  const fit = E.studyFit({ baselineDate: "2026-09-01", startMin: "2026-09-01", startMax: "2026-09-15", endDate: "2026-10-31" }, PROTO);
  assert.deepEqual(fit.problems, []);
  assert.equal(fit.overflowDays, 0);
  // Último D0 possível: 31/10 menos os 31 dias do protocolo.
  assert.equal(fit.latestFeasibleBaseline, "2026-09-30");
});

test("estoura o prazo: diz quantos dias e qual seria o último D0 possível", () => {
  const fit = E.studyFit({ baselineDate: "2026-09-20", startMin: "2026-09-01", startMax: "2026-09-30", endDate: "2026-10-10" }, PROTO);
  assert.equal(fit.overflowDays, 11, "termina 21/10, prazo 10/10");
  assert.equal(fit.latestFeasibleBaseline, "2026-09-09");
  assert.ok(fit.problems.some((p) => /11 dia\(s\) depois do prazo/.test(p)), fit.problems.join("; "));
  assert.equal(fit.impossivel, false, "ainda dava começando antes");
});

test("protocolo maior que a janela inteira: nenhuma data resolve", () => {
  // 31 dias de protocolo numa janela de 20 dias.
  const fit = E.studyFit({ baselineDate: "2026-09-01", startMin: "2026-09-01", startMax: "2026-09-05", endDate: "2026-09-21" }, PROTO);
  assert.equal(fit.impossivel, true);
  assert.ok(fit.problems.some((p) => /não cabe na janela nem começando no primeiro dia/.test(p)), fit.problems.join("; "));
});

test("D0 fora da janela de início combinada é apontado", () => {
  const cedo = E.studyFit({ baselineDate: "2026-08-20", startMin: "2026-09-01", startMax: "2026-09-15" }, PROTO);
  assert.ok(cedo.problems.some((p) => /antes do início combinado/.test(p)), cedo.problems.join("; "));
  const tarde = E.studyFit({ baselineDate: "2026-09-20", startMin: "2026-09-01", startMax: "2026-09-15" }, PROTO);
  assert.ok(tarde.problems.some((p) => /depois do início máximo/.test(p)), tarde.problems.join("; "));
});

test("janela incoerente é detectada", () => {
  const f1 = E.studyFit({ baselineDate: "2026-09-01", startMin: "2026-09-10", startMax: "2026-09-01" }, PROTO);
  assert.ok(f1.problems.some((p) => /início máximo está antes do início mínimo/.test(p)));
  const f2 = E.studyFit({ baselineDate: "2026-09-01", startMin: "2026-09-01", startMax: "2026-09-01", endDate: "2026-08-01" }, PROTO);
  assert.ok(f2.problems.some((p) => /prazo final está antes do início/.test(p)));
});

test("o prazo APARA a janela da visita, sem mexer na tolerância do protocolo", () => {
  const estudo = { baselineDate: "2026-09-01", startMin: "2026-09-01", endDate: "2026-09-29" };
  const puro = E.timepointWindow(PROTO[2], "2026-09-01");
  assert.deepEqual([puro.dateMin, puro.dateMax], ["2026-09-26", "2026-10-02"]);
  const aparado = E.timepointWindow(PROTO[2], "2026-09-01", estudo);
  assert.deepEqual([aparado.dateMin, aparado.dateMax], ["2026-09-26", "2026-09-29"]);
  assert.equal(aparado.clipped, true);
  assert.equal(aparado.fits, true, "ainda sobra janela pra agendar");
});

test("visita inteiramente depois do prazo não cabe", () => {
  const estudo = { baselineDate: "2026-09-01", startMin: "2026-09-01", endDate: "2026-09-10" };
  const w = E.timepointWindow(PROTO[2], "2026-09-01", estudo);
  assert.equal(w.fits, false, "D28±3 começa em 26/09, o prazo acaba em 10/09");
});

test("chamar com 2 argumentos continua devolvendo a janela pura", () => {
  // É o que garante que nada do que já existia mudou de comportamento.
  const w = E.timepointWindow(PROTO[1], "2026-09-01");
  assert.deepEqual([w.dateMin, w.dateMax], ["2026-09-06", "2026-09-10"]);
  assert.equal(w.clipped, false, "sem estudo não há o que aparar");
  assert.equal(w.fits, true);
});

test("o motor não sugere dia fora do prazo, porque a janela já vem aparada", () => {
  // A busca varre dateMin..dateMax; aparando a janela, o dia fora do prazo
  // nem chega a ser considerado — não existe uma segunda regra em paralelo.
  const data = scenario();
  const estudo = { baselineDate: MON, startMin: MON, endDate: E.addDays(MON, 1) };
  const w = E.timepointWindow({ offsetDays: 0, toleranceDays: 10 }, MON, estudo);
  const plano = E.planSpread({ dateMin: w.dateMin, dateMax: w.dateMax, rows: [ROW()] }, data, []);
  assert.ok(plano, "tem que fechar dentro do prazo");
  plano.items.forEach((it) => assert.ok(it.date <= estudo.endDate, `${it.date} passou do prazo`));
});

test("migração dá janela honesta pro estudo antigo", () => {
  const studies = [{ id: "s1", name: "Antigo", baselineDate: "2026-09-01" }];
  const tps = PROTO.map((t) => ({ ...t, studyId: "s1", dateMin: "x", dateMax: "y" }));
  const r = E.normalizeProtocol(studies, tps);
  const s = r.studies[0];
  // Tinha um D0 fixo e nenhum prazo: o equivalente honesto é "só pode começar
  // nesse dia" e "o prazo é o fim do próprio protocolo".
  assert.equal(s.startMin, "2026-09-01");
  assert.equal(s.startMax, "2026-09-01");
  assert.equal(s.endDate, "2026-10-02");
  // E depois da migração nada pode estar estourando prazo.
  assert.deepEqual(E.studyFit(s, tps).problems, []);
});

/* ---- Permissões: o que cada nível vê e faz ----------------------------- */
/* Visibilidade de tela virou capacidade (`ver_<tela>`), pelo mesmo mecanismo
 * das ações — um lugar pra guardar, um `canI` pra perguntar. */

console.log("\nPermissões por nível");

test("matriz antiga ganha as telas padrão de cada nível", () => {
  // Sem esse passo, ligar a configuração deixaria todo mundo sem menu.
  const antiga = { gestor: ["indicadores"], treinador: ["treinamento_confirmar"] };
  const { roleCapabilities: r, changed } = E.normalizeRoleCapabilities(antiga);
  assert.equal(changed, true);
  assert.ok(r.gestor.includes("indicadores"), "não pode perder o que já tinha");
  assert.ok(r.gestor.includes("ver_kpis"));
  assert.ok(r.treinador.includes("ver_training"));
  assert.ok(!r.treinador.includes("ver_kpis"), "treinador não via indicadores antes");
});

test("normalizeRoleCapabilities é idempotente", () => {
  const um = E.normalizeRoleCapabilities({ gestor: ["indicadores"] });
  const dois = E.normalizeRoleCapabilities(um.roleCapabilities);
  assert.equal(dois.changed, false);
});

test("nível que já tem alguma tela marcada não é mexido", () => {
  // Admin deixou o colaborador só com "Meu dia" DE PROPÓSITO: as outras telas
  // não podem voltar sozinhas na próxima carga.
  const escolhido = { ...E.DEFAULT_ROLE_SCREENS, colaborador: ["ver_myday"] };
  const { roleCapabilities: r, changed } = E.normalizeRoleCapabilities(escolhido);
  assert.deepEqual(r.colaborador, ["ver_myday"]);
  assert.equal(changed, false, "nada a migrar: todos os níveis já têm telas");
});

test("o padrão reproduz o que cada nível já enxergava", () => {
  // Ligar a configuração não pode mudar o que ninguém pediu.
  assert.ok(E.DEFAULT_ROLE_SCREENS.agendador.includes("ver_booking"), "só o agendador planejava");
  assert.ok(!E.DEFAULT_ROLE_SCREENS.treinador.includes("ver_booking"));
  assert.ok(E.DEFAULT_ROLE_SCREENS.gestor.includes("ver_kpis"), "só a gestão via indicadores");
  assert.ok(!E.DEFAULT_ROLE_SCREENS.colaborador.includes("ver_kpis"));
  assert.ok(E.DEFAULT_ROLE_SCREENS.medico.includes("ver_myday"));
  ["gestor", "treinador", "agendador", "colaborador", "medico"].forEach((r) => {
    E.TELAS_DO_DIA_A_DIA.forEach((t) => assert.ok(E.DEFAULT_ROLE_SCREENS[r].includes(t), `${r} perdeu ${t}`));
  });
});

test("toda capacidade cabe em algum grupo da tela de permissões", () => {
  // Capacidade fora de grupo ficaria impossível de configurar. (A tela tem um
  // "Outras" de segurança, mas o certo é o grupo existir de verdade.)
  const agrupadas = new Set(E.CAP_GROUPS.flatMap((g) => g.caps));
  const orfas = E.CAPABILITIES.map((c) => c.id).filter((id) => !agrupadas.has(id));
  assert.deepEqual(orfas, [], `sem grupo: ${orfas.join(", ")}`);
});

test("todo grupo aponta pra capacidade que existe", () => {
  const existe = new Set(E.CAPABILITIES.map((c) => c.id));
  const fantasmas = E.CAP_GROUPS.flatMap((g) => g.caps).filter((id) => !existe.has(id));
  assert.deepEqual(fantasmas, [], `não existem: ${fantasmas.join(", ")}`);
});

test("todo nível editável tem um padrão de telas", () => {
  E.EDITABLE_ROLES.forEach((r) => assert.ok(E.DEFAULT_ROLE_SCREENS[r.id], `${r.id} sem padrão de telas`));
});

test("ninguém pode se autopromover: usuarios não é capacidade configurável", () => {
  assert.ok(!E.CAPABILITIES.some((c) => c.id === "usuarios"), "editar permissões é fixo do Admin");
});

/* ---- Conversão da estimativa em estudo --------------------------------- */
/* A conversão não pode obrigar ninguém a remontar o cronograma: tudo que o
 * motor já decidiu tem que atravessar intacto. */

const EST = (over = {}) => ({
  id: "est1", name: "Oportunidade X", client: "Cliente A", sponsorId: "sp1",
  status: "pre_reserva", baselineDate: "2026-09-01", startMin: "2026-09-01",
  startMax: "2026-09-10", endDate: "2026-12-31",
  protocol: [
    { tpId: "v1", label: "D0", offsetDays: 0, toleranceDays: 0 },
    { tpId: "v2", label: "D7", offsetDays: 7, toleranceDays: 2 },
  ],
  holdsResources: true, holdUntil: "2099-12-31", convertedStudyId: null, ...over,
});

console.log("\nConversão de estimativa em estudo");

test("estimativa cancelada, expirada ou já convertida não converte", () => {
  assert.deepEqual(E.estimateConversionBlockers(EST()), []);
  assert.ok(E.estimateConversionBlockers(EST({ status: "cancelada" })).some((p) => /cancelada/.test(p)));
  assert.ok(E.estimateConversionBlockers(EST({ status: "expirada" })).some((p) => /expirou/.test(p)));
  assert.ok(E.estimateConversionBlockers(EST({ convertedStudyId: "s9" })).some((p) => /já foi convertida/.test(p)));
});

test("não converte estimativa sem visita nem sem nome", () => {
  assert.ok(E.estimateConversionBlockers(EST({ protocol: [] })).some((p) => /nenhuma visita/.test(p)));
  assert.ok(E.estimateConversionBlockers(EST({ name: "  " })).some((p) => /precisa de um nome/.test(p)));
});

test("o estudo herda a janela contratada da estimativa", () => {
  const s = E.estimateAsStudyShape(EST(), "s-novo");
  assert.equal(s.id, "s-novo");
  assert.equal(s.name, "Oportunidade X");
  assert.equal(s.startMin, "2026-09-01");
  assert.equal(s.endDate, "2026-12-31");
  assert.equal(s.status, "ativo");
  assert.equal(s.fromEstimateId, "est1", "de onde veio fica gravado");
});

test("a ocupação prevista vira reserva preservando o cronograma inteiro", () => {
  const study = E.estimateAsStudyShape(EST(), "s-novo");
  const prevista = {
    id: "bk1", bookingType: "estimate", estimateId: "est1", estimateVisitId: "v2",
    holdsResources: true, holdUntil: "2099-12-31",
    date: "2026-09-08", start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10",
    locationId: "loc1", equipmentId: "eq1", accessoryIds: ["acc1"], activityId: "act1",
    collaboratorIds: ["col1", "col2"], doctorId: "doc1", needDoctor: true,
    groupId: "g1", participantCount: 4, status: "confirmado",
  };
  const r = E.bookingFromEstimateBooking(prevista, study);
  // O que muda: nível de compromisso e vínculo.
  assert.equal(r.bookingType, "reservation");
  assert.equal(r.estimateId, null);
  assert.equal(r.holdsResources, false);
  assert.equal(r.holdUntil, null);
  assert.equal(r.studyId, "s-novo");
  assert.equal(r.timepointId, "v2", "a visita da estimativa vira o timepoint");
  assert.equal(r.fromEstimateId, "est1");
  // O que NÃO pode mudar: o cronograma que o motor já resolveu.
  ["date", "start", "end", "blockStart", "blockEnd", "locationId", "equipmentId",
   "activityId", "doctorId", "needDoctor", "groupId", "participantCount"].forEach((k) => {
    assert.deepEqual(r[k], prevista[k], `${k} não podia mudar`);
  });
  assert.deepEqual(r.collaboratorIds, ["col1", "col2"]);
  assert.deepEqual(r.accessoryIds, ["acc1"]);
  assert.equal(r.estimateVisitId, undefined, "campo de estimativa não sobra na reserva");
});

test("as visitas da estimativa viram timepoints com a janela certa", () => {
  const tps = E.timepointsFromEstimate(EST(), "s-novo");
  assert.equal(tps.length, 2);
  assert.equal(tps[1].id, "v2");
  assert.equal(tps[1].studyId, "s-novo");
  assert.equal(tps[1].offsetDays, 7);
  // D7±2 a partir de 01/09 = 06/09 a 10/09, dentro do prazo.
  assert.deepEqual([tps[1].dateMin, tps[1].dateMax], ["2026-09-06", "2026-09-10"]);
});

test("prazo curto na estimativa apara a janela da visita convertida", () => {
  const tps = E.timepointsFromEstimate(EST({ endDate: "2026-09-08" }), "s-novo");
  assert.deepEqual([tps[1].dateMin, tps[1].dateMax], ["2026-09-06", "2026-09-08"]);
});

test("a reserva convertida passa a disputar recurso como qualquer outra", () => {
  // Era previsão sem bloqueio (não disputava nada); virou reserva oficial.
  const data = scenario();
  const prevista = {
    id: "bk1", bookingType: "estimate", estimateId: "est1", estimateVisitId: "v1",
    holdsResources: false, holdUntil: null,
    date: MON, start: "09:00", end: "10:00", blockStart: "08:45", blockEnd: "10:10",
    locationId: "loc1", accessoryIds: [], activityId: "act1", collaboratorIds: ["col1"],
  };
  assert.equal(E.bookingOccupies(prevista), false);
  const convertida = E.bookingFromEstimateBooking(prevista, { id: "s1", name: "X", sponsorId: null });
  assert.equal(E.bookingOccupies(convertida), true);
  // E agora bloqueia quem tentar a mesma sala.
  const r = E.suggestCombo({ date: MON, start: "09:00", end: "10:00", activityId: "act1", minLevel: 1, roomId: "loc1" },
    data, [convertida]);
  assert.equal(r.success, false);
});

/* ---- Estoque em três camadas ------------------------------------------- */
/* O número da prateleira sozinho engana: parte já está prometida. */

const HOJE = "2026-08-14";
const ATIVS = [{ id: "act1", name: "Aplicação", supplyUsage: [{ supplyId: "sup1", qty: 5 }] }];
const LUVA = { id: "sup1", name: "Luvas", quantity: 100, minThreshold: 20, unit: "cx" };
const BK = (over = {}) => ({ id: "b" + Math.random(), date: "2026-09-01", start: "09:00", end: "10:00",
  activityId: "act1", locationId: "loc1", collaboratorIds: [], accessoryIds: [], ...over });

console.log("\nEstoque em três camadas");

test("reserva futura compromete; estimativa aberta é só previsão", () => {
  const ests = [{ id: "e1", status: "aberta" }];
  const bks = [
    BK(),                                                          // reserva: compromete 5
    BK({ bookingType: "estimate", estimateId: "e1" }),              // previsão: 5
  ];
  const o = E.supplyOutlook(LUVA, ATIVS, bks, ests, HOJE);
  assert.equal(o.fisico, 100);
  assert.equal(o.comprometido, 5);
  assert.equal(o.previsto, 5);
  assert.equal(o.disponivel, 95, "previsão NÃO sai do disponível");
  assert.equal(o.seTudoAprovado, 90);
});

test("reserva que já passou não compromete de novo", () => {
  // O consumo dela já saiu do físico quando foi criada.
  const o = E.supplyOutlook(LUVA, ATIVS, [BK({ date: "2026-07-01" })], [], HOJE);
  assert.equal(o.comprometido, 0);
});

test("estimativa cancelada, expirada ou convertida não conta como previsão", () => {
  const bks = [
    BK({ bookingType: "estimate", estimateId: "cancel" }),
    BK({ bookingType: "estimate", estimateId: "exp" }),
    BK({ bookingType: "estimate", estimateId: "conv" }),
  ];
  const ests = [
    { id: "cancel", status: "cancelada" },
    { id: "exp", status: "pre_reserva", holdUntil: "2020-01-01" },   // expirada de fato
    { id: "conv", status: "convertida" },
  ];
  const o = E.supplyOutlook(LUVA, ATIVS, bks, ests, HOJE);
  assert.equal(o.previsto, 0, "nenhuma dessas vai consumir nada");
});

test("déficit aparece quando tudo junto passa do que existe", () => {
  const ests = [{ id: "e1", status: "pre_reserva", holdUntil: "2099-12-31" }];
  const muitas = Array.from({ length: 25 }, () => BK({ bookingType: "estimate", estimateId: "e1" }));
  const o = E.supplyOutlook(LUVA, ATIVS, muitas, ests, HOJE);
  assert.equal(o.previsto, 125);
  assert.equal(o.disponivel, 100, "ainda não faltou nada de verdade");
  assert.equal(o.seTudoAprovado, -25, "mas faltaria 25 se tudo entrar");
});

/* ---- Reaproveitamento de capacidade ------------------------------------ */
/* Cancelar uma oportunidade e encaixar outro estudo no mesmo horário não é
 * perda nenhuma — por isso a conta não é "quanto perdemos". */

console.log("\nReaproveitamento de capacidade");

const SOLTA = (over = {}) => ({ id: "solta", bookingType: "estimate", estimateId: "e1",
  holdsResources: true, holdUntil: "2026-08-01", date: "2026-08-01", start: "09:00", end: "13:00",
  locationId: "salaA", collaboratorIds: [], accessoryIds: [], ...over });

test("horário liberado e ocupado depois = reaproveitado", () => {
  const ests = [{ id: "e1", status: "cancelada" }];
  const outra = { id: "outra", date: "2026-08-01", start: "10:00", end: "11:00", locationId: "salaA", collaboratorIds: [], accessoryIds: [] };
  const r = E.capacityReuse(ests, [SOLTA(), outra], "2026-08-20");
  assert.equal(r.liberadas, 4);
  assert.equal(r.reaproveitadas, 4);
  assert.equal(r.naoReaproveitadas, 0);
});

test("o dia chegou e ficou vazio = não reaproveitado", () => {
  const ests = [{ id: "e1", status: "cancelada" }];
  const r = E.capacityReuse(ests, [SOLTA()], "2026-08-20");
  assert.equal(r.naoReaproveitadas, 4);
  assert.equal(r.reaproveitadas, 0);
});

test("data ainda não chegou: cedo pra julgar", () => {
  const ests = [{ id: "e1", status: "cancelada" }];
  const r = E.capacityReuse(ests, [SOLTA({ date: "2026-12-01" })], "2026-08-20");
  assert.equal(r.emAberto, 4);
  assert.equal(r.naoReaproveitadas, 0, "não pode virar perda antes da hora");
});

test("previsão pura nunca segurou nada — não entra na conta", () => {
  const ests = [{ id: "e1", status: "cancelada" }];
  const r = E.capacityReuse(ests, [SOLTA({ holdsResources: false })], "2026-08-20");
  assert.equal(r.liberadas, 0);
});

test("estimativa convertida não conta como liberação", () => {
  // O horário continua ocupado — pela reserva oficial que nasceu dela.
  const ests = [{ id: "e1", status: "convertida" }];
  const r = E.capacityReuse(ests, [SOLTA()], "2026-08-20");
  assert.equal(r.liberadas, 0);
});

/* ---- Taxa de conversão -------------------------------------------------- */

console.log("\nTaxa de conversão");

test("estimativa aberta não conta como fracasso", () => {
  const ests = [
    { id: "1", status: "convertida" }, { id: "2", status: "convertida" },
    { id: "3", status: "cancelada" },
    { id: "4", status: "aberta" }, { id: "5", status: "pre_reserva", holdUntil: "2099-12-31" },
  ];
  const c = E.conversionStats(ests);
  assert.equal(c.total, 5);
  assert.equal(c.abertas, 2);
  assert.equal(c.encerradas, 3);
  assert.equal(c.convertidas, 2);
  // 2 de 3 encerradas = 67%. Se as abertas contassem, cairia pra 40%.
  assert.equal(c.taxa, 67);
});

test("sem nenhuma encerrada, a taxa é indefinida — não zero", () => {
  const c = E.conversionStats([{ id: "1", status: "aberta" }]);
  assert.equal(c.taxa, null, "0% seria mentira: nada foi decidido ainda");
});

test("pré-reserva vencida conta como expirada na estatística", () => {
  const c = E.conversionStats([{ id: "1", status: "pre_reserva", holdUntil: "2020-01-01" }]);
  assert.equal(c.expiradas, 1);
  assert.equal(c.abertas, 0);
});

test("o valor em aberto separa do valor convertido", () => {
  const ests = [
    { id: "1", status: "aberta", estimatedValue: 1000 },
    { id: "2", status: "convertida", estimatedValue: 5000 },
    { id: "3", status: "cancelada", estimatedValue: 900 },
  ];
  const c = E.conversionStats(ests);
  assert.equal(c.valorAberto, 1000);
  assert.equal(c.valorConvertido, 5000, "cancelada não entra em nenhum dos dois");
});

test("dá pra filtrar por cliente", () => {
  const ests = [
    { id: "1", client: "A", status: "convertida" }, { id: "2", client: "A", status: "cancelada" },
    { id: "3", client: "B", status: "cancelada" },
  ];
  assert.equal(E.conversionStats(ests, (e) => e.client === "A").taxa, 50);
  assert.equal(E.conversionStats(ests, (e) => e.client === "B").taxa, 0);
});

/* ---- O exemplo obedece as próprias regras ------------------------------ */
/* O Fonseca contou: 9 das 10 reservas do banco não passavam na validação —
 * sala não permitida, sem treinamento, calibração vencida. Eram todas do
 * seed. Alerta que aparece sempre vira ruído e ninguém mais confia nele.
 *
 * A causa: o seed escrevia sala e pessoas à mão, enquanto as salas
 * permitidas do método e os níveis nascem sorteados. É a terceira vez que
 * um problema aparece por ninguém validar o dado de exemplo (antes: a
 * Camila em duas reservas sobrepostas, e as referências de sala mortas). */

console.log("\nDados de exemplo passam nas próprias regras");

/* O cadastro REAL, com os mesmos geradores que a carga usa.
 *
 * A versão anterior deste helper montava um cadastro simplificado — sem
 * equipamento, tudo com staffCount 1, preparo e desmontagem zerados — e por
 * isso os testes passavam enquanto o seed de verdade produzia 4 reservas
 * inválidas. Teste que evita o caso difícil não é teste; é a aparência de um.
 *
 * Os geradores sorteiam (níveis, salas permitidas, calibração), então cada
 * execução é um cenário novo — é justamente o que se quer aqui. */
function baseParaSeed() {
  const niches = E.seedNiches();
  const supplies = E.seedSupplies();
  const locations = E.seedLocations();
  // `activities` UMA vez só: os níveis dos colaboradores são chaveados pelos
  // ids delas, e gerar duas vezes daria ids que não se cruzam.
  const activities = E.seedActivities(locations, supplies);
  return {
    niches, supplies, locations, activities,
    sponsors: E.seedSponsors(niches),
    equipment: E.seedEquipment(),
    doctors: E.seedDoctors(),
    collaborators: E.seedCollaborators(activities),
  };
}
// Os geradores sorteiam; uma rodada só poderia dar sorte.
const RODADAS_DE_SEED = 25;

/* A régua é o `validateBooking` — o mesmo que o app usa pra aceitar ou
 * recusar qualquer reserva. Se o exemplo não passa nele, o exemplo está
 * ensinando o contrário do que o sistema cobra. */
function errosDoPacote() {
  const data = baseParaSeed();
  const b = E.seedStudiesBundle(data);
  // O pacote não altera a lista de entrada: devolve uma nova quando precisa
  // garantir nível (senão o adaptador não veria diferença pra gravar).
  if (b.collaborators) data.collaborators = b.collaborators;
  const problemas = [];
  b.bookings.forEach((bk) => {
    E.validateBooking(bk, data, b.bookings, bk.id).errors
      .forEach((e) => problemas.push(`${bk.studyName} ${bk.date} (${data.activities.find((a) => a.id === bk.activityId)?.name}): ${e}`));
  });
  return { problemas, bundle: b, data };
}

test("o pacote de exemplo passa no validateBooking, com o cadastro REAL", () => {
  // Roda várias vezes porque salas permitidas, níveis e calibração são
  // sorteados: uma rodada só poderia passar por sorte.
  const falhas = [];
  for (let i = 0; i < RODADAS_DE_SEED; i++) {
    const { problemas } = errosDoPacote();
    if (problemas.length) falhas.push(`rodada ${i + 1}: ${problemas.join(" | ")}`);
  }
  assert.equal(falhas.length, 0, falhas.slice(0, 3).join("\n"));
});

test("nenhuma reserva de exemplo escala menos gente do que a atividade exige", () => {
  for (let i = 0; i < RODADAS_DE_SEED; i++) {
    const { bundle, data } = errosDoPacote();
    bundle.bookings.forEach((bk) => {
      const act = data.activities.find((a) => a.id === bk.activityId);
      const precisa = Math.max(1, act?.staffCount ?? 1);
      assert.ok((bk.collaboratorIds || []).length >= precisa,
        `${act?.name} pede ${precisa}, tem ${(bk.collaboratorIds || []).length}`);
    });
  }
});

test("nenhuma reserva de exemplo usa equipamento com calibração vencida", () => {
  for (let i = 0; i < RODADAS_DE_SEED; i++) {
    const { bundle, data } = errosDoPacote();
    bundle.bookings.forEach((bk) => {
      [bk.equipmentId, ...(bk.accessoryIds || [])].filter(Boolean).forEach((id) => {
        const eq = data.equipment.find((e) => e.id === id);
        const cal = E.calibrationStatus(eq, bk.date);
        assert.notEqual(cal?.status, "vencido", `${eq?.name} vencido em ${bk.date}`);
      });
    });
  }
});

test("duas reservas de exemplo nunca disputam sala, pessoa ou equipamento", () => {
  // Comparando a janela BLOQUEADA (com preparo e desmontagem), que é a que
  // vale — comparar só start/end deixava passar encavalamento de preparo.
  for (let i = 0; i < RODADAS_DE_SEED; i++) {
    const { bundle } = errosDoPacote();
    bundle.bookings.forEach((x, ix) => bundle.bookings.slice(ix + 1).forEach((y) => {
      if (x.date !== y.date) return;
      const bx = E.bookingBlock(x), by = E.bookingBlock(y);
      if (!E.overlaps(bx.s, bx.e, by.s, by.e)) return;
      const mesmoGrupo = x.groupId && x.groupId === y.groupId;
      if (!mesmoGrupo) assert.notEqual(x.locationId, y.locationId, `sala repetida em ${x.date}`);
      const pessoa = (x.collaboratorIds || []).find((id) => (y.collaboratorIds || []).includes(id));
      assert.ok(!pessoa, `colaborador ${pessoa} em duas reservas em ${x.date}`);
      if (x.doctorId) assert.notEqual(x.doctorId, y.doctorId, `médico repetido em ${x.date}`);
      const ex = [x.equipmentId, ...(x.accessoryIds || [])].filter(Boolean);
      const ey = [y.equipmentId, ...(y.accessoryIds || [])].filter(Boolean);
      const eq = ex.find((id) => ey.includes(id));
      assert.ok(!eq, `equipamento ${eq} em duas reservas em ${x.date}`);
    }));
  }
});

test("toda reserva de exemplo aponta pra cadastro que existe", () => {
  // Foi assim que apareceram 9 reservas em salas inexistentes.
  for (let i = 0; i < RODADAS_DE_SEED; i++) {
    const { bundle, data } = errosDoPacote();
    const ids = (lista) => new Set(lista.map((x) => x.id));
    const locs = ids(data.locations), eqs = ids(data.equipment), cols = ids(data.collaborators), docs = ids(data.doctors);
    const tps = ids(bundle.timepoints), sts = ids(bundle.studies);
    bundle.bookings.forEach((b) => {
      if (b.locationId) assert.ok(locs.has(b.locationId), `sala ${b.locationId} não existe`);
      [b.equipmentId, ...(b.accessoryIds || [])].filter(Boolean).forEach((id) => assert.ok(eqs.has(id), `equipamento ${id} não existe`));
      (b.collaboratorIds || []).forEach((id) => assert.ok(cols.has(id), `colaborador ${id} não existe`));
      if (b.doctorId) assert.ok(docs.has(b.doctorId), `médico ${b.doctorId} não existe`);
      if (b.studyId) assert.ok(sts.has(b.studyId), `estudo ${b.studyId} não existe`);
      if (b.timepointId) assert.ok(tps.has(b.timepointId), `visita ${b.timepointId} não existe`);
    });
    bundle.timepoints.forEach((tp) => assert.ok(sts.has(tp.studyId), `visita apontando pra estudo inexistente`));
  }
});

/* ---------------------------------------------------------------------- */
console.log(`\n${passed} passaram, ${failed} falharam\n`);
process.exit(failed ? 1 : 0);
