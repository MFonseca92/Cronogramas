// Testes do adaptador de servidor do cliente (serverStorage), rodando contra o
// servidor de verdade. É a ponta que faltava: engine.test.js cobre o motor,
// server.test.js cobre o backend, e este cobre a tradução entre os dois —
// coleção inteira virando upsert/delete por registro, e o embrulho das coleções
// que não são lista.
// Rodar com:  node Cronogramas/adapter.test.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const vm = require("vm");
const assert = require("assert");

const PORT = 8198;
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `crb-adapter-${Date.now()}.db`);
const SRC = fs.readFileSync(path.join(__dirname, "Cronogramas_v2.html"), "utf8");

// Extrai serverStorage() do HTML, sem duplicar o código aqui.
const at = SRC.indexOf("\n    function serverStorage(");
const end = SRC.indexOf("\n    }\n", SRC.indexOf("async list(prefix, shared)", at));
if (at < 0 || end < 0) throw new Error("não achei serverStorage no HTML");
const code = SRC.slice(at, end + 6);

const sandbox = { console, fetch, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
vm.createContext(sandbox);
vm.runInContext(
  "const localStorageAdapter = { get: async () => null, set: async () => null, delete: async () => null, list: async () => null };\n" +
  code + "\nglobalThis.serverStorage = serverStorage;",
  sandbox
);

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log("  ok   " + name); }
  catch (e) { failed++; console.log("  FAIL " + name + "\n       " + (e.message || e)); }
}

(async () => {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: { ...process.env, PORT: String(PORT), CRB_DB: DB }, stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (d) => process.stderr.write(d));
  for (let i = 0; i < 60; i++) {
    try { await fetch(BASE + "/health"); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }

  const S = sandbox.serverStorage(BASE);
  const raw = async (c) => (await (await fetch(`${BASE}/api/${c}`)).json());

  console.log("\nContrato básico");

  await test("coleção que nunca existiu devolve null (dispara o seed)", async () => {
    assert.equal(await S.get("vazia", true), null);
  });

  await test("grava e lê a lista de volta igual", async () => {
    const items = [{ id: "a", n: 1 }, { id: "b", n: 2 }];
    await S.set("lista", JSON.stringify(items), true);
    const r = await S.get("lista", true);
    assert.deepEqual(JSON.parse(r.value), items);
  });

  console.log("\nEscrita por registro (o motivo do adaptador existir)");

  await test("editar um item de uma lista de 50 manda 1 upsert, não 50", async () => {
    const big = Array.from({ length: 50 }, (_, i) => ({ id: "x" + i, n: i }));
    await S.set("grande", JSON.stringify(big), true);
    const antes = (await raw("grande")).version;
    big[7] = { id: "x7", n: 999 };
    await S.set("grande", JSON.stringify(big), true);
    const depois = await raw("grande");
    assert.equal(depois.version, antes + 1, "uma escrita = uma versão");
    assert.equal(depois.items.find((i) => i.id === "x7").n, 999);
    assert.equal(depois.items.length, 50);
  });

  await test("remover um item manda delete e não apaga o resto", async () => {
    const atual = JSON.parse((await S.get("grande", true)).value).filter((i) => i.id !== "x3");
    await S.set("grande", JSON.stringify(atual), true);
    const depois = await raw("grande");
    assert.equal(depois.items.length, 49);
    assert.ok(!depois.items.some((i) => i.id === "x3"));
  });

  await test("salvar sem mudar nada não gera escrita", async () => {
    const igual = (await S.get("grande", true)).value;
    const antes = (await raw("grande")).version;
    await S.set("grande", igual, true);
    assert.equal((await raw("grande")).version, antes, "não pode bumpar versão à toa");
  });

  await test("dois adaptadores gravando itens diferentes não se apagam", async () => {
    // Simula duas pessoas: cada uma com o próprio snapshot da mesma lista.
    const A = sandbox.serverStorage(BASE), B = sandbox.serverStorage(BASE);
    await S.set("compartilhada", JSON.stringify([{ id: "base" }]), true);
    const listaA = JSON.parse((await A.get("compartilhada", true)).value);
    const listaB = JSON.parse((await B.get("compartilhada", true)).value);
    await A.set("compartilhada", JSON.stringify([...listaA, { id: "daAna" }]), true);
    await B.set("compartilhada", JSON.stringify([...listaB, { id: "doBruno" }]), true);
    const ids = (await raw("compartilhada")).items.map((i) => i.id).sort();
    assert.deepEqual(ids, ["base", "daAna", "doBruno"]);
  });

  console.log("\nColeção que não é lista (matriz de permissões)");

  await test("objeto grava e volta como objeto, não como lista", async () => {
    const obj = { gestor: ["custos"], medico: ["meu_dia"] };
    await S.set("permissoes", JSON.stringify(obj), true);
    const r = await S.get("permissoes", true);
    assert.deepEqual(JSON.parse(r.value), obj);
  });

  await test("gravar várias vezes não aninha o embrulho", async () => {
    // Regressão: o embrulho era desfeito só na escrita, então o app lia a caixa
    // e regravava caixa dentro de caixa a cada salvamento.
    const obj = { gestor: ["custos"] };
    for (let i = 0; i < 3; i++) {
      const lido = JSON.parse((await S.get("permissoes2", true))?.value || JSON.stringify(obj));
      await S.set("permissoes2", JSON.stringify(lido), true);
    }
    const final = JSON.parse((await S.get("permissoes2", true)).value);
    assert.deepEqual(final, obj, "objeto deformado: " + JSON.stringify(final));
    assert.ok(!Array.isArray(final));
    assert.ok(!("__singleton" in final) && !("value" in final));
  });

  await test("um adaptador novo lê o objeto certo do servidor", async () => {
    const outro = sandbox.serverStorage(BASE);
    assert.deepEqual(JSON.parse((await outro.get("permissoes", true)).value), { gestor: ["custos"], medico: ["meu_dia"] });
  });

  console.log("\nSemeadura com dois clientes ao mesmo tempo");

  await test("create() não sobrescreve coleção que já existe", async () => {
    await S.set("jaExiste", JSON.stringify([{ id: "original" }]), true);
    await S.create("jaExiste", JSON.stringify([{ id: "novo" }]), true);
    const r = await raw("jaExiste");
    assert.deepEqual(r.items.map((i) => i.id), ["original"]);
  });

  await test("dois clientes semeando a MESMA base vazia convergem numa só", async () => {
    // Cenário real: duas pessoas abrindo o sistema pela primeira vez juntas.
    // Cada uma gera IDs próprios; sem proteção, as duas gravavam e a base
    // ficava com salas de uma geração e atividades de outra.
    const A = sandbox.serverStorage(BASE), B = sandbox.serverStorage(BASE);
    const salasA = [{ id: "locA1" }, { id: "locA2" }];
    const salasB = [{ id: "locB1" }, { id: "locB2" }];
    const [rA, rB] = await Promise.all([
      A.create("salas", JSON.stringify(salasA), true),
      B.create("salas", JSON.stringify(salasB), true),
    ]);
    const final = (await raw("salas")).items.map((i) => i.id).sort();
    assert.equal(final.length, 2, "não pode ficar com as 4: " + final.join(","));
    // Os dois clientes têm que enxergar exatamente o que ficou gravado —
    // é isso que faz as seeds seguintes referenciarem os IDs certos.
    assert.deepEqual(JSON.parse(rA.value).map((i) => i.id).sort(), final);
    assert.deepEqual(JSON.parse(rB.value).map((i) => i.id).sort(), final);
  });

  await test("quem perde a corrida adota os IDs do vencedor", async () => {
    const A = sandbox.serverStorage(BASE), B = sandbox.serverStorage(BASE);
    await A.create("cadeia", JSON.stringify([{ id: "x1" }]), true);
    // B chega depois e tenta semear a sua versão: tem que receber a de A.
    const rB = await B.create("cadeia", JSON.stringify([{ id: "y1" }]), true);
    assert.deepEqual(JSON.parse(rB.value).map((i) => i.id), ["x1"]);
  });

  console.log("\nPoll barato e listagem");

  await test("releitura sem mudança usa 304 e devolve o mesmo conteúdo", async () => {
    const antes = (await S.get("lista", true)).value;
    let status304 = false;
    const of = sandbox.fetch;
    sandbox.fetch = async (...a) => { const r = await of(...a); if (r.status === 304) status304 = true; return r; };
    const depois = (await S.get("lista", true)).value;
    sandbox.fetch = of;
    assert.equal(depois, antes);
    assert.ok(status304, "a segunda leitura tinha que bater no 304");
  });

  await test("list() enumera as coleções existentes", async () => {
    const r = await S.list("", true);
    assert.ok(r.keys.includes("lista") && r.keys.includes("grande"), JSON.stringify(r.keys));
  });

  await test("preferência pessoal (shared:false) não vai pro servidor", async () => {
    const antes = Object.keys(await (await fetch(`${BASE}/api/collections`)).json()).length;
    await S.set("crb2-theme", JSON.stringify("dark"), false);
    const depois = Object.keys(await (await fetch(`${BASE}/api/collections`)).json()).length;
    assert.equal(depois, antes, "dado privado não pode criar coleção no banco");
  });

  /* ---- Campos da estimativa na ida e na volta --------------------------- */
  /* O adaptador manda só o que MUDOU (diff contra o último snapshot lido).
   * Campo novo que ele não conhece tem que atravessar inteiro mesmo assim —
   * senão a estimativa perderia justamente o que define se ela bloqueia. */

  await test("bookingType/estimateId/holdsResources/holdUntil sobrevivem à ida e volta", async () => {
    const reserva = {
      id: "bkEst", bookingType: "estimate", estimateId: "est-99",
      holdsResources: true, holdUntil: "2026-09-30T14:30",
      date: "2026-09-30", start: "09:00", end: "10:00", blockStart: "09:00", blockEnd: "10:00",
      locationId: "salaX", collaboratorIds: [], accessoryIds: [],
    };
    await S.set("crb2-bookings", JSON.stringify([reserva]), true);
    const volta = JSON.parse((await S.get("crb2-bookings", true)).value);
    assert.deepEqual(volta[0], reserva, "nenhum campo pode se perder no caminho");
  });

  await test("mudar só o prazo manda 1 upsert, não a coleção inteira", async () => {
    const base = JSON.parse((await S.get("crb2-bookings", true)).value);
    const outras = [1, 2, 3].map((n) => ({
      id: "outra" + n, date: "2026-09-30", start: "1" + n + ":00", end: "1" + n + ":30",
      blockStart: "1" + n + ":00", blockEnd: "1" + n + ":30",
      locationId: "sala" + n, collaboratorIds: [], accessoryIds: [],
    }));
    await S.set("crb2-bookings", JSON.stringify([...base, ...outras]), true);
    await S.get("crb2-bookings", true); // atualiza o snapshot

    let enviado = null;
    const of = sandbox.fetch;
    sandbox.fetch = async (url, opts) => {
      if (opts?.method === "POST" && String(url).includes("crb2-bookings")) enviado = JSON.parse(opts.body);
      return of(url, opts);
    };
    const atual = JSON.parse((await S.get("crb2-bookings", true)).value);
    const prorrogada = atual.map((b) => (b.id === "bkEst" ? { ...b, holdUntil: "2026-10-15" } : b));
    await S.set("crb2-bookings", JSON.stringify(prorrogada), true);
    sandbox.fetch = of;

    assert.equal(enviado.upserts.length, 1, "prorrogar mexe numa reserva só");
    assert.equal(enviado.upserts[0].id, "bkEst");
    assert.equal(enviado.upserts[0].holdUntil, "2026-10-15");
  });

  await test("liberar recursos vira holdsResources:false, não exclusão", async () => {
    // Liberar não pode apagar a ocupação: é ela que registra qual horário
    // chegou a ficar segurado, que é o dado da análise de reaproveitamento.
    const atual = JSON.parse((await S.get("crb2-bookings", true)).value);
    const liberada = atual.map((b) => (b.id === "bkEst" ? { ...b, holdsResources: false, holdUntil: null } : b));
    await S.set("crb2-bookings", JSON.stringify(liberada), true);
    const volta = JSON.parse((await S.get("crb2-bookings", true)).value);
    const alvo = volta.find((b) => b.id === "bkEst");
    assert.ok(alvo, "a ocupação tem que continuar existindo");
    assert.equal(alvo.holdsResources, false);
    assert.equal(alvo.holdUntil, null);
    assert.equal(alvo.estimateId, "est-99", "o vínculo com a estimativa fica");
  });

  /* ---- Pré-condição atravessa o adaptador -------------------------------- */
  /* De nada adianta o servidor saber checar se o adaptador não manda. */

  await test("expects chega ao servidor e recusa a segunda operação", async () => {
    await S.set("crb2-estimates", JSON.stringify([{ id: "eAd", name: "Op", convertedStudyId: null }]), true);
    await S.get("crb2-estimates", true); // sincroniza o snapshot

    const converter = (n) => S.transaction([{
      key: "crb2-estimates",
      replaceWith: [{ id: "eAd", name: "Op", convertedStudyId: `s${n}` }],
      expects: [{ id: "eAd", field: "convertedStudyId", equals: null }],
    }]);

    const primeira = await converter(1);
    assert.equal(primeira.ok, true, JSON.stringify(primeira));
    // O snapshot foi invalidado, então a segunda relê e manda o diff certo —
    // mas a pré-condição já não vale mais.
    const segunda = await converter(2);
    assert.equal(segunda.ok, false, "a segunda tinha que ser recusada");
    assert.ok(segunda.conflicts.join(" ").includes("convertedStudyId"), segunda.conflicts.join("; "));

    const volta = JSON.parse((await S.get("crb2-estimates", true)).value);
    assert.equal(volta[0].convertedStudyId, "s1", "quem venceu foi a primeira");
  });

  await test("mudança que só tem pré-condição não é descartada", async () => {
    // Sem upsert nem delete, mas com `expects`: precisa ir mesmo assim, senão
    // "só grave se aquilo ainda for verdade" nunca chegaria a ser checado.
    const r = await S.transaction([{
      key: "crb2-estimates",
      expects: [{ id: "eAd", field: "convertedStudyId", equals: null }],
    }]);
    assert.equal(r.ok, false, "a pré-condição tinha que ter sido avaliada");
  });

  child.kill();
  await new Promise((r) => child.on("exit", r));
  for (const f of [DB, DB + "-wal", DB + "-shm"]) { try { fs.unlinkSync(f); } catch {} }
  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed ? 1 : 0);
})();
