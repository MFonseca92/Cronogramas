/* =======================================================================
   Conferência da demonstração — o que cada tela vai mostrar
   =======================================================================

   Lê o banco e roda os MESMOS cálculos das telas (capacidade, custo, funil,
   estoque em três camadas, calibração, desvio de protocolo). Serve pra duas
   coisas:

     · antes da apresentação, confirmar que nenhuma tela vai abrir vazia —
       sem precisar clicar em doze abas pra descobrir;
     · na apresentação, saber de antemão quais são os números que vão
       aparecer, pra não ser surpreendido por eles na frente da plateia.

   Rodar:  node demo-check.js            (lê data.db)
           node demo-check.js --db x.db
   ======================================================================= */
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { loadEngine } = require("./engine-harness");

const argv = process.argv.slice(2);
const i = argv.indexOf("--db");
const DB_PATH = path.resolve(i >= 0 && argv[i + 1] ? argv[i + 1] : path.join(__dirname, "data.db"));
if (!fs.existsSync(DB_PATH)) {
  console.error(`Não achei ${DB_PATH}. Rode primeiro:  node demo-seed.js`);
  process.exit(1);
}

const E = loadEngine({ htmlPath: path.join(__dirname, "Cronogramas_v2.html") });
const db = new DatabaseSync(DB_PATH);
const read = (col) => {
  const rows = db.prepare("SELECT json FROM entities WHERE collection = ? ORDER BY id").all(col).map((r) => JSON.parse(r.json));
  return rows.length === 1 && rows[0]?.id === "__singleton" ? rows[0].value : rows;
};

const data = {
  niches: read("crb2-niches"), sponsors: read("crb2-sponsors"), locations: read("crb2-locations"),
  supplies: read("crb2-supplies"), activities: read("crb2-activities"), equipment: read("crb2-equipment"),
  doctors: read("crb2-doctors"), collaborators: read("crb2-collaborators"), calendar: read("crb2-calendar"),
};
const bookings = read("crb2-bookings");
const studies = read("crb2-studies");
const timepoints = read("crb2-timepoints");
const estimates = read("crb2-estimates");
const trainings = read("crb2-training-requests");
const overtime = read("crb2-overtime-requests");
const deadlines = read("crb2-deadline-requests");
const cancellations = read("crb2-cancellations");
const stockEntries = read("crb2-stock-entries");
const auditLog = read("crb2-audit-log");
const users = read("crb2-users");

const T0 = E.todayStr();
const brl = (n) => `R$ ${Math.round(n).toLocaleString("pt-BR")}`;
const linha = (t) => console.log(`\n\x1b[1m${t}\x1b[0m`);
const item = (rotulo, valor) => console.log(`  ${String(rotulo).padEnd(42, ".")} ${valor}`);

console.log(`\nConferência de ${path.basename(DB_PATH)} — hoje é ${T0}`);

/* Base limpa (`demo-seed.js --vazio`): cadastro de pé, movimento zerado. Não
 * há o que conferir, e as "telas vazias" aqui são o pedido, não o defeito —
 * então isto sai cedo em vez de reprovar uma base que está exatamente como
 * deveria. */
if (!bookings.length && !studies.length && !estimates.length) {
  console.log("\n\x1b[1mBase limpa — sem movimento\x1b[0m");
  item("salas / métodos / equipamentos", `${data.locations.length} / ${data.activities.length} / ${data.equipment.length}`);
  item("colaboradores / médicos", `${data.collaborators.length} / ${data.doctors.length}`);
  item("contas de login", users.length);
  item("patrocinadores / insumos / feriados", `${data.sponsors.length} / ${data.supplies.length} / ${data.calendar.length}`);
  console.log("\n\x1b[32mCadastro de pé e movimento zerado, como pedido. Nada a conferir.\x1b[0m");
  db.close();
  process.exit(0);
}

/* --- Painel ----------------------------------------------------------- */
linha("Painel");
const hoje = bookings.filter((b) => b.date === T0);
const semana = bookings.filter((b) => b.date >= T0 && b.date < E.addDays(T0, 7));
item("reservas hoje", hoje.length);
item("  concluídas / em andamento / por fazer",
  `${hoje.filter((b) => b.completedAt).length} / ${hoje.filter((b) => b.startedAt && !b.completedAt).length} / ${hoje.filter((b) => !b.startedAt && !b.completedAt).length}`);
item("reservas nos próximos 7 dias", semana.length);
item("estudos ativos", studies.filter((s) => s.status === "ativo").length);
const semAgendamento = timepoints.filter((tp) => {
  const s = studies.find((x) => x.id === tp.studyId);
  return s && s.status === "ativo" && tp.dateMax >= T0 && tp.dateMax <= E.addDays(T0, 14)
    && !bookings.some((b) => b.timepointId === tp.id);
});
item("visitas vencendo em 14 dias sem agendamento", semAgendamento.length);

/* --- Cronograma ------------------------------------------------------- */
linha("Cronograma");
const dias = [...new Set(bookings.map((b) => b.date))].sort();
item("dias com agenda", `${dias.length}  (${dias[0]} a ${dias[dias.length - 1]})`);
item("média de reservas por dia", (bookings.length / dias.length).toFixed(1));
const maisCheio = dias.map((d) => [d, bookings.filter((b) => b.date === d).length]).sort((a, b) => b[1] - a[1])[0];
item("dia mais cheio", `${maisCheio[0]} com ${maisCheio[1]} reservas`);
item("atividades simultâneas (mesma sala, mesma hora)", bookings.filter((b) => b.groupId).length);
const capHoje = data.locations.map((l) => E.dailyCapacityPct(l, bookings, T0, data)).filter((p) => p != null && p > 0);
item("salas com ocupação hoje", `${capHoje.length} de ${data.locations.length}`);
if (capHoje.length) item("  ocupação média das salas em uso", `${Math.round(capHoje.reduce((a, b) => a + b, 0) / capHoje.length)}%`);

/* --- Estudos ---------------------------------------------------------- */
linha("Estudos");
["ativo", "planejamento", "concluido"].forEach((st) => item(`estudos em "${st}"`, studies.filter((s) => s.status === st).length));
let fora = 0;
timepoints.forEach((tp) => {
  const study = studies.find((s) => s.id === tp.studyId);
  const doTp = bookings.filter((b) => b.timepointId === tp.id);
  if (!study || !doTp.length) return;
  // O desvio é por RESERVA (a visita pode ter várias); a visita conta como
  // fora do protocolo se qualquer uma delas estourou a tolerância.
  if (doTp.some((b) => E.protocolDeviation(tp, study.baselineDate, b.date)?.outOfWindow)) fora++;
});
item("visitas FORA da tolerância do protocolo", fora);
item("solicitações de prazo pendentes", deadlines.filter((r) => r.status === "pendente").length);

/* --- Estimativas ------------------------------------------------------ */
linha("Estimativas");
Object.keys(E.ESTIMATE_STATUS_META).forEach((st) => {
  const n = estimates.filter((e) => E.estimateEffectiveStatus(e) === st).length;
  if (n) item(`  ${E.ESTIMATE_STATUS_META[st].label}`, n);
});
const conv = E.conversionStats(estimates);
item("taxa de conversão", conv.taxa == null ? "ainda indefinida" : `${conv.taxa}%  (${conv.convertidas} de ${conv.encerradas} encerradas)`);
item("valor em aberto", brl(conv.valorAberto || 0));
item("valor convertido", brl(conv.valorConvertido || 0));
const segurando = estimates.filter((e) => E.estimateHoldsNow(e));
item("pré-reservas segurando recurso agora", segurando.length);
segurando.forEach((e) => item(`  ${e.name}`, `até ${e.holdUntil}`));

/* --- Treinamentos / Horas extras -------------------------------------- */
linha("Treinamentos e Horas Extras");
Object.keys(E.TRAINING_STATUS_META).forEach((st) => {
  const n = trainings.filter((r) => r.status === st).length;
  if (n) item(`  treinamento ${E.TRAINING_STATUS_META[st].label}`, n);
});
item("treinamentos com prazo VENCIDO ainda pendentes", trainings.filter((r) => r.status === "pendente" && r.deadlineDate < T0).length);
["pendente", "disponivel", "aprovado", "recusado"].forEach((st) => {
  const n = overtime.filter((r) => r.status === st).length;
  if (n) item(`  hora extra "${st}"`, n);
});

/* --- Configurações: calibração e estoque ------------------------------ */
linha("Configurações — calibração e estoque");
const cal = { ok: 0, vencendo: 0, vencido: 0, sem: 0 };
data.equipment.forEach((eq) => {
  const s = E.calibrationStatus(eq, T0);
  if (!s) cal.sem++; else cal[s.status] = (cal[s.status] || 0) + 1;
});
item("equipamentos calibrados / vencendo / VENCIDOS", `${cal.ok || 0} / ${cal.vencendo || 0} / ${cal.vencido || 0}  (${cal.sem} sem controle)`);
data.supplies.forEach((s) => {
  const o = E.supplyOutlook(s, data.activities, bookings, estimates, T0);
  const alerta = s.quantity < s.minThreshold ? "  ← ABAIXO DO MÍNIMO" : o.seTudoAprovado < 0 ? "  ← falta se tudo for aprovado" : "";
  item(`  ${s.name}`, `${s.quantity} ${s.unit} (mín. ${s.minThreshold}) · comprometido ${o.comprometido} · previsto ${o.previsto}${alerta}`);
});

/* --- Calendário ------------------------------------------------------- */
linha("Calendário");
E.ABSENCE_KINDS.forEach((k) => {
  const n = data.calendar.filter((c) => c.kind === k.id).length;
  if (n) item(`  ${k.label}`, n);
});

/* --- Indicadores ------------------------------------------------------ */
linha("Indicadores");
const realizadas = bookings.filter((b) => b.completedAt);
item("custo total das reservas realizadas", brl(E.bookingsCost(realizadas, data)));
item("custo das reservas futuras", brl(E.bookingsCost(bookings.filter((b) => b.date >= T0 && b.bookingType !== "estimate"), data)));
item("cancelamentos / reagendamentos", `${cancellations.filter((c) => c.kind === "cancelado").length} / ${cancellations.filter((c) => c.kind === "reagendado").length}`);
item("valor perdido em cancelamentos", brl(cancellations.filter((c) => c.kind === "cancelado").reduce((t, c) => t + (c.cost || 0), 0)));
const reuso = E.capacityReuse(estimates, bookings, T0);
item("horários liberados por pré-reserva e reaproveitados", `${reuso.reaproveitadas} de ${reuso.liberadas} (${reuso.emAberto} ainda por vir)`);

/* --- Histórico e usuários --------------------------------------------- */
linha("Histórico e acesso");
item("registros de auditoria", auditLog.length);
item("entradas de estoque", stockEntries.length);
item("contas de login", users.length);
["admin", "gestor", "agendador", "treinador", "colaborador", "medico"].forEach((lv) => {
  const n = users.filter((u) => u.level === lv).length;
  if (n) item(`  ${lv}`, n);
});

/* --- Telas que abririam vazias ---------------------------------------- */
const vazias = [];
if (!hoje.length) vazias.push("Painel / Cronograma (nada hoje)");
if (!studies.length) vazias.push("Estudos");
if (!estimates.length) vazias.push("Estimativas");
if (!trainings.length) vazias.push("Treinamentos");
if (!overtime.length) vazias.push("Horas Extras");
if (!auditLog.length) vazias.push("Histórico");
if (!cancellations.length) vazias.push("Indicadores — perdas");
if (!data.calendar.length) vazias.push("Calendário");

console.log("");
if (vazias.length) {
  console.log(`\x1b[33mTelas que vão abrir VAZIAS: ${vazias.join(", ")}\x1b[0m`);
  process.exitCode = 1;
} else {
  console.log("\x1b[32mNenhuma tela abre vazia.\x1b[0m");
}
db.close();
