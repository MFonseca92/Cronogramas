/* =======================================================================
   Extrator do motor — carrega as funções puras do HTML num sandbox
   =======================================================================

   O app é um HTML único com JSX transpilado no navegador, então não dá pra
   `require` nada dele. Este módulo anda pelo texto do arquivo, recorta as
   declarações pedidas pelo nome e as avalia num contexto isolado.

   Por que virou módulo: isto nasceu dentro do `engine.test.js`, e o gerador
   de dados de demonstração (`demo-seed.js`) passou a precisar do MESMO
   motor. Reescrever as regras no gerador faria a demonstração nascer
   violando justamente o que a tela cobra — sala não permitida, gente sem
   treinamento, aparelho com calibração vencida. Melhor um extrator só, usado
   pelos dois.

   ======================================================================= */
const fs = require("fs");
const vm = require("vm");

/* Funções puras do motor (as que não tocam em React). Ordem não importa:
 * são declarações de função (hoisted), avaliadas todas juntas. */
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

/* Constantes de topo. Aqui a ORDEM IMPORTA: o extrator emite os `const` na
 * sequência desta lista, e alguns dependem dos anteriores (ex.:
 * DEFAULT_ROLE_SCREENS usa TELAS_DO_DIA_A_DIA). */
const CONST_NAMES = [
  "genId", "toMin", "overlaps", "fmtDate", "addDays", "weekdayKey", "weekdayLabel", "todayStr",
  "DEFAULT_AVAIL", "WEEKDAYS", "bookingBlock", "addMinutes", "SLOT_STEP_MIN", "minToHHMM",
  "PLAN_WEIGHTS", "STUDY_STATUS", "isStudyOpen",
  "TRAINING_STATUS_META", "TRAINING_DEFAULT_MIN", "isTrainingBooking", "pickList",
  "BOOKING_TYPE_META", "isEstimateBooking", "nowStamp", "nowHHMM",
  "ESTIMATE_STATUS_META", "ESTIMATE_OPEN", "ESTIMATE_CLOSED", "isEstimateOpen", "estimateHoldsNow",
  "ABSENCE_KINDS", "ABSENCE_KIND_META", "daysBetween",
  "ACTIVITY_NAMES", "LOCATION_NAMES", "SPONSOR_NAMES", "CUSTOM_NICHE_SPONSORS",
  "SCREENS", "screenCap", "SCREEN_CAPS", "TELAS_DO_DIA_A_DIA", "DEFAULT_ROLE_SCREENS",
  "CAPABILITIES", "CAP_GROUPS", "DEFAULT_ROLE_CAPABILITIES", "EDITABLE_ROLES",
];

/* Anda pelo texto contando (){}[] fora de string/comentário e devolve a
 * declaração inteira — funciona tanto pra `function f(){...}` quanto pra
 * `const X = {...}` de várias linhas ou de uma linha só com comentário no fim. */
function grab(SRC, name, isConst) {
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

/* Carrega o motor.
 *
 *   htmlPath    caminho do Cronogramas_v2.html
 *   fns/consts  nomes EXTRA, além das listas padrão acima
 *   random      substitui Math.random DENTRO do sandbox. O cadastro de
 *               exemplo sorteia salas e durações; com um gerador semeado a
 *               demonstração sai igual toda vez que for regerada, que é o
 *               que permite ensaiar a apresentação e reencontrar a mesma
 *               tela no dia.
 */
function loadEngine({ htmlPath, src, fns = [], consts = [], random } = {}) {
  const SRC = src != null ? src : fs.readFileSync(htmlPath, "utf8");
  const constNames = [...CONST_NAMES, ...consts.filter((n) => !CONST_NAMES.includes(n))];
  const fnNames = [...FN_NAMES, ...fns.filter((n) => !FN_NAMES.includes(n))];
  const all = [...constNames, ...fnNames];
  // `const`/`function` num vm.Script ficam no escopo do script, não viram
  // propriedade do sandbox — daí a linha final que exporta tudo explicitamente.
  const code = [
    ...constNames.map((n) => grab(SRC, n, true)),
    ...fnNames.map((n) => grab(SRC, n, false)),
    `globalThis.__E = { ${all.join(", ")} };`,
  ].join("\n");
  const sandbox = { console, __rand: random };
  vm.createContext(sandbox);
  // Precisa entrar ANTES do código do app: `seedActivities` sorteia salas na
  // própria avaliação do módulo? Não — mas seedEquipment/seedActivities são
  // chamadas depois, e um Math.random trocado aqui vale pras duas.
  if (random) vm.runInContext("Math.random = () => __rand();", sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.__E;
}

module.exports = { loadEngine, grab, FN_NAMES, CONST_NAMES };
