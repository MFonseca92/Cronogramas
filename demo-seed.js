/* =======================================================================
   Gerador de dados de DEMONSTRAÇÃO
   =======================================================================

   Popula o banco com um trimestre de operação realista — mês passado, mês
   atual e mês seguinte —, pra a apresentação mostrar o sistema com a agenda
   cheia em vez das seis reservas do pacote de exemplo.

   Rodar:
     node demo-seed.js                  (grava em data.db, recusa se já existir)
     node demo-seed.js --force          (apaga o data.db e regera do zero)
     node demo-seed.js --db outro.db    (grava em outro arquivo)
     node demo-seed.js --seed 42        (outra variação dos sorteios)
     node demo-seed.js --vazio --force  (base LIMPA: cadastro de pé, zero
                                         movimento, 4 colaboradores e 4
                                         médicos — pra testar criando tudo
                                         à mão)

   ---------------------------------------------------------------------
   POR QUE ELE NÃO ESCREVE AS REGRAS DE NOVO

   Todo agendamento aqui sai de `findSlotOnDay`/`suggestCombo` — o MESMO
   motor que a tela usa —, carregado do HTML pelo `engine-harness.js`. Um
   gerador com a sua própria noção de "sala livre" produziria uma
   demonstração que viola o que o sistema cobra: sala não permitida pro
   método, gente sem treinamento, aparelho com calibração vencida. Aí o
   alerta aparece em toda tela, vira ruído, e a apresentação passa a
   explicar defeito do gerador em vez de mostrar o produto.

   No fim, tudo passa por `validateBooking` (a regra da tela) e pelo próprio
   servidor (a regra que vale). Se algo não fecha, o gerador falha alto em
   vez de gravar um banco torto.

   ---------------------------------------------------------------------
   AS DATAS SÃO RELATIVAS A HOJE

   "Ontem", "em andamento agora", "vence em 2 dias" são calculados no
   momento em que este arquivo roda. Gerar hoje e apresentar daqui a três
   semanas deixa a demonstração velha: o que era "hoje" virou passado e o
   Painel esvazia. Rode de novo na véspera — leva alguns segundos e é
   idempotente (com --force).
   ======================================================================= */
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { loadEngine } = require("./engine-harness");

/* ---------------------------------------------------------------------- */
/* Argumentos                                                              */
/* ---------------------------------------------------------------------- */
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const FORCE = argv.includes("--force");
/* Base LIMPA: o cadastro fica de pé (salas, métodos, equipamentos, insumos,
 * patrocinadores) e o movimento não existe — nenhum estudo, nenhuma reserva,
 * nenhum histórico. É a base pra testar o sistema de dentro, criando as
 * coisas à mão, em vez de olhar dados prontos. A equipe encolhe pra 4
 * colaboradores e 4 médicos: com 22 pessoas fica difícil acompanhar quem o
 * motor escolheu e por quê. */
const VAZIO = argv.includes("--vazio") || argv.includes("--limpo");
const DB_PATH = path.resolve(flag("--db", path.join(__dirname, "data.db")));
const SEED = Number(flag("--seed", "20260819"));
const QUIET = argv.includes("--quiet");
const log = (...a) => { if (!QUIET) console.log(...a); };

/* Sorteio semeado: a demonstração sai IGUAL toda vez que for regerada com a
 * mesma semente. Sem isso não dá pra ensaiar — a tela do ensaio não é a
 * tela do dia. (mulberry32) */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const int = (min, max) => min + Math.floor(rand() * (max - min + 1));
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
};

/* O motor, carregado do próprio HTML. `random` entra no sandbox pra o
 * cadastro de exemplo (que sorteia salas e durações) também ser reprodutível. */
const E = loadEngine({
  htmlPath: path.join(__dirname, "Cronogramas_v2.html"),
  fns: ["seedUsers", "seedCalendar", "seedTrainingTypes"],
  random: rand,
});

const T0 = E.todayStr();
const d = (n) => E.addDays(T0, n);
const WINDOW_START = d(-62);   // ~2 meses atrás
const WINDOW_END = d(45);      // ~1 mês e meio à frente
const isBusinessDay = (date) => !["sat", "sun"].includes(E.weekdayKey(date));
const isoAt = (date, hhmm) => new Date(`${date}T${hhmm || "09:00"}:00`).toISOString();
const nowIso = () => new Date().toISOString();
const id = (p) => E.genId(p);

/* ---------------------------------------------------------------------- */
/* 1. Cadastro                                                             */
/*                                                                         */
/* Parte do mesmo cadastro de exemplo que o app semeia sozinho, e o AMPLIA  */
/* até o tamanho de um setor de verdade: mais gente, mais gente qualificada */
/* e custo/hora em todo mundo. Sem custo cadastrado a tela de Indicadores   */
/* mostra zero em quase tudo, e é justamente ela que interessa à gestão.    */
/* ---------------------------------------------------------------------- */
const EXTRA_COLLABORATORS = [
  "Bruno Sartori", "Carolina Nakamura", "Diego Vasques", "Elaine Portilho",
  "Felipe Aragão", "Giovana Bertoldi", "Hugo Marchetti", "Isabela Quirino",
  "Jonas Rezende", "Karina Villaça", "Lucas Bittencourt", "Mariana Estevão",
];

/* Todo mundo com o MESMO PIN nos dados de teste.
 *
 * O pacote de exemplo do app dá um PIN diferente pra cada conta de serviço
 * (Gestor 4560, Treinamento 1112, Agendador 7890). Numa demonstração isso só
 * atrapalha: quem está apresentando troca de usuário seis vezes e trava
 * lembrando qual é qual. Aqui é tudo 1234.
 *
 * Vale dizer o óbvio: isto é dado de teste. O PIN fica em texto puro e é
 * conferido no navegador — em produção precisa virar hash conferido no
 * servidor, junto com o login de verdade. Ver o cabeçalho do server.js. */
const PIN_DEMO = "1234";
function padronizarPins(users, collaborators, doctors) {
  [...users, ...collaborators, ...doctors].forEach((x) => { if (x) x.pin = PIN_DEMO; });
  return users;
}

function buildCatalog({ enxuto = false } = {}) {
  const niches = E.seedNiches();
  const sponsors = E.seedSponsors(niches);
  const supplies = E.seedSupplies();
  const locations = E.seedLocations();
  const activities = E.seedActivities(locations, supplies);
  const equipment = E.seedEquipment();
  const doctors = E.seedDoctors();
  const base = E.seedCollaborators(activities);

  // Custo/hora em TODO recurso: é o que faz Indicadores e o custo por reserva
  // pararem de sair subestimados. Faixas plausíveis, não números redondos.
  locations.forEach((l, i) => {
    l.hourlyCost = l.hourlyCost ?? [28, 35, 40, 45, 52, 60][i % 6];
    l.capacity = l.capacity ?? [4, 6, 8, 10][i % 4];
  });
  equipment.forEach((e, i) => { if (e.hourlyCost == null) e.hourlyCost = e.isAccessory ? [6, 8, 10][i % 3] : [15, 22, 30, 42][i % 4]; });

  /* Calibração em quase todo aparelho. O cadastro de exemplo controla 6 dos 26,
   * e a tela de Calibração fica sendo uma lista de "sem controle" — que é o
   * contrário do que ela existe pra mostrar. Aqui a maioria entra com
   * intervalo e uma última calibração espalhada, produzindo naturalmente a
   * mistura em dia / vencendo / vencido que dá conteúdo ao filtro.
   *
   * O motor confere calibração NA DATA da reserva, então isto precisa estar
   * definido ANTES de agendar qualquer coisa: aparelho vencido simplesmente
   * não é escolhido pras datas em que está vencido. */
  equipment.forEach((e, i) => {
    if (e.calibrationIntervalDays != null || i % 9 === 0) return; // alguns ficam sem controle, como na vida real
    const intervalo = pick([180, 365, 365, 730]);
    // Espalhado de "calibrado ontem" a "vencido há um mês".
    e.calibrationIntervalDays = intervalo;
    e.lastCalibration = E.addDays(T0, -int(5, intervalo + 30));
  });
  doctors.forEach((doc, i) => { doc.hourlyCost = doc.hourlyCost ?? [110, 125, 140, 155][i % 4]; });

  // Na base limpa o setor é pequeno de propósito: 4 pessoas e 4 médicos. Dá
  // pra conferir cada escolha do motor de cabeça, que é o ponto de testar
  // assim. Cheia, a demonstração precisa de gente pra agenda fechar.
  const collaborators = enxuto ? base.slice(0, 4) : [
    ...base,
    ...EXTRA_COLLABORATORS.map((name) => ({
      id: id("col"), name, levels: {}, availability: { ...E.DEFAULT_AVAIL }, active: true, hourlyCost: null, pin: "1234",
    })),
  ];
  if (enxuto) doctors.splice(4);
  collaborators.forEach((c, i) => { c.hourlyCost = c.hourlyCost ?? [24, 27, 30, 33, 36][i % 5]; });

  /* Qualificação. O pacote de exemplo dá 2-3 métodos por pessoa, o que basta
   * pra seis reservas e trava completamente numa agenda cheia: sem gente
   * qualificada o motor não fecha horário nenhum e a demonstração nasce
   * vazia. Aqui cada método recebe ao menos 5 pessoas aptas, e cada pessoa
   * fica com uma especialidade (nível 5) e um resto de nível 3-4 — que é
   * como um setor de verdade se parece, e o que dá conteúdo à tela de
   * treinamento. */
  /* Com 4 pessoas não dá pra garantir 5 aptas por método — e mais importante:
   * numa base limpa, "sem ninguém treinado" seria a primeira parede que a
   * pessoa encontraria, antes de conseguir testar qualquer coisa. Então todo
   * mundo nasce habilitado em tudo. Pra exercitar a tela de Treinamentos,
   * basta baixar o nível de alguém no Cadastro. */
  if (enxuto) {
    collaborators.forEach((c) => { activities.forEach((act) => { c.levels[act.id] = int(4, 5); }); });
    const users = padronizarPins(E.seedUsers(collaborators, doctors), collaborators, doctors);
    return {
      niches, sponsors, supplies, locations, activities, equipment, doctors, collaborators, users,
      calendar: E.seedCalendar(), carentes: [],
      trainingTypes: E.seedTrainingTypes(activities, locations, equipment),
    };
  }

  const MIN_APTOS = 5;
  activities.forEach((act) => {
    const min = act.minLevel || 3;
    const aptos = collaborators.filter((c) => (c.levels[act.id] || 0) >= min);
    if (aptos.length >= MIN_APTOS) return;
    const candidatos = shuffle(collaborators.filter((c) => (c.levels[act.id] || 0) < min));
    candidatos.slice(0, MIN_APTOS - aptos.length).forEach((c) => { c.levels[act.id] = int(min, 5); });
  });
  // Uma lacuna DE PROPÓSITO: dois métodos ficam com pouca gente apta, pra a
  // tela de Treinamentos ter motivo de existir na apresentação.
  const carentes = shuffle(activities).slice(0, 2);
  carentes.forEach((act) => {
    const aptos = collaborators.filter((c) => (c.levels[act.id] || 0) >= (act.minLevel || 3));
    shuffle(aptos).slice(2).forEach((c) => { c.levels[act.id] = 2; });
  });

  const users = padronizarPins(E.seedUsers(collaborators, doctors), collaborators, doctors);
  const calendar = E.seedCalendar();

  const trainingTypes = E.seedTrainingTypes(activities, locations, equipment);
  return { niches, sponsors, supplies, locations, activities, equipment, doctors, collaborators, users, calendar, carentes, trainingTypes };
}

/* ---------------------------------------------------------------------- */
/* 2. Calendário: férias, folgas, manutenção, evento                        */
/*                                                                          */
/* Feriado já vem do app. O que falta é a exceção do dia a dia — e ela não  */
/* é enfeite: é o que faz o motor DESVIAR de gente e sala indisponível na   */
/* frente de todo mundo, que é o argumento da ferramenta.                    */
/* ---------------------------------------------------------------------- */
function buildAbsences(cat) {
  const out = [];
  const add = (kind, title, scope, targetIds, dateStart, dateEnd, extra = {}) => out.push({
    id: id("cal"), kind, title, scope, targetIds, dateStart, dateEnd,
    allDay: true, start: null, end: null, notes: null,
    createdBy: "Gestor", createdAt: isoAt(WINDOW_START, "08:00"), ...extra,
  });

  const deFerias = shuffle(cat.collaborators).slice(0, 4);
  deFerias.forEach((c, i) => {
    const inicio = d(int(-40, 30));
    add("ferias", `Férias — ${c.name}`, "recurso", [c.id], inicio, E.addDays(inicio, [9, 14, 14, 20][i % 4]));
  });
  shuffle(cat.collaborators).slice(0, 5).forEach((c) => {
    const dia = d(int(-50, 40));
    add("folga", `Folga — ${c.name}`, "recurso", [c.id], dia, dia);
  });
  // Sala interdita: o motor tem que realocar sozinho quem cairia nela.
  const sala = cat.locations[int(3, cat.locations.length - 1)];
  const manut = d(int(3, 20));
  add("manutencao", `Manutenção elétrica — ${sala.name}`, "recurso", [sala.id], manut, E.addDays(manut, 3));
  // Aparelho parado pra calibração externa.
  const eq = cat.equipment.find((e) => !e.isAccessory && e.name.startsWith("Visia"));
  if (eq) { const ini = d(int(5, 25)); add("manutencao", `Calibração externa — ${eq.name}`, "recurso", [eq.id], ini, E.addDays(ini, 5)); }
  // Confraternização: meio período, atinge todo mundo.
  const festa = d(int(10, 35));
  add("evento", "Confraternização do setor", "todos", [], festa, festa, { allDay: false, start: "16:00", end: "18:00" });

  return out;
}

/* ---------------------------------------------------------------------- */
/* 3. Estudos e protocolos                                                  */
/* ---------------------------------------------------------------------- */
const PROTOCOL_TEMPLATES = [
  [["Baseline (D0)", 0, 0], ["T1 (D7±2)", 7, 2], ["T2 (D14±2)", 14, 2], ["T3 (D28±3)", 28, 3]],
  [["Baseline (D0)", 0, 0], ["T1 (D14±2)", 14, 2], ["T2 (D28±3)", 28, 3], ["T3 (D56±5)", 56, 5]],
  [["Baseline (D0)", 0, 0], ["T1 (D21±3)", 21, 3]],
  [["Baseline (D0)", 0, 0], ["T1 (D3±1)", 3, 1], ["T2 (D7±2)", 7, 2], ["T3 (D14±2)", 14, 2], ["T4 (D28±3)", 28, 3]],
  [["Baseline (D0)", 0, 0], ["T1 (D28±3)", 28, 3], ["Final (D84±7)", 84, 7]],
];
const STUDY_CODES = [
  "HYDRA-204", "SOLARIS-11", "DERMAX-77", "CAPILAR-32", "AXILA-18", "REGENERA-5",
  "CLAREIA-140", "BARRIER-63", "MICROBIO-9", "ANTIAGE-250", "SENSITIVE-41", "SUNGUARD-88",
  "PURITY-19", "VOLUME-72", "REPAIR-330", "TONE-27", "COMFORT-102", "SCALP-64",
  "FIRMEZA-58", "OLEO-13", "ACNE-96", "NUTRI-45", "ELASTIN-8", "GLOW-115",
  "CALMA-36", "DETOX-21", "LIFT-190", "SEBUM-54", "TEXTURA-73", "MELASMA-29",
  "CICATRIZ-61", "PORO-44", "BRILHO-107", "ANTIOX-82", "PROTECT-155", "SOOTHE-38",
];

function buildStudies(cat) {
  const sponsors = shuffle(cat.sponsors);
  return STUDY_CODES.map((code, i) => {
    const protocolo = PROTOCOL_TEMPLATES[i % PROTOCOL_TEMPLATES.length];
    // Baselines espalhados pelo trimestre: é o que faz as visitas caírem em
    // dias diferentes em vez de empilharem todas na mesma semana.
    const baseline = d(int(-58, 38));
    const sponsor = sponsors[i % sponsors.length];
    const fim = E.addDays(baseline, protocolo[protocolo.length - 1][1]);
    const status = fim < T0 ? (chance(0.75) ? "concluido" : "ativo")
      : baseline > d(12) ? "planejamento" : "ativo";
    return {
      id: id("study"), name: `Protocolo ${code}`, sponsorId: sponsor.id,
      createdAt: isoAt(E.addDays(baseline, -int(8, 30)), "10:00"), status,
      baselineDate: baseline,
      endDate: E.addDays(fim, int(5, 25)),
      _protocolo: protocolo,
      /* Grupos de 2 a 4 pessoas, de propósito: as salas têm capacidade a
       * partir de 4 e alguns métodos limitam em 4 participantes. Grupo maior
       * que isso simplesmente não fecharia horário nenhum, e a demonstração
       * nasceria com metade das visitas sem agenda — parecendo defeito do
       * motor quando seria só um cadastro impossível. */
      groups: Array.from({ length: int(2, 3) }, (_, gi) => ({
        id: id("grp"), name: `Grupo ${String.fromCharCode(65 + gi)}`, size: int(2, 4),
      })),
    };
  });
}

/* Com grupos, o total do estudo é a soma deles — a mesma regra da tela
 * (`studyParticipantsTotal`). Guardado junto pra quem lê o estudo não
 * precisar somar. */
function totalDosGrupos(s) {
  return (s.groups || []).reduce((t, g) => t + (Number(g.size) || 0), 0);
}

function buildTimepoints(studies) {
  const out = [];
  studies.forEach((s) => {
    s._protocolo.forEach(([label, offsetDays, toleranceDays]) => {
      const w = E.timepointWindow({ offsetDays, toleranceDays }, s.baselineDate);
      out.push({
        id: id("tp"), studyId: s.id, label, offsetDays, toleranceDays,
        dateMin: w.dateMin, dateMax: w.dateMax, createdAt: s.createdAt,
      });
    });
  });
  return out;
}

/* ---------------------------------------------------------------------- */
/* 4. Agendamento                                                           */
/*                                                                          */
/* O coração do gerador. Cada visita vira de 2 a 5 atividades encadeadas no */
/* mesmo dia, agendadas pelo motor do app.                                   */
/*                                                                          */
/* `findSlotOnDay` recebe só as reservas DAQUELE dia. A regra de conflito    */
/* nunca compara datas diferentes, então o resultado é idêntico ao de passar */
/* a lista inteira — e a diferença é entre rodar em segundos e rodar em      */
/* minutos, porque cada slot testado varre a lista uma vez.                   */
/* ---------------------------------------------------------------------- */
const SEM_EXCLUIDOS = { locations: [], collaborators: [], doctors: [] };

function agendarVisita({ cat, data, porDia, date, quantas, meta, notBefore = 8 * 60, simultaneas = false, grupo = null }) {
  const metodos = shuffle(cat.activities).slice(0, quantas);
  const rows = metodos.map((act, i) => ({
    rowId: id("row"), activityId: act.id, durationMin: act.durationMin || 60,
    roomId: null, equipmentId: null, accessoryIds: [], needDoctor: chance(0.18),
    // Com grupo, o número de participantes VEM DELE — é esse o ponto do
    // cadastro de grupos. Sem grupo, sorteia como antes.
    participants: grupo ? Number(grupo.size) || null : (act.maxParticipants ? int(2, act.maxParticipants) : null),
    minLevel: act.minLevel || 3,
    // Atividades simultâneas: mesma sala, mesmo horário, gente diferente. É um
    // caso real do setor (apoio rodando junto com a lavagem) e um recurso que
    // não tem como demonstrar sem nenhum exemplo na base.
    groupKey: simultaneas && i < 2 ? "A" : null,
  }));

  const criadas = [];
  let cursor = notBefore;
  let salaPreferida = null;

  for (const group of E.groupRows(rows)) {
    const doDia = porDia.get(date) || [];
    const slot = E.findGroupSlotOnDay(group, date, data, doDia, SEM_EXCLUIDOS,
      { preferLocationId: salaPreferida, notBeforeMin: cursor });
    if (!slot) continue; // dia cheio pra esse método: segue pro próximo

    const gid = group.length > 1 ? `${meta.timepointId || meta.estimateVisitId || date}:${group[0].rowId}` : null;
    slot.items.forEach((sub, i) => {
      const it = E.planItemFrom(sub.row, date, sub, null);
      const act = cat.activities.find((a) => a.id === sub.row.activityId);
      const equipe = (it.collaborators || (it.collaborator ? [it.collaborator] : [])).map((c) => c.id);
      const b = {
        id: id("bk"),
        date, start: it.start, end: it.end,
        blockStart: it.blockStart || it.start, blockEnd: it.blockEnd || it.end,
        locationId: it.location.id, equipmentId: it.equipment?.id || null,
        accessoryIds: sub.row.accessoryIds, activityId: act.id, minLevel: sub.row.minLevel,
        collaboratorIds: equipe, needDoctor: sub.row.needDoctor, doctorId: it.doctor?.id || null,
        participantCount: sub.row.participants,
        // Grupo de PESSOAS do estudo. Não confundir com `groupId`, que é o
        // grupo de ATIVIDADES simultâneas na mesma sala.
        studyGroupId: grupo?.id || null,
        groupId: gid,
        status: E.bookingStatusFor({ collaboratorIds: equipe, needDoctor: sub.row.needDoctor, doctorId: it.doctor?.id || null }, act),
        ...meta,
      };
      criadas.push(b);
      if (!porDia.has(date)) porDia.set(date, []);
      // Dentro do grupo a sala é a mesma DE PROPÓSITO. Só a primeira registra
      // a sala como ocupada; senão a segunda veria a primeira bloqueando a
      // sala que as duas dividem — é o mesmo cuidado do `planSameDay`.
      porDia.get(date).push(i === 0 ? b : { ...b, locationId: null });
    });

    // O próximo grupo só começa depois da desmontagem do anterior mais a folga
    // que o método exige.
    cursor = slot.endMin + slot.maxTeardown + slot.maxGap + int(0, 20);
    salaPreferida = slot.location.id;
  }
  return criadas;
}

/* Dia útil mais próximo de `alvo`, dentro de `[min, max]`. Visita não cai em
 * sábado, e empurrar sempre pra frente encostaria tudo na segunda. */
function diaUtilPerto(alvo, min, max) {
  for (let delta = 0; delta <= 6; delta++) {
    for (const cand of delta === 0 ? [alvo] : [E.addDays(alvo, -delta), E.addDays(alvo, delta)]) {
      if (cand >= min && cand <= max && isBusinessDay(cand)) return cand;
    }
  }
  return null;
}

function buildBookings(cat, studies, timepoints) {
  const data = { ...cat, calendar: cat.calendar };
  const porDia = new Map();
  const bookings = [];
  const desvios = [];

  // Ordem cronológica: o motor distribui a carga olhando o que já existe no
  // dia, então agendar fora de ordem daria uma agenda enviesada.
  const agenda = [];
  studies.forEach((s) => {
    if (s.status === "planejamento") return; // protocolo montado, nada marcado ainda
    timepoints.filter((tp) => tp.studyId === s.id).forEach((tp) => {
      const alvo = E.addDays(s.baselineDate, tp.offsetDays);
      if (alvo < WINDOW_START || alvo > WINDOW_END) return;
      agenda.push({ study: s, tp, alvo });
    });
  });

  /* Uma visita em cada doze sai FORA da tolerância do protocolo, de propósito.
   * É o desvio que a tela de Estudos existe pra denunciar, e sem nenhum
   * exemplo na base o recurso não tem o que mostrar. Escolhidas por sorteio
   * sobre a lista inteira (e não por moeda a cada visita) pra a quantidade não
   * variar de zero a vinte entre uma geração e outra. */
  const elegiveis = agenda.filter((x) => x.tp.offsetDays > 0);
  const foraDoProtocolo = new Set(shuffle(elegiveis).slice(0, Math.max(5, Math.round(elegiveis.length / 12))));

  /* Um punhado de visitas FUTURAS fica sem agendar de propósito. É o alerta
   * "visita vence em N dias e ninguém marcou" do Painel — o mais útil da tela,
   * e o único que não tem como demonstrar com a agenda perfeitamente em dia. */
  const proximas = agenda.filter((x) => x.tp.dateMax >= T0 && x.tp.dateMax <= d(14) && x.tp.offsetDays > 0);
  const semAgendar = new Set(shuffle(proximas).slice(0, Math.max(4, Math.round(proximas.length / 4))));

  agenda.forEach((x) => {
    if (semAgendar.has(x)) { x.date = null; return; }
    const fora = foraDoProtocolo.has(x);
    x.date = fora
      ? diaUtilPerto(E.addDays(x.alvo, (x.tp.toleranceDays || 1) + int(2, 5)), WINDOW_START, WINDOW_END)
      : diaUtilPerto(x.alvo, x.tp.dateMin, x.tp.dateMax) || diaUtilPerto(x.alvo, WINDOW_START, WINDOW_END);
    if (x.date && fora) desvios.push(`${x.study.name} · ${x.tp.label}`);
  });

  // Ordem cronológica de verdade só depois de escolher as datas.
  agenda.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  agenda.forEach(({ study, tp, date }) => {
    if (!date) return;
    const novas = agendarVisita({
      cat, data, porDia, date,
      // Cada visita atende UM grupo. É assim no setor: o grupo A vem numa
      // data, o grupo B em outra.
      grupo: (study.groups || []).length ? pick(study.groups) : null,
      quantas: int(3, 6),
      notBefore: 8 * 60 + int(0, 4) * 15,
      // Uma visita em cada seis tem duas atividades rodando ao mesmo tempo na
      // mesma sala.
      simultaneas: chance(0.17),
      meta: {
        studyId: study.id, timepointId: tp.id, studyName: study.name, sponsorId: study.sponsorId,
        bookingType: "reservation", createdBy: pick(["Agendador", "Gestor", "Camila Rocha"]),
      },
    });
    bookings.push(...novas);
  });

  /* Encaixes avulsos: reserva sem estudo, que é metade do uso real do
   * Cronograma. Sem eles a agenda fica suspeitamente arrumada. */
  for (let i = -60; i <= 44; i += 1) {
    const date = d(i);
    if (!isBusinessDay(date) || !chance(0.75)) continue;
    bookings.push(...agendarVisita({
      cat, data, porDia, date, quantas: int(1, 3),
      notBefore: int(8, 14) * 60,
      meta: {
        studyId: null, timepointId: null, studyName: pick(["Encaixe — retorno de voluntária", "Encaixe — repetição de leitura", "Encaixe — treinamento prático", "Encaixe — visita extra do patrocinador"]),
        sponsorId: null, bookingType: "reservation", createdBy: "Agendador",
      },
    }));
  }

  /* Reforço do dia de HOJE e dos próximos.
   *
   * O sorteio distribui bem na média e mal no dia que importa: a plateia abre
   * o Cronograma em "hoje", e "hoje" pode ter calhado de sair com quatro
   * reservas em duas salas. Aqui o dia atual e os dois seguintes são
   * completados até uma agenda cheia de verdade — mais gente, mais salas,
   * mais o dia inteiro ocupado.
   *
   * Não é trapaça com o motor: cada reserva acrescentada passa pela mesma
   * busca de horário e pelas mesmas regras. É só insistir mais nesses dias. */
  const ALVO_HOJE = 14;
  for (const dia of [T0, d(1), d(2)]) {
    if (!isBusinessDay(dia)) continue;
    let tentativas = 0;
    while ((porDia.get(dia) || []).length < ALVO_HOJE && tentativas++ < 25) {
      const novas = agendarVisita({
        cat, data, porDia, date: dia, quantas: int(2, 3),
        notBefore: int(8, 16) * 60,
        meta: {
          studyId: null, timepointId: null,
          studyName: pick(["Encaixe — retorno de voluntária", "Encaixe — repetição de leitura", "Encaixe — visita extra do patrocinador", "Encaixe — coleta adicional"]),
          sponsorId: null, bookingType: "reservation", createdBy: "Agendador",
        },
      });
      if (!novas.length) break; // dia genuinamente cheio: parar em vez de girar à toa
      bookings.push(...novas);
    }
  }

  return { bookings, porDia, desvios, data };
}

/* Marca o que já passou como executado. Sem isso o Histórico, os Indicadores
 * e o aprendizado de duração ficam sem nada pra ler — e é justamente essa a
 * parte que interessa a quem vai aprovar a compra. */
function aplicarExecucao(bookings) {
  let concluidas = 0;
  const agora = E.nowHHMM();
  const deHoje = [];

  bookings.forEach((b) => {
    if (b.bookingType === "estimate") return;
    if (b.date < T0) {
      // Atraso e duração real: quase toda visita escorrega alguns minutos, e é
      // dessa diferença que sai a estatística de duração real x planejada.
      b.actualStart = E.addMinutes(b.start, int(-5, 12));
      b.actualEnd = E.addMinutes(b.end, int(-10, 25));
      b.completedAt = isoAt(b.date, b.end);
      concluidas++;
    } else if (b.date === T0) {
      deHoje.push(b);
    }
  });

  /* O dia de HOJE é o que a plateia vai olhar primeiro, e ele tem que estar no
   * meio do expediente: o que já passou, concluído; o que está acontecendo
   * agora, em andamento; o resto, por fazer.
   *
   * Se a apresentação for cedo e nada tiver começado ainda, uma reserva é
   * marcada como iniciada mesmo assim — a tela "em andamento" existe e precisa
   * ter o que mostrar. É por isso também que vale regerar na véspera: quanto
   * mais perto a geração for da apresentação, menos este remendo é usado. */
  deHoje.sort((a, b) => (a.start < b.start ? -1 : 1));
  let emAndamento = 0;
  deHoje.forEach((b) => {
    if (b.end <= agora) {
      b.actualStart = E.addMinutes(b.start, int(-3, 8));
      b.actualEnd = E.addMinutes(b.end, int(-8, 18));
      b.completedAt = isoAt(b.date, b.end);
      concluidas++;
    } else if (b.start <= agora) {
      b.actualStart = E.addMinutes(b.start, int(0, 7));
      b.startedAt = isoAt(b.date, b.start);
      emAndamento++;
    }
  });
  if (!emAndamento) {
    // A que ainda não começou e começa mais cedo. Tem que ser uma SEM
    // `completedAt`: marcar "iniciada" numa que já terminou não produz o
    // estado "em andamento", só uma reserva concluída com um campo a mais.
    const candidata = deHoje.find((b) => !b.completedAt);
    if (candidata) {
      candidata.actualStart = candidata.start;
      candidata.startedAt = isoAt(candidata.date, candidata.start);
      emAndamento = 1;
    }
  }

  return { concluidas, emAndamento };
}

/* ---------------------------------------------------------------------- */
/* 5. Estimativas (o funil comercial)                                       */
/* ---------------------------------------------------------------------- */
const CLIENTES = ["Compras — Unilever", "P&D — Natura", "Marketing — Boticário", "Regulatório — L'Oréal", "Inovação — Beiersdorf", "Compras — Mary Kay"];

function buildEstimates(cat, data, porDia, studies) {
  const estimates = [];
  const previstas = [];
  const sponsors = shuffle(cat.sponsors);

  /* A PRÉ-RESERVA vem primeiro de propósito. Ela é a única que tira horário de
   * alguém; a estimativa "aberta" é previsão pura e não segura nada. Gerando na
   * ordem inversa, a previsão ocupava o horário primeiro (sem bloquear nada), a
   * pré-reserva legitimamente pegava a mesma sala depois — e a base nascia com
   * uma previsão desenhada em cima de um bloqueio real, que é justamente o
   * conflito que a tela abre pra pessoa resolver. Correto como comportamento,
   * péssimo como dado de demonstração. */
  const cenarios = [
    { status: "pre_reserva", holds: true, n: 3 },
    { status: "aberta", holds: false, n: 4 },
    { status: "rascunho", holds: false, n: 2 },
    { status: "cancelada", holds: false, n: 2 },
    { status: "convertida", holds: false, n: 2 },
    { status: "expirada", holds: false, n: 1 },
  ];

  let i = 0;
  cenarios.forEach(({ status, holds, n }) => {
    for (let k = 0; k < n; k++, i++) {
      const sponsor = sponsors[(i * 3) % sponsors.length];
      const baseline = d(int(6, 40));
      const protocolo = PROTOCOL_TEMPLATES[i % 3];
      // A primeira pré-reserva vence em 2 dias: é o alerta "prazo acabando"
      // que a tela de Estimativas existe pra dar.
      const holdUntil = holds ? (k === 0 ? d(2) : d(int(8, 25))) : null;
      const est = {
        id: id("est"), name: `Oportunidade ${sponsor.name.split(" ")[0]} ${2026}-${String(100 + i)}`,
        client: pick(CLIENTES), sponsorId: sponsor.id, responsibleId: null,
        status, baselineDate: baseline, startMin: baseline, startMax: E.addDays(baseline, 5),
        endDate: E.addDays(baseline, protocolo[protocolo.length - 1][1] + 15),
        protocol: protocolo.map(([label, offsetDays, toleranceDays]) => ({ tpId: id("estv"), label, offsetDays, toleranceDays })),
        holdsResources: holds, holdUntil,
        estimatedValue: int(18, 220) * 1000,
        notes: null,
        createdAt: isoAt(d(-int(3, 40)), "11:00"), createdBy: "Gestor",
        convertedStudyId: null, convertedAt: null,
        cancelledAt: null, cancelledBy: null, cancellationReason: null,
      };
      if (status === "cancelada") {
        est.cancelledAt = isoAt(d(-int(1, 20)), "16:00");
        est.cancelledBy = "Gestor";
        est.cancellationReason = pick(["Cliente não aprovou o orçamento", "Estudo suspenso", "Mudança de escopo", "Oportunidade perdida"]);
      }
      if (status === "convertida") {
        // Converter de verdade seria reconstruir estudo + visitas; pra a
        // demonstração basta apontar pra um estudo ativo que já existe — é o
        // que a taxa de conversão lê.
        const alvo = studies.find((s) => s.status === "ativo");
        est.convertedStudyId = alvo?.id || null;
        est.convertedAt = isoAt(d(-int(1, 25)), "15:00");
      }
      if (status === "expirada") est.holdUntil = d(-int(2, 10));

      estimates.push(est);

      // Ocupação prevista na agenda. Só a pré-reserva no prazo tira horário de
      // alguém — o resto entra como previsão, que é o ponto da separação.
      if (["aberta", "pre_reserva"].includes(status)) {
        est.protocol.slice(0, 2).forEach((v) => {
          const alvo = diaUtilPerto(E.addDays(baseline, v.offsetDays), T0, WINDOW_END);
          if (!alvo) return;
          previstas.push(...agendarVisita({
            cat, data, porDia, date: alvo, quantas: int(1, 3), notBefore: int(8, 14) * 60,
            meta: {
              studyId: null, timepointId: null, studyName: est.name, sponsorId: est.sponsorId,
              bookingType: "estimate", estimateId: est.id, estimateVisitId: v.tpId,
              holdsResources: holds, holdUntil, createdBy: "Gestor",
            },
          }));
        });
      }
    }
  });

  return { estimates, previstas };
}

/* Pré-reservas que JÁ FORAM liberadas — o histórico do indicador de
 * reaproveitamento de capacidade.
 *
 * A pergunta que ele responde: quando uma oportunidade cai, o horário que
 * estava segurado volta a ser vendido, ou o setor simplesmente perde o dia?
 * Sem histórico ele mostra "0 de 0", que não quer dizer nada — e é um dos
 * poucos números aqui que respondem direto ao financeiro.
 *
 * As três respostas possíveis precisam existir na base:
 *   reaproveitada     alguém marcou por cima depois. Só sai espelhando uma
 *                     reserva real que já existe naquele horário.
 *   não reaproveitada o dia passou e ficou vazio.
 *   em aberto         a data ainda não chegou; cedo pra julgar.
 *
 * Espelhar uma reserva real cria uma sobreposição de propósito, e ela é
 * legítima: a pré-reserva está VENCIDA, então `bookingOccupies` a ignora e ela
 * não tira o horário de ninguém. É exatamente o estado que o indicador mede.
 */
function buildReleasedHolds(cat, estimates, bookings) {
  const soltas = estimates.filter((e) => ["cancelada", "expirada"].includes(e.status));
  if (!soltas.length) return [];
  const out = [];
  const reais = shuffle(bookings.filter((b) => b.date < T0 && b.date > d(-45) && b.bookingType !== "estimate" && b.locationId));

  const mk = (est, date, start, end, locationId, activityId) => ({
    id: id("bk"), date, start, end, blockStart: start, blockEnd: end,
    locationId, equipmentId: null, accessoryIds: [], activityId,
    collaboratorIds: [], doctorId: null, needDoctor: false, participantCount: null,
    minLevel: null, groupId: null, status: "pendente_equipe",
    studyId: null, timepointId: null, studyName: est.name, sponsorId: est.sponsorId,
    bookingType: "estimate", estimateId: est.id, estimateVisitId: est.protocol[0]?.tpId || null,
    holdsResources: true, holdUntil: d(-int(2, 25)), createdBy: "Gestor",
  });

  // Reaproveitadas: espelham reservas reais que já aconteceram.
  reais.slice(0, 6).forEach((b, i) => {
    const est = soltas[i % soltas.length];
    out.push(mk(est, b.date, b.start, b.end, b.locationId, b.activityId));
  });
  // Não reaproveitadas: dia passado, sala que ficou livre naquele horário.
  for (let i = 0; i < 4; i++) {
    const est = soltas[i % soltas.length];
    const date = d(-int(8, 40));
    if (!isBusinessDay(date)) continue;
    const sala = pick(cat.locations);
    const start = pick(["08:00", "09:00", "15:00", "16:00"]);
    const end = E.addMinutes(start, 60);
    const ocupada = bookings.some((b) => b.date === date && b.locationId === sala.id
      && E.overlaps(E.toMin(start), E.toMin(end), E.toMin(b.blockStart || b.start), E.toMin(b.blockEnd || b.end)));
    if (ocupada) continue;
    out.push(mk(est, date, start, end, sala.id, pick(cat.activities).id));
  }
  // Em aberto: a data ainda vem, então ainda dá pra vender o horário.
  for (let i = 0; i < 3; i++) {
    const est = soltas[i % soltas.length];
    const date = d(int(3, 20));
    if (!isBusinessDay(date)) continue;
    const start = pick(["10:00", "13:00", "14:00"]);
    out.push(mk(est, date, start, E.addMinutes(start, 90), pick(cat.locations).id, pick(cat.activities).id));
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* 6. Treinamentos, horas extras, prazos, estoque, cancelamentos            */
/* ---------------------------------------------------------------------- */
function buildTrainings(cat, data, porDia, studies) {
  const requests = [];
  const aulas = [];
  const carentes = cat.carentes;
  const metodos = [...carentes, ...shuffle(cat.activities).slice(0, 12)];

  metodos.forEach((act, i) => {
    const alvo = pick(cat.collaborators.filter((c) => (c.levels[act.id] || 0) < (act.minLevel || 3)));
    if (!alvo) return;
    const instrutor = pick(cat.collaborators.filter((c) => (c.levels[act.id] || 0) >= (act.minLevel || 3)));
    // Um pedido VENCIDO e ainda pendente: é o alerta vermelho da tela.
    const atrasado = i === 0;
    const status = atrasado ? "pendente" : pick(["pendente", "agendado", "agendado", "concluido", "concluido", "recusado"]);
    const req = {
      id: id("train"), studyName: pick(studies).name,
      activityId: act.id, activityName: act.name,
      collaboratorId: alvo.id, collaboratorName: alvo.name,
      trainerId: status === "recusado" ? null : instrutor?.id || null,
      requiredLevel: act.minLevel || 3,
      deadlineDate: atrasado ? d(-4) : d(int(3, 30)),
      status, durationMin: E.TRAINING_DEFAULT_MIN,
      scheduledDate: null, scheduledStart: null,
      requestedAt: isoAt(d(-int(2, 30)), "09:30"),
      confirmedBy: status === "pendente" ? null : "Equipe de Treinamento",
      locationId: null, equipmentId: null, accessoryIds: [],
    };

    if (status === "agendado" || status === "concluido") {
      const dia = diaUtilPerto(status === "concluido" ? d(-int(3, 30)) : d(int(2, 20)), WINDOW_START, WINDOW_END);
      if (dia) {
        req.scheduledDate = dia;
        req.scheduledStart = pick(["08:30", "09:00", "13:30", "14:00", "16:00"]);
        const aula = E.trainingBookingFrom(req, act);
        // A aula é uma reserva como outra qualquer: se o horário já estiver
        // tomado, ela não entra — a demonstração não pode nascer com o
        // conflito que o sistema promete impedir.
        const doDia = porDia.get(dia) || [];
        const livre = [req.collaboratorId, req.trainerId].filter(Boolean)
          .every((p) => E.fieldFree(p, "collaborator", dia, aula.start, aula.end, doDia));
        if (livre) {
          req.bookingId = aula.id;
          aulas.push(aula);
          if (!porDia.has(dia)) porDia.set(dia, []);
          porDia.get(dia).push(aula);
        } else {
          req.scheduledDate = null; req.scheduledStart = null; req.status = "pendente"; req.confirmedBy = null;
        }
      }
      // Treinamento concluído SOBE o nível — é a regra do app, e sem aplicar
      // aqui a tela mostraria "concluído" com a pessoa ainda sem habilitação.
      if (req.status === "concluido") alvo.levels[act.id] = req.requiredLevel;
    }
    requests.push(req);
  });
  return { requests, aulas };
}

function buildOvertime(cat, studies) {
  const out = [];
  const motivos = [
    "voluntária só consegue vir após o expediente",
    "leitura precisa acontecer 12h após a aplicação",
    "janela do protocolo fecha amanhã",
    "equipamento só liberou no fim do dia",
    "patrocinador acompanha a visita e só tem essa data",
  ];
  const estados = ["pendente", "pendente", "disponivel", "aprovado", "aprovado", "recusado"];
  estados.forEach((status, i) => {
    const study = pick(studies.filter((s) => s.status === "ativo"));
    const act = pick(cat.activities);
    const pessoa = pick(cat.collaborators);
    const sala = pick(cat.locations);
    const date = d(int(1, 25));
    const start = pick(["18:00", "18:30", "19:00"]);
    out.push({
      id: id("ovt"), origin: i % 2 ? "encaixe" : "plano",
      studyId: study?.id || null, studyName: study?.name || "—",
      activityId: act.id, activityName: act.name,
      date, start, end: E.addMinutes(start, 90),
      locationId: sala.id, locationName: sala.name,
      role: "collaborator", personId: pessoa.id, personName: pessoa.name,
      collaboratorIds: [pessoa.id], doctorId: null,
      sponsorId: study?.sponsorId || null, minLevel: act.minLevel || 3,
      reason: motivos[i % motivos.length],
      requestedBy: "Gestor", requestedAt: isoAt(d(-int(0, 6)), "17:00"),
      status,
      decidedBy: status === "pendente" ? null : pessoa.name,
      decidedAt: status === "pendente" ? null : isoAt(d(-int(0, 3)), "18:00"),
      approvedAt: status === "aprovado" ? isoAt(d(-int(0, 2)), "09:00") : null,
      approvedBy: status === "aprovado" ? "Gestor" : null,
      bookingId: null,
    });
  });
  return out;
}

function buildDeadlineRequests(studies, timepoints) {
  const out = [];
  const candidatas = shuffle(timepoints.filter((tp) => tp.dateMax >= d(-20) && tp.offsetDays > 0)).slice(0, 6);
  candidatas.forEach((tp, i) => {
    const study = studies.find((s) => s.id === tp.studyId);
    const status = ["pendente", "pendente", "pendente", "aprovado", "recusado", "aprovado"][i];
    out.push({
      id: id("dlr"), scope: "timepoint",
      studyId: study.id, timepointId: tp.id, timepointLabel: tp.label, studyName: study.name,
      requestedBy: pick(["Agendador", "Camila Rocha", "Patrícia Lima"]),
      currentDateMax: tp.dateMax, requestedDateMax: E.addDays(tp.dateMax, int(3, 12)),
      reason: pick(["voluntária remarcou", "sala em manutenção na janela", "aguardando liberação do patrocinador", "equipamento em calibração externa"]),
      status,
      requestedAt: isoAt(d(-int(1, 15)), "11:00"),
      decidedBy: status === "pendente" ? null : "Gestor",
      decidedAt: status === "pendente" ? null : isoAt(d(-int(0, 5)), "14:00"),
    });
  });
  return out;
}

function buildStock(cat) {
  const entries = [];
  cat.supplies.forEach((s) => {
    for (let i = 0; i < int(3, 8); i++) {
      const qty = int(2, 12) * 25;
      entries.push({
        id: id("stk"), supplyId: s.id, supplyName: s.name, qty,
        note: pick(["compra mensal", "reposição emergencial", "transferência da unidade 739", "sobra de estudo encerrado", ""]),
        enteredBy: pick(["Gestor", "Rodrigo Assis", "Administrador"]),
        enteredAt: isoAt(d(-int(1, 60)), "10:00"),
      });
    }
  });
  entries.sort((a, b) => (a.enteredAt < b.enteredAt ? 1 : -1));

  /* Estoque coerente com o que foi consumido. O número no cadastro é o que
   * está na prateleira HOJE, e o app já mostra o comprometido e o previsto
   * por cima disso — se a quantidade não descer com o consumo, as três
   * camadas contam a mesma história e a tela perde o sentido.
   *
   * As luvas ficam ABAIXO do mínimo de propósito: é o alerta do Painel. */
  cat.supplies.forEach((s) => {
    const entrou = entries.filter((e) => e.supplyId === s.id).reduce((t, e) => t + e.qty, 0);
    s.quantity = Math.max(0, s.quantity + entrou - int(Math.floor(entrou * 0.5), Math.floor(entrou * 0.9)));
  });
  const luvas = cat.supplies.find((s) => s.name.includes("Luvas"));
  if (luvas) luvas.quantity = Math.max(0, Math.floor(luvas.minThreshold * 0.45));
  const gaze = cat.supplies.find((s) => s.name.includes("Gaze"));
  if (gaze) gaze.quantity = Math.floor(gaze.minThreshold * 1.15); // perto do limite, ainda não vermelho

  return entries;
}

/* Cancelamentos: reservas que existiram e foram desmarcadas. A tela de
 * Indicadores mede PERDA a partir daqui — sem histórico de cancelamento ela
 * fica com um zero que não quer dizer nada. */
function buildCancellations(cat, bookings) {
  const passadas = bookings.filter((b) => b.date < T0 && b.bookingType !== "estimate" && b.kind !== "treinamento");
  const escolhidas = shuffle(passadas).slice(0, Math.max(8, Math.floor(passadas.length * 0.07)));
  const removidos = new Set(escolhidas.map((b) => b.id));
  const data = { ...cat };
  const out = escolhidas.map((b) => ({
    id: id("cxl"), bookingId: b.id, studyId: b.studyId, studyName: b.studyName,
    timepointId: b.timepointId, activityId: b.activityId,
    activityName: cat.activities.find((a) => a.id === b.activityId)?.name || "—",
    locationId: b.locationId, locationName: cat.locations.find((l) => l.id === b.locationId)?.name || "—",
    sponsorId: b.sponsorId, date: b.date, start: b.start, end: b.end,
    cost: E.bookingCost(b, data),
    cancelledAt: isoAt(E.addDays(b.date, -int(0, 3)), "16:00"),
    cancelledBy: pick(["Agendador", "Gestor", "Camila Rocha"]),
    kind: chance(0.45) ? "reagendado" : "cancelado",
  }));
  out.sort((a, b) => (a.cancelledAt < b.cancelledAt ? 1 : -1));
  return { cancellations: out, removidos };
}

/* Auditoria. O Histórico é uma tela inteira que nasce vazia sem isto. */
function buildAudit(cat) {
  const entidades = ["bookings", "studies", "timepoints", "estimates", "supplies", "collaborators", "trainingRequests", "overtimeRequests", "locations", "equipment", "stockEntries", "deadlineRequests"];
  const atores = ["Administrador", "Gestor", "Agendador", "Equipe de Treinamento", ...cat.collaborators.slice(0, 6).map((c) => c.name)];
  const out = [];
  for (let i = 0; i < 320; i++) {
    const dia = d(-int(0, 62));
    out.push({
      id: id("log"),
      ts: isoAt(dia, `${String(int(8, 17)).padStart(2, "0")}:${String(int(0, 59)).padStart(2, "0")}`),
      actor: pick(atores),
      action: pick(["criado", "atualizado", "atualizado", "atualizado", "excluído"]),
      entity: pick(entidades),
    });
  }
  out.sort((a, b) => (a.ts < b.ts ? 1 : -1));
  return out.slice(0, 300);
}

/* ---------------------------------------------------------------------- */
/* 7. Verificação                                                           */
/*                                                                          */
/* Antes de gravar, o pacote inteiro passa pela MESMA validação que a tela   */
/* aplica. Um gerador que grava sem conferir é pior que nenhum: a falha só   */
/* apareceria na frente da plateia.                                          */
/* ---------------------------------------------------------------------- */
function verificar(cat, bookings, estimates) {
  const data = { ...cat };
  const problemas = [];
  const porData = new Map();
  bookings.forEach((b) => {
    if (!porData.has(b.date)) porData.set(b.date, []);
    porData.get(b.date).push(b);
  });

  bookings.forEach((b) => {
    if (b.kind === "treinamento") return; // aula tem forma própria, sem método obrigatório
    /* Pré-reserva já vencida não passa pela checagem de horário — e não é
     * indulgência: `bookingOccupies` a considera solta, então ela não tira o
     * horário de ninguém, e o servidor (a regra que vale) também a deixa
     * passar sem comparar nada. Ela SOBREPOR uma reserva real é o dado, não o
     * defeito: é assim que se mede horário liberado e revendido. Só a
     * integridade do vínculo com a estimativa continua sendo cobrada, logo
     * abaixo. */
    if (!E.bookingOccupies(b)) return;
    const v = E.validateBooking(b, data, porData.get(b.date) || [], b.id);
    // `blockers` são objetos (recurso + quem segura), não texto — cada um já
    // tem a mensagem correspondente em `errors`, então basta contar os erros.
    (v.errors || []).forEach((m) => problemas.push(`${b.studyName || b.id} ${b.date} ${b.start}: ${m}`));
  });

  // Integridade referencial: reserva apontando pra cadastro que não existe é
  // exatamente o defeito que já derrubou este sistema uma vez.
  const ids = {
    locations: new Set(cat.locations.map((x) => x.id)),
    activities: new Set(cat.activities.map((x) => x.id)),
    equipment: new Set(cat.equipment.map((x) => x.id)),
    collaborators: new Set(cat.collaborators.map((x) => x.id)),
    doctors: new Set(cat.doctors.map((x) => x.id)),
  };
  bookings.forEach((b) => {
    if (b.locationId && !ids.locations.has(b.locationId)) problemas.push(`${b.id}: sala inexistente`);
    if (b.activityId && !ids.activities.has(b.activityId)) problemas.push(`${b.id}: método inexistente`);
    if (b.equipmentId && !ids.equipment.has(b.equipmentId)) problemas.push(`${b.id}: equipamento inexistente`);
    (b.collaboratorIds || []).forEach((c) => { if (!ids.collaborators.has(c)) problemas.push(`${b.id}: colaborador inexistente`); });
    if (b.doctorId && !ids.doctors.has(b.doctorId)) problemas.push(`${b.id}: médico inexistente`);
  });
  bookings.forEach((b) => {
    if (b.bookingType === "estimate" && !estimates.some((e) => e.id === b.estimateId)) problemas.push(`${b.id}: ocupação de estimativa órfã`);
  });

  return problemas;
}

/* ---------------------------------------------------------------------- */
/* 8. Gravação                                                              */
/* ---------------------------------------------------------------------- */
function gravar(dbPath, colecoes) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS entities (
      collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (collection, id));
    CREATE TABLE IF NOT EXISTS collections (
      collection TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0);
  `);
  const upsert = db.prepare(`INSERT INTO entities (collection, id, json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`);
  const bump = db.prepare(`INSERT INTO collections (collection, version) VALUES (?, 1)
    ON CONFLICT (collection) DO UPDATE SET version = version + 1`);
  const wipe = db.prepare("DELETE FROM entities WHERE collection = ?");
  const now = new Date().toISOString();

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [collection, valor] of Object.entries(colecoes)) {
      wipe.run(collection);
      // Coleção que não é lista (a matriz de permissões) vai embrulhada no
      // registro `__singleton` — é o formato que o adaptador do cliente lê.
      const itens = Array.isArray(valor) ? valor : [{ id: "__singleton", value: valor }];
      itens.forEach((it, i) => upsert.run(collection, it.id != null ? String(it.id) : `__idx_${i}`, JSON.stringify(it), now));
      bump.run(collection);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
}

/* ---------------------------------------------------------------------- */
/* Execução                                                                 */
/* ---------------------------------------------------------------------- */
/* Base limpa: cadastro em pé, movimento zerado.
 *
 * As coleções de movimento são gravadas VAZIAS de propósito, e a sentinela
 * `crb2-seed` entra junto. Sem ela, o app olharia uma base sem estudos e sem
 * reservas, concluiria que nunca foi semeada, e criaria o pacote de exemplo
 * inteiro por cima na primeira vez que alguém abrisse — o teste começaria
 * com seis reservas que ninguém pediu. Coleção vazia com a sentinela é o que
 * diz "está vazia porque alguém quis". */
function gerarBaseLimpa() {
  log(`Gerando base LIMPA — hoje é ${T0}.`);
  const cat = buildCatalog({ enxuto: true });

  gravar(DB_PATH, {
    "crb2-seed": [{ id: "__base", at: new Date().toISOString() }],
    // Cadastro — fica de pé
    "crb2-niches": cat.niches,
    "crb2-sponsors": cat.sponsors,
    "crb2-locations": cat.locations,
    "crb2-supplies": cat.supplies,
    "crb2-activities": cat.activities,
    "crb2-equipment": cat.equipment,
    "crb2-doctors": cat.doctors,
    "crb2-collaborators": cat.collaborators,
    "crb2-users": cat.users,
    "crb2-calendar": cat.calendar, // só os feriados nacionais
    "crb2-training-types": cat.trainingTypes,
    "crb2-role-capabilities": E.DEFAULT_ROLE_CAPABILITIES,
    // Movimento — vazio
    "crb2-studies": [],
    "crb2-timepoints": [],
    "crb2-bookings": [],
    "crb2-estimates": [],
    "crb2-training-requests": [],
    "crb2-overtime-requests": [],
    "crb2-deadline-requests": [],
    "crb2-cancellations": [],
    "crb2-stock-entries": [],
    "crb2-audit-log": [],
  });

  const contas = cat.users.filter((u) => !u.resourceId);
  log(`
Banco limpo gravado em ${DB_PATH}

  CADASTRO (de pé, pronto pra usar)
    ${cat.locations.length} salas · ${cat.activities.length} métodos · ${cat.equipment.length} equipamentos
    ${cat.sponsors.length} patrocinadores · ${cat.supplies.length} insumos · ${cat.calendar.length} feriados
    ${cat.trainingTypes.length} tipos de treinamento

  EQUIPE
    ${cat.collaborators.length} colaboradores: ${cat.collaborators.map((c) => c.name).join(", ")}
    ${cat.doctors.length} médicos: ${cat.doctors.map((c) => c.name).join(", ")}
    Todos habilitados em todos os métodos — pra nada travar por falta de treinamento.

  LOGINS (${cat.users.length} contas)
    ${contas.map((u) => u.name).join("  ·  ")}
    Cada colaborador e cada médico também entra pelo próprio nome.
    TODAS as contas usam o mesmo PIN: ${PIN_DEMO}

  MOVIMENTO
    Zero estudos, reservas, estimativas, treinamentos, horas extras e histórico.

Suba o servidor com:  node server.js`);
}

function main() {
  if (fs.existsSync(DB_PATH) && !FORCE) {
    console.error(`Já existe um banco em ${DB_PATH}.`);
    console.error("Rode com --force pra apagar e gerar de novo, ou --db <arquivo> pra gravar em outro lugar.");
    process.exit(1);
  }
  if (FORCE) [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`].forEach((f) => { if (fs.existsSync(f)) fs.unlinkSync(f); });

  if (VAZIO) return gerarBaseLimpa();

  log(`Gerando demonstração — hoje é ${T0}, janela de ${WINDOW_START} a ${WINDOW_END} (semente ${SEED}).`);

  const cat = buildCatalog();
  cat.calendar = [...cat.calendar, ...buildAbsences(cat)];

  const studies = buildStudies(cat);
  const timepoints = buildTimepoints(studies);
  const { bookings, porDia, desvios, data } = buildBookings(cat, studies, timepoints);

  const { estimates, previstas } = buildEstimates(cat, data, porDia, studies);
  bookings.push(...previstas);

  const { requests: trainingRequests, aulas } = buildTrainings(cat, data, porDia, studies);
  bookings.push(...aulas);

  // Depois de tudo: precisa das reservas reais já no lugar pra espelhar.
  bookings.push(...buildReleasedHolds(cat, estimates, bookings));

  const { concluidas, emAndamento } = aplicarExecucao(bookings);
  const { cancellations, removidos } = buildCancellations(cat, bookings);
  const finais = bookings.filter((b) => !removidos.has(b.id));

  const overtimeRequests = buildOvertime(cat, studies);
  const deadlineRequests = buildDeadlineRequests(studies, timepoints);
  const stockEntries = buildStock(cat);
  const auditLog = buildAudit(cat);

  // `_protocolo` é andaime do gerador, não campo do modelo.
  const studiesLimpos = studies.map(({ _protocolo, ...s }) => ({ ...s, participantsPlanned: totalDosGrupos(s) }));

  const problemas = verificar(cat, finais, estimates);
  if (problemas.length) {
    console.error(`\n${problemas.length} problema(s) na validação — nada foi gravado:`);
    problemas.slice(0, 15).forEach((p) => console.error("  · " + p));
    if (problemas.length > 15) console.error(`  ... e mais ${problemas.length - 15}`);
    process.exit(1);
  }

  gravar(DB_PATH, {
    // A sentinela impede o app de semear o pacote de exemplo por cima disto.
    "crb2-seed": [{ id: "__base", at: new Date().toISOString() }],
    "crb2-niches": cat.niches,
    "crb2-sponsors": cat.sponsors,
    "crb2-locations": cat.locations,
    "crb2-supplies": cat.supplies,
    "crb2-activities": cat.activities,
    "crb2-equipment": cat.equipment,
    "crb2-doctors": cat.doctors,
    "crb2-collaborators": cat.collaborators,
    "crb2-users": cat.users,
    "crb2-calendar": cat.calendar,
    "crb2-training-types": cat.trainingTypes,
    "crb2-studies": studiesLimpos,
    "crb2-timepoints": timepoints,
    "crb2-bookings": finais,
    "crb2-estimates": estimates,
    "crb2-training-requests": trainingRequests,
    "crb2-overtime-requests": overtimeRequests,
    "crb2-deadline-requests": deadlineRequests,
    "crb2-cancellations": cancellations,
    "crb2-stock-entries": stockEntries,
    "crb2-audit-log": auditLog,
    "crb2-role-capabilities": E.DEFAULT_ROLE_CAPABILITIES,
  });

  const diasComAgenda = new Set(finais.map((b) => b.date)).size;
  log(`
Banco gravado em ${DB_PATH}

  ${cat.locations.length} salas · ${cat.activities.length} métodos · ${cat.equipment.length} equipamentos
  ${cat.collaborators.length} colaboradores · ${cat.doctors.length} médicos · ${cat.users.length} usuários de login
  ${studiesLimpos.length} estudos · ${timepoints.length} visitas de protocolo
  ${studiesLimpos.reduce((t, x) => t + (x.groups || []).length, 0)} grupos de participantes · ${cat.trainingTypes.length} tipos de treinamento
  ${finais.length} reservas em ${diasComAgenda} dias (${(finais.length / diasComAgenda).toFixed(1)} por dia)
    ${concluidas} já concluídas · ${emAndamento} em andamento agora
  ${estimates.length} estimativas · ${trainingRequests.length} treinamentos · ${overtimeRequests.length} horas extras
  ${cancellations.length} cancelamentos · ${stockEntries.length} entradas de estoque · ${auditLog.length} registros de auditoria
  ${desvios.length} visitas fora da tolerância do protocolo, de propósito

Suba o servidor com:  node server.js`);
}

main();
