// Testes do servidor de referência — principalmente o que o localStorage não
// consegue fazer: duas pessoas gravando ao mesmo tempo sem uma apagar a outra.
// Rodar com:  node Cronogramas/server.test.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const assert = require("assert");
const os = require("os");

const PORT = 8199;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `crb-test-${Date.now()}.db`);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e.message || e)); }
}
const api = async (p, opts) => {
  const r = await fetch(BASE + p, opts);
  return { status: r.status, body: r.status === 304 || r.status === 204 ? null : await r.json() };
};
const post = (c, payload) => api(`/api/${c}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), CRB_DB: DB }, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  // Espera o servidor subir.
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  console.log("\nLeitura e escrita básicas");

  await test("coleção vazia começa na versão 0", async () => {
    const r = await api("/api/bookings");
    assert.equal(r.status, 200);
    assert.equal(r.body.version, 0);
    assert.deepEqual(r.body.items, []);
  });

  await test("grava e lê de volta", async () => {
    await post("bookings", { upserts: [{ id: "b1", date: "2026-08-17", start: "09:00" }] });
    const r = await api("/api/bookings");
    assert.equal(r.body.items.length, 1);
    assert.equal(r.body.items[0].start, "09:00");
    assert.ok(r.body.version > 0);
  });

  await test("registro sem id é recusado", async () => {
    const r = await post("bookings", { upserts: [{ date: "2026-08-17" }] });
    assert.equal(r.status, 400);
  });

  await test("apagar remove só o registro pedido", async () => {
    await post("bookings", { upserts: [{ id: "b2" }, { id: "b3" }] });
    await post("bookings", { deletes: ["b2"] });
    const r = await api("/api/bookings");
    assert.deepEqual(r.body.items.map((i) => i.id).sort(), ["b1", "b3"]);
  });

  console.log("\nConcorrência — o problema que o localStorage não resolve");

  await test("duas pessoas gravando registros diferentes não se apagam", async () => {
    await post("studies", { upserts: [{ id: "s0", name: "base" }] });
    // Exatamente o cenário que quebrava: dois clientes que carregaram a mesma
    // lista e salvam ao mesmo tempo, cada um com a sua adição.
    await Promise.all([
      post("studies", { upserts: [{ id: "sA", name: "estudo da Ana" }] }),
      post("studies", { upserts: [{ id: "sB", name: "estudo do Bruno" }] }),
    ]);
    const r = await api("/api/studies");
    const ids = r.body.items.map((i) => i.id).sort();
    assert.deepEqual(ids, ["s0", "sA", "sB"], "nenhuma das duas gravações pode sumir");
  });

  await test("20 clientes gravando ao mesmo tempo não perdem nada", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      post("carga", { upserts: [{ id: "c" + i, n: i }] }));
    await Promise.all(writes);
    const r = await api("/api/carga");
    assert.equal(r.body.items.length, 20);
    assert.equal(r.body.version, 20, "cada escrita precisa subir a versão");
  });

  await test("editar o mesmo registro vale a última (sem corromper)", async () => {
    await post("studies", { upserts: [{ id: "sX", name: "v1" }] });
    await post("studies", { upserts: [{ id: "sX", name: "v2" }] });
    const r = await api("/api/studies");
    const sx = r.body.items.filter((i) => i.id === "sX");
    assert.equal(sx.length, 1, "não pode duplicar o registro");
    assert.equal(sx[0].name, "v2");
  });

  console.log("\nConflito de agenda decidido pelo SERVIDOR");

  const RES = (over = {}) => ({
    id: "r1", date: "2026-08-17", start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00",
    locationId: "sala1", collaboratorIds: ["ana"], doctorId: null, equipmentId: null, accessoryIds: [], ...over,
  });

  await test("primeira reserva entra normalmente", async () => {
    const r = await post("crb2-bookings", { upserts: [RES()] });
    assert.equal(r.status, 200);
  });

  await test("segunda reserva na MESMA sala e horário é recusada", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "r2", collaboratorIds: ["bruno"] })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.conflicts.some((c) => /sala/.test(c)), JSON.stringify(r.body.conflicts));
  });

  await test("mesma PESSOA em duas reservas é recusada", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "r3", locationId: "sala2" })] });
    assert.equal(r.status, 409);
    assert.ok(r.body.conflicts.some((c) => /colaborador/.test(c)));
  });

  await test("mesmo EQUIPAMENTO em duas reservas é recusado", async () => {
    await post("crb2-bookings", { upserts: [RES({ id: "eqbase", locationId: "sala9", collaboratorIds: [], equipmentId: "mpa1" })] });
    const r = await post("crb2-bookings", { upserts: [RES({ id: "eq2", locationId: "sala8", collaboratorIds: [], equipmentId: "mpa1" })] });
    assert.equal(r.status, 409);
    assert.ok(r.body.conflicts.some((c) => /equipamento/.test(c)));
  });

  await test("acessório em comum também conta como conflito", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "eq3", locationId: "sala7", collaboratorIds: [], equipmentId: "mpa2", accessoryIds: ["mpa1"] })] });
    assert.equal(r.status, 409);
  });

  await test("mesmo MÉDICO em duas reservas é recusado", async () => {
    await post("crb2-bookings", { upserts: [RES({ id: "doc1", locationId: "sala6", collaboratorIds: [], doctorId: "dra" })] });
    const r = await post("crb2-bookings", { upserts: [RES({ id: "doc2", locationId: "sala5", collaboratorIds: [], doctorId: "dra" })] });
    assert.equal(r.status, 409);
    assert.ok(r.body.conflicts.some((c) => /médico/.test(c)));
  });

  await test("nada é gravado quando o lote e recusado", async () => {
    const antes = (await api("/api/crb2-bookings")).body;
    await post("crb2-bookings", { upserts: [RES({ id: "naoDeveEntrar", collaboratorIds: ["bruno"] })] });
    const depois = (await api("/api/crb2-bookings")).body;
    assert.equal(depois.version, antes.version, "versão não pode subir num lote recusado");
    assert.ok(!depois.items.some((b) => b.id === "naoDeveEntrar"));
  });

  await test("horário encostado (10:00 depois de 09:00-10:00) passa", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "encostado", start: "10:00", end: "11:00", blockStart: "10:00", blockEnd: "11:00", collaboratorIds: ["ana"] })] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await test("preparo/desmontagem entram na checagem", async () => {
    // Execução 11:00-12:00 não encosta em 10:00-11:00, mas o preparo de 15min
    // faz o bloqueio começar 10:45 e cruzar com a reserva anterior.
    const r = await post("crb2-bookings", { upserts: [RES({ id: "preparo", start: "11:00", end: "12:00", blockStart: "10:45", blockEnd: "12:00", collaboratorIds: ["ana"] })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
  });

  await test("atividades simultâneas do MESMO grupo dividem a sala", async () => {
    const g = [
      RES({ id: "g1", locationId: "salaG", collaboratorIds: ["ana2"], groupId: "grupoA", date: "2026-08-18" }),
      RES({ id: "g2", locationId: "salaG", collaboratorIds: ["bruno2"], groupId: "grupoA", date: "2026-08-18" }),
    ];
    const r = await post("crb2-bookings", { upserts: g });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await test("mas a mesma pessoa nas duas do grupo é recusada", async () => {
    const g = [
      RES({ id: "h1", locationId: "salaH", collaboratorIds: ["carla"], groupId: "grupoB", date: "2026-08-19" }),
      RES({ id: "h2", locationId: "salaH", collaboratorIds: ["carla"], groupId: "grupoB", date: "2026-08-19" }),
    ];
    const r = await post("crb2-bookings", { upserts: g });
    assert.equal(r.status, 409, JSON.stringify(r.body));
  });

  await test("terceiro fora do grupo não pode usar a sala do grupo", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "intruso", locationId: "salaG", collaboratorIds: ["dani"], date: "2026-08-18" })] });
    assert.equal(r.status, 409);
  });

  await test("editar a própria reserva não conflita consigo mesma", async () => {
    const r = await post("crb2-bookings", { upserts: [RES({ id: "r1", end: "09:30", blockEnd: "09:30" })] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await test("duas reservas concorrentes pelo mesmo recurso: só uma entra", async () => {
    // O caso que motivou tudo isto: dois clientes pedindo a mesma sala.
    const a = post("crb2-bookings", { upserts: [RES({ id: "corrida1", locationId: "salaX", collaboratorIds: ["p1"], date: "2026-08-20" })] });
    const b = post("crb2-bookings", { upserts: [RES({ id: "corrida2", locationId: "salaX", collaboratorIds: ["p2"], date: "2026-08-20" })] });
    const [ra, rb] = await Promise.all([a, b]);
    const oks = [ra, rb].filter((r) => r.status === 200).length;
    assert.equal(oks, 1, `esperado exatamente 1 aceita, veio ${oks}`);
    const gravadas = (await api("/api/crb2-bookings")).body.items.filter((x) => x.locationId === "salaX");
    assert.equal(gravadas.length, 1);
  });

  await test("coleção que não é reserva não passa pela regra de agenda", async () => {
    const r = await post("crb2-studies", { upserts: [{ id: "s1", date: "2026-08-17", start: "09:00", end: "10:00", locationId: "sala1" }] });
    assert.equal(r.status, 200);
  });

  console.log("\nTransação: visita + reservas + estoque, tudo ou nada");

  const tx = (changes) => api("/api/tx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) });

  await test("grava várias coleções de uma vez", async () => {
    const r = await tx([
      { collection: "crb2-timepoints", upserts: [{ id: "tpX", label: "D0" }] },
      { collection: "crb2-bookings", upserts: [RES({ id: "txBk", date: "2026-10-05", locationId: "salaTx", collaboratorIds: ["pTx"] })] },
      { collection: "crb2-supplies", upserts: [{ id: "luvas", name: "Luvas", quantity: 100 }] },
    ]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok((await api("/api/crb2-timepoints")).body.items.some((t) => t.id === "tpX"));
  });

  await test("conflito numa reserva desfaz a transação INTEIRA", async () => {
    const tpAntes = (await api("/api/crb2-timepoints")).body.items.length;
    const r = await tx([
      { collection: "crb2-timepoints", upserts: [{ id: "tpNaoDeveEntrar", label: "X" }] },
      { collection: "crb2-bookings", upserts: [RES({ id: "txConflito", date: "2026-10-05", locationId: "salaTx", collaboratorIds: ["outro"] })] },
    ]);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    const depois = (await api("/api/crb2-timepoints")).body.items;
    assert.equal(depois.length, tpAntes, "o timepoint não podia ter entrado");
    assert.ok(!depois.some((t) => t.id === "tpNaoDeveEntrar"));
  });

  console.log("\nEstoque atômico (delta, não quantidade nova)");

  await test("delta desconta a partir do valor atual", async () => {
    await tx([{ collection: "crb2-supplies", deltas: [{ id: "luvas", field: "quantity", delta: -5, min: 0 }] }]);
    const luvas = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvas");
    assert.equal(luvas.quantity, 95);
  });

  await test("dois consumos simultâneos NÃO se perdem (lost update)", async () => {
    // O caso clássico: os dois leem 95 e gravariam 90; com delta tem que dar 85.
    await Promise.all([
      tx([{ collection: "crb2-supplies", deltas: [{ id: "luvas", field: "quantity", delta: -5, min: 0 }] }]),
      tx([{ collection: "crb2-supplies", deltas: [{ id: "luvas", field: "quantity", delta: -5, min: 0 }] }]),
    ]);
    const luvas = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvas");
    assert.equal(luvas.quantity, 85, "os dois consumos precisam ser contados");
  });

  await test("estoque não fica negativo — recusa e desfaz tudo", async () => {
    const r = await tx([
      { collection: "crb2-supplies", deltas: [{ id: "luvas", field: "quantity", delta: -999, min: 0 }] },
      { collection: "crb2-timepoints", upserts: [{ id: "tpEstoque", label: "Y" }] },
    ]);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    const luvas = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvas");
    assert.equal(luvas.quantity, 85, "a quantidade não podia mudar");
    assert.ok(!(await api("/api/crb2-timepoints")).body.items.some((t) => t.id === "tpEstoque"));
  });

  await test("delta em registro inexistente é recusado", async () => {
    const r = await tx([{ collection: "crb2-supplies", deltas: [{ id: "naoExiste", field: "quantity", delta: -1 }] }]);
    assert.equal(r.status, 409);
  });

  await test("transação vazia é rejeitada", async () => {
    const r = await api("/api/tx", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: [] }) });
    assert.equal(r.status, 400);
  });

  console.log("\nVersão e poll barato");

  await test("poll com a versão atual responde 304 sem corpo", async () => {
    const first = await api("/api/bookings");
    const again = await api(`/api/bookings?since=${first.body.version}`);
    assert.equal(again.status, 304);
    assert.equal(again.body, null);
  });

  await test("poll com versão antiga devolve os dados", async () => {
    const before = (await api("/api/bookings")).body.version;
    await post("bookings", { upserts: [{ id: "b9" }] });
    const r = await api(`/api/bookings?since=${before}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.version > before);
  });

  await test("uma requisição devolve a versão de todas as coleções", async () => {
    const r = await api("/api/collections");
    assert.equal(r.status, 200);
    assert.ok(r.body.bookings > 0 && r.body.studies > 0, JSON.stringify(r.body));
  });

  console.log("\nPersistência e robustez");

  await test("dado sobrevive a reiniciar o servidor", async () => {
    child.kill();
    await new Promise((r) => child.on("exit", r));
    const child2 = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: { ...process.env, PORT: String(PORT), CRB_DB: DB }, stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const r = await api("/api/studies");
    assert.ok(r.body.items.some((i) => i.id === "sA"), "os dados precisam continuar lá");
    child2.kill();
    await new Promise((r) => child2.on("exit", r));
  });

  await test("nome de coleção inválido é recusado", async () => {
    const child3 = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: { ...process.env, PORT: String(PORT), CRB_DB: DB }, stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
    }
    const r = await api("/api/..%2Fetc");
    assert.ok(r.status === 400 || r.status === 404, "status " + r.status);
    child3.kill();
    await new Promise((r) => child3.on("exit", r));
  });

  /* ---- Estimativa: o servidor é quem decide o nível de compromisso ------ */
  console.log("\nEstimativa: previsão, pré-reserva e conversão");

  const child4 = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), CRB_DB: DB }, stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  // Dia livre, longe de tudo que os testes acima criaram.
  const DIA = "2026-09-21";
  const EST = (over = {}) => ({
    id: "e1", bookingType: "estimate", estimateId: "est1",
    date: DIA, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00",
    locationId: "salaEst", collaboratorIds: [], doctorId: null, equipmentId: null, accessoryIds: [],
    holdsResources: true, holdUntil: "2099-12-31", ...over,
  });
  const OFICIAL = (over = {}) => ({
    id: "o1", date: DIA, start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00",
    locationId: "salaEst", collaboratorIds: [], doctorId: null, equipmentId: null, accessoryIds: [], ...over,
  });

  await test("ocupação de estimativa sem estimateId é recusada pelo servidor", async () => {
    // Regra de integridade: bloqueio sem dono não teria como ser liberado.
    const r = await post("crb2-bookings", { upserts: [EST({ id: "orfa", estimateId: null })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.conflicts.join(" ").includes("sem estimateId"));
  });

  await test("pré-reserva sem holdUntil é recusada pelo servidor", async () => {
    const r = await post("crb2-bookings", { upserts: [EST({ id: "semPrazo", holdUntil: null })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.conflicts.join(" ").includes("sem holdUntil"));
  });

  await test("reserva oficial não pode carregar estimateId", async () => {
    const r = await post("crb2-bookings", { upserts: [OFICIAL({ id: "misturada", estimateId: "est1" })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
  });

  await test("duas previsões sem bloqueio cabem no mesmo horário", async () => {
    // Previsão é cenário, não compromisso: dois orçamentos podem prever a
    // mesma sala no mesmo dia sem que nenhum dos dois esteja errado.
    const semHold = { holdsResources: false, holdUntil: null };
    const a = await post("crb2-bookings", { upserts: [EST({ id: "prev1", estimateId: "estA", ...semHold })] });
    const b = await post("crb2-bookings", { upserts: [EST({ id: "prev2", estimateId: "estB", ...semHold })] });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assert.equal(b.status, 200, JSON.stringify(b.body));
  });

  await test("previsão não impede a reserva oficial de entrar", async () => {
    const r = await post("crb2-bookings", { upserts: [OFICIAL({ id: "porCima" })] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    // limpa pra não atrapalhar os próximos
    await post("crb2-bookings", { deletes: ["porCima"] });
  });

  await test("pré-reserva válida bloqueia a reserva oficial", async () => {
    const p = await post("crb2-bookings", { upserts: [EST({ id: "hold1", estimateId: "estC" })] });
    assert.equal(p.status, 200, JSON.stringify(p.body));
    const r = await post("crb2-bookings", { upserts: [OFICIAL({ id: "barrada" })] });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.conflicts.join(" ").includes("sala já reservada"));
  });

  await test("pré-reserva VENCIDA deixa a reserva oficial passar", async () => {
    await post("crb2-bookings", { deletes: ["hold1"] });
    const v = await post("crb2-bookings", { upserts: [EST({ id: "vencida", estimateId: "estD", holdUntil: "2020-01-01" })] });
    assert.equal(v.status, 200, JSON.stringify(v.body));
    const r = await post("crb2-bookings", { upserts: [OFICIAL({ id: "passou" })] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    await post("crb2-bookings", { deletes: ["passou", "vencida"] });
  });

  await test("duas estimativas concorrentes na mesma sala: só uma segura", async () => {
    // O cerne do §29: dois orçamentos disputando o mesmo recurso ao mesmo
    // tempo. Quem chegar primeiro leva; o outro tem que ouvir "não".
    await post("crb2-bookings", { deletes: ["prev1", "prev2", "e1"] });
    const disputa = ["dA", "dB", "dC", "dD", "dE"].map((id, i) =>
      post("crb2-bookings", { upserts: [EST({ id, estimateId: "est-" + id, locationId: "salaDisputa", start: "14:00", end: "15:00", blockStart: "14:00", blockEnd: "15:00" })] }));
    const rs = await Promise.all(disputa);
    const ok = rs.filter((r) => r.status === 200).length;
    assert.equal(ok, 1, `só uma podia entrar, entraram ${ok}`);
  });

  await test("estimativa e reserva oficial disputando ao mesmo tempo: só uma entra", async () => {
    const [a, b] = await Promise.all([
      post("crb2-bookings", { upserts: [EST({ id: "corridaEst", estimateId: "estRace", locationId: "salaRace", start: "16:00", end: "17:00", blockStart: "16:00", blockEnd: "17:00" })] }),
      post("crb2-bookings", { upserts: [OFICIAL({ id: "corridaOfi", locationId: "salaRace", start: "16:00", end: "17:00", blockStart: "16:00", blockEnd: "17:00" })] }),
    ]);
    const ok = [a, b].filter((r) => r.status === 200).length;
    assert.equal(ok, 1, `só uma podia entrar, entraram ${ok}`);
  });

  await test("estimativa NÃO baixa estoque; a conversão baixa", async () => {
    await post("crb2-supplies", { upserts: [{ id: "luva", name: "Luvas", quantity: 100 }] });
    // A estimativa entra sozinha, sem delta nenhum.
    const est = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [{ collection: "crb2-bookings", upserts: [EST({ id: "estEstoque", estimateId: "estS", locationId: "salaEstoque", start: "08:00", end: "09:00", blockStart: "08:00", blockEnd: "09:00" })] }] }),
    });
    assert.equal(est.status, 200, JSON.stringify(est.body));
    let q = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luva").quantity;
    assert.equal(q, 100, "estimativa não pode mexer no estoque físico");

    // Converter: vira reserva oficial E consome, na mesma transação.
    const conv = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [
        { collection: "crb2-bookings", upserts: [{ ...EST({ id: "estEstoque", locationId: "salaEstoque", start: "08:00", end: "09:00", blockStart: "08:00", blockEnd: "09:00" }), bookingType: "reservation", estimateId: null, holdsResources: false, holdUntil: null }] },
        { collection: "crb2-supplies", deltas: [{ id: "luva", field: "quantity", delta: -5, min: 0 }] },
      ] }),
    });
    assert.equal(conv.status, 200, JSON.stringify(conv.body));
    q = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luva").quantity;
    assert.equal(q, 95);
  });

  await test("conflito no meio da conversão desfaz a transação inteira", async () => {
    // Uma reserva oficial ocupa a sala; a conversão tenta entrar em cima.
    await post("crb2-bookings", { upserts: [OFICIAL({ id: "jaEstava", locationId: "salaRollback", start: "11:00", end: "12:00", blockStart: "11:00", blockEnd: "12:00" })] });
    const antes = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luva").quantity;
    const r = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [
        { collection: "crb2-studies", upserts: [{ id: "estudoQueNaoDeveNascer", name: "Convertido" }] },
        { collection: "crb2-bookings", upserts: [OFICIAL({ id: "conflitante", locationId: "salaRollback", start: "11:00", end: "12:00", blockStart: "11:00", blockEnd: "12:00" })] },
        { collection: "crb2-supplies", deltas: [{ id: "luva", field: "quantity", delta: -10, min: 0 }] },
      ] }),
    });
    assert.equal(r.status, 409, JSON.stringify(r.body));
    const estudos = (await api("/api/crb2-studies")).body.items;
    assert.ok(!estudos.some((s) => s.id === "estudoQueNaoDeveNascer"), "o estudo não podia nascer");
    const depois = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luva").quantity;
    assert.equal(depois, antes, "o estoque não podia ser tocado");
  });

  await test("os campos novos sobrevivem à gravação", async () => {
    const b = (await api("/api/crb2-bookings")).body.items.find((x) => x.id === "corridaEst" || x.id === "dA" || x.id === "vencida");
    if (b) {
      assert.equal(b.bookingType, "estimate");
      assert.ok(b.estimateId, "estimateId precisa voltar");
      assert.equal(typeof b.holdsResources, "boolean");
    }
  });

  /* ---- Conversão concorrente ------------------------------------------- */
  /* O Fonseca reproduziu isso: duas conversões simultâneas da mesma
   * estimativa passavam as duas, criando dois estudos (um órfão) e
   * descontando o estoque em dobro. A checagem "já foi convertida?" rodava
   * no cliente, contra cópias que ainda diziam que não. */
  console.log("\nConversão concorrente da mesma estimativa");

  const conversao = (n, estId) => api("/api/tx", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes: [
      { collection: "crb2-studies", upserts: [{ id: `estudo-${n}`, name: `Convertido ${n}`, fromEstimateId: estId }] },
      { collection: "crb2-estimates",
        upserts: [{ id: estId, name: "Oportunidade", status: "convertida", convertedStudyId: `estudo-${n}` }],
        // A pré-condição: só converte se ainda NÃO tiver sido convertida.
        expects: [{ id: estId, field: "convertedStudyId", equals: null }] },
      { collection: "crb2-supplies", deltas: [{ id: "luvaConv", field: "quantity", delta: -2, min: 0 }] },
    ] }),
  });

  await test("duas conversões simultâneas: só uma entra", async () => {
    await post("crb2-supplies", { upserts: [{ id: "luvaConv", name: "Luvas", quantity: 10 }] });
    await post("crb2-estimates", { upserts: [{ id: "estConc", name: "Oportunidade", status: "aberta", convertedStudyId: null }] });

    const rs = await Promise.all([1, 2, 3, 4, 5].map((n) => conversao(n, "estConc")));
    const ok = rs.filter((r) => r.status === 200).length;
    assert.equal(ok, 1, `só uma conversão podia entrar, entraram ${ok}`);

    // E o efeito colateral que doía: estoque descontado uma vez só.
    const q = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvaConv").quantity;
    assert.equal(q, 8, `estoque devia ir de 10 pra 8, foi pra ${q}`);

    // Nenhum estudo órfão: só existe o da conversão que venceu.
    const est = (await api("/api/crb2-estimates")).body.items.find((e) => e.id === "estConc");
    const estudos = (await api("/api/crb2-studies")).body.items.filter((s) => s.fromEstimateId === "estConc");
    assert.equal(estudos.length, 1, `nasceram ${estudos.length} estudos`);
    assert.equal(estudos[0].id, est.convertedStudyId, "a estimativa tem que apontar pro estudo que existe");
  });

  await test("a segunda tentativa diz o motivo, não um erro genérico", async () => {
    const r = await conversao(9, "estConc");
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.ok(r.body.conflicts.join(" ").includes("convertedStudyId"), r.body.conflicts.join("; "));
  });

  await test("pré-condição sobre registro inexistente é recusada", async () => {
    const r = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [
        { collection: "crb2-estimates", upserts: [{ id: "x1", name: "X" }],
          expects: [{ id: "naoExiste", field: "convertedStudyId", equals: null }] },
      ] }),
    });
    assert.equal(r.status, 409);
    assert.ok(r.body.conflicts.join(" ").includes("não existe"));
  });

  await test("pré-condição satisfeita deixa passar", async () => {
    await post("crb2-estimates", { upserts: [{ id: "estOk", name: "Y", status: "aberta", convertedStudyId: null }] });
    const r = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [
        { collection: "crb2-estimates", upserts: [{ id: "estOk", name: "Y", status: "cancelada", convertedStudyId: null }],
          expects: [{ id: "estOk", field: "convertedStudyId", equals: null }] },
      ] }),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await test("undefined e null são a mesma coisa na pré-condição", async () => {
    // Registro salvo sem o campo: "ainda não foi convertida" continua sendo
    // verdade, e o cliente pode mandar null.
    await post("crb2-estimates", { upserts: [{ id: "estSemCampo", name: "Z", status: "aberta" }] });
    const r = await api("/api/tx", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ changes: [
        { collection: "crb2-estimates", upserts: [{ id: "estSemCampo", name: "Z", convertedStudyId: "s1" }],
          expects: [{ id: "estSemCampo", field: "convertedStudyId", equals: null }] },
      ] }),
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  });

  await test("nada é gravado quando a pré-condição falha", async () => {
    const antes = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvaConv").quantity;
    const r = await conversao(77, "estConc");
    assert.equal(r.status, 409);
    const depois = (await api("/api/crb2-supplies")).body.items.find((s) => s.id === "luvaConv").quantity;
    assert.equal(depois, antes, "o estoque não podia ser tocado");
    const estudos = (await api("/api/crb2-studies")).body.items.filter((s) => s.id === "estudo-77");
    assert.equal(estudos.length, 0, "o estudo não podia nascer");
  });

  /* ---- Semeadura do pacote ---------------------------------------------- */
  /* Estudos, visitas e reservas são um pacote: cada um aponta pros ids dos
   * outros. Em três gravações separadas, dois clientes numa base vazia
   * ficavam com gerações misturadas — e as reservas apontavam pra salas que
   * não existiam. */
  console.log("\nSemeadura do pacote de exemplo");

  const semear = (g) => api("/api/tx", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes: [
      { collection: "crb2-seed", upserts: [{ id: "__pacote", geracao: g }],
        expects: [{ id: "__pacote", absent: true, message: "outro cliente já semeou" }] },
      { collection: "crb2-seed-studies", upserts: [{ id: `s-${g}`, geracao: g }] },
      { collection: "crb2-seed-timepoints", upserts: [{ id: `t-${g}`, studyId: `s-${g}`, geracao: g }] },
      { collection: "crb2-seed-bookings", upserts: [{ id: `b-${g}`, timepointId: `t-${g}`, geracao: g }] },
    ] }),
  });

  await test("cinco clientes semeando a base vazia: só um pacote entra", async () => {
    const rs = await Promise.all(["A", "B", "C", "D", "E"].map(semear));
    const ok = rs.filter((r) => r.status === 200).length;
    assert.equal(ok, 1, `só um podia semear, semearam ${ok}`);
  });

  await test("as três coleções ficam da MESMA geração", async () => {
    const [st, tp, bk] = await Promise.all(
      ["crb2-seed-studies", "crb2-seed-timepoints", "crb2-seed-bookings"].map((c) => api("/api/" + c))
    );
    assert.equal(st.body.items.length, 1, "não pode ter estudo de duas gerações");
    assert.equal(tp.body.items.length, 1);
    assert.equal(bk.body.items.length, 1);
    const g = st.body.items[0].geracao;
    assert.equal(tp.body.items[0].geracao, g, "visita de outra geração");
    assert.equal(bk.body.items[0].geracao, g, "reserva de outra geração");
    // E as referências se cruzam de verdade.
    assert.equal(tp.body.items[0].studyId, st.body.items[0].id);
    assert.equal(bk.body.items[0].timepointId, tp.body.items[0].id);
  });

  await test("quem perdeu a corrida recebe o motivo", async () => {
    const r = await semear("Z");
    assert.equal(r.status, 409);
    assert.ok(r.body.conflicts.join(" ").includes("já semeou"), r.body.conflicts.join("; "));
  });

  /* ---- Backup com WAL --------------------------------------------------- */
  /* Copiar `data.db` à mão gera backup vazio: em modo WAL as gravações
   * recentes moram no `-wal`. */
  console.log("\nBackup consistente com WAL");

  await test("POST /api/backup gera um arquivo único e completo", async () => {
    const r = await api("/api/backup", { method: "POST" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const destino = r.body.path;
    assert.ok(fs.existsSync(destino), "o arquivo tinha que existir");
    assert.ok(r.body.bytes > 4096, `backup de ${r.body.bytes} bytes é pequeno demais pra ter dados`);

    // Abre o backup como banco independente e confere que os dados estão lá.
    const { DatabaseSync } = require("node:sqlite");
    const copia = new DatabaseSync(destino, { readOnly: true });
    const n = copia.prepare("SELECT COUNT(*) c FROM entities").get().c;
    const temEstimativa = copia.prepare("SELECT COUNT(*) c FROM entities WHERE collection = ? AND id = ?")
      .get("crb2-estimates", "estConc").c;
    const integridade = copia.prepare("PRAGMA integrity_check").get();
    copia.close();
    assert.ok(n > 0, "o backup veio sem nenhum registro");
    assert.equal(temEstimativa, 1, "o backup não tem o que foi gravado agora — o WAL ficou de fora");
    assert.equal(Object.values(integridade)[0], "ok");
    fs.unlinkSync(destino);
  });

  await test("a rota NÃO aceita caminho do cliente", async () => {
    // Um endpoint sem autenticação que grava onde o corpo mandar escreve em
    // qualquer lugar que o processo alcance.
    const tentativa = path.join(os.tmpdir(), `crb-invasao-${Date.now()}.db`);
    const r = await api("/api/backup", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: tentativa }),
    });
    assert.equal(r.status, 200, "a rota funciona, só ignora o caminho pedido");
    assert.ok(!fs.existsSync(tentativa), "não podia ter gravado onde o cliente mandou");
    assert.ok(r.body.path.includes("backups"), `gravou em ${r.body.path}`);
    fs.unlinkSync(r.body.path);
  });

  await test("o banco não é baixável pelo servidor estático", async () => {
    // Sem isso, um GET /data.db entrega a base inteira sem credencial.
    for (const alvo of ["/data.db", "/data.db-wal", "/data.db-shm"]) {
      const r = await api(alvo);
      assert.equal(r.status, 403, `${alvo} respondeu ${r.status}`);
    }
  });

  await test("backup recusa sobrescrever arquivo existente", async () => {
    // O CLI aceita caminho livre; a garantia de não apagar continua valendo.
    const destino = path.join(os.tmpdir(), `crb-bkp-ja-existe-${Date.now()}.db`);
    fs.writeFileSync(destino, "backup de ontem");
    const { execFileSync } = require("child_process");
    let falhou = false;
    try {
      execFileSync(process.execPath, [path.join(__dirname, "server.js"), "--backup", destino],
        { env: { ...process.env, CRB_DB: DB }, stdio: "pipe" });
    } catch { falhou = true; }
    assert.ok(falhou, "não pode apagar o backup anterior em silêncio");
    assert.equal(fs.readFileSync(destino, "utf8"), "backup de ontem");
    fs.unlinkSync(destino);
  });

  child4.kill();
  await new Promise((r) => child4.on("exit", r));

  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed ? 1 : 0);
})();
