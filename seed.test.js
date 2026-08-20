/* =======================================================================
   Teste da SEMEADURA no modo arquivo (localStorage)
   =======================================================================

   Por que este arquivo existe: a semeadura já quebrou duas vezes de um jeito
   que nenhum teste pegava — uma base marcada como "já inicializada" mas sem
   cadastro nenhum, e o usuário abrindo o sistema com todas as listas vazias
   e nada na tela explicando. O motor era testado, o servidor era testado, e
   o caminho que a pessoa realmente percorre ao abrir o arquivo não era.

   Aqui o adaptador de localStorage é extraído do HTML e exercitado contra um
   localStorage de mentira, com a MESMA lista de gravações que o `loadAll`
   monta. Rodar com:  node seed.test.js
   ======================================================================= */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert");
const { loadEngine } = require("./engine-harness");

const SRC = fs.readFileSync(path.join(__dirname, "Cronogramas_v2.html"), "utf8");

/* --- localStorage de mentira, igual ao do navegador --------------------- */
function fakeLocalStorage() {
  const mapa = new Map();
  return {
    get length() { return mapa.size; },
    key(i) { return [...mapa.keys()][i] ?? null; },
    getItem(k) { return mapa.has(k) ? mapa.get(k) : null; },
    setItem(k, v) { mapa.set(k, String(v)); },
    removeItem(k) { mapa.delete(k); },
    clear() { mapa.clear(); },
  };
}

/* Recorta o `localStorageAdapter` do HTML — mesmo princípio do
 * engine-harness: a regra que vale é a que está no arquivo, não uma cópia. */
function carregarAdaptador(localStorage) {
  // `nsKey` mora fora do adaptador e é usada por todos os métodos dele —
  // extrair só o objeto deixa cada gravação estourando ReferenceError dentro
  // do próprio try/catch, que devolve null em silêncio.
  const at = SRC.indexOf("\n    const nsKey = (key, shared)");
  assert.ok(at > 0, "não achei o nsKey/localStorageAdapter no HTML");
  const fim = SRC.indexOf("\n    };", SRC.indexOf("async list(prefix, shared)", at));
  assert.ok(fim > at, "não consegui delimitar o localStorageAdapter");
  const code = SRC.slice(at, fim + 7) + "\nglobalThis.__A = localStorageAdapter;";
  const sandbox = { console, localStorage };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  return sandbox.__A;
}

const E = loadEngine({
  htmlPath: path.join(__dirname, "Cronogramas_v2.html"),
  fns: ["seedUsers", "seedTrainingTypes"],
});

const KEYS = {
  seedLock: "crb2-seed", niches: "crb2-niches", sponsors: "crb2-sponsors",
  locations: "crb2-locations", supplies: "crb2-supplies", activities: "crb2-activities",
  equipment: "crb2-equipment", doctors: "crb2-doctors", collaborators: "crb2-collaborators",
  users: "crb2-users", trainingTypes: "crb2-training-types",
  studies: "crb2-studies", timepoints: "crb2-timepoints", bookings: "crb2-bookings",
  trainingRequests: "crb2-training-requests", overtimeRequests: "crb2-overtime-requests",
  staffRequests: "crb2-staff-requests",
};

/* Reproduz o que o `loadAll` monta. Se o HTML mudar a forma da semeadura sem
 * mudar aqui, o teste passa e o app quebra — por isso o teste final compara o
 * conjunto de coleções contra o que o HTML realmente lista. */
function montarPartes(temSentinela) {
  const n = E.seedNiches();
  const loc = E.seedLocations();
  const sup = E.seedSupplies();
  const act = E.seedActivities(loc, sup);
  const doc = E.seedDoctors();
  const eqp = E.seedEquipment();
  const col = E.seedCollaborators(act);
  col.forEach((c) => { act.forEach((a) => { c.levels[a.id] = Math.max(c.levels[a.id] || 0, a.minLevel || 3); }); });
  const usuarios = E.seedUsers(col, doc).map((u) => ({ ...u, pin: "1234" }));
  return [
    ...(temSentinela ? [] : [{
      key: KEYS.seedLock, replaceWith: [{ id: "__base", at: new Date().toISOString() }],
      expects: [{ id: "__base", absent: true, message: "outro cliente já semeou a base" }],
    }]),
    { key: KEYS.niches, replaceWith: n },
    { key: KEYS.sponsors, replaceWith: E.seedSponsors(n) },
    { key: KEYS.locations, replaceWith: loc },
    { key: KEYS.supplies, replaceWith: sup },
    { key: KEYS.activities, replaceWith: act },
    { key: KEYS.equipment, replaceWith: eqp },
    { key: KEYS.doctors, replaceWith: doc },
    { key: KEYS.collaborators, replaceWith: col },
    { key: KEYS.trainingTypes, replaceWith: E.seedTrainingTypes(act, loc, eqp) },
    ...(temSentinela ? [] : [{ key: KEYS.users, replaceWith: usuarios }]),
    ...(temSentinela ? [] : [
      { key: KEYS.studies, replaceWith: [] },
      { key: KEYS.timepoints, replaceWith: [] },
      { key: KEYS.bookings, replaceWith: [] },
      { key: KEYS.trainingRequests, replaceWith: [] },
      { key: KEYS.overtimeRequests, replaceWith: [] },
      { key: KEYS.staffRequests, replaceWith: [] },
    ]),
  ];
}

let passed = 0, failed = 0;
async function test(nome, fn) {
  try { await fn(); passed++; console.log("  ok   " + nome); }
  catch (e) { failed++; console.log("  FAIL " + nome + "\n       " + (e.message || e)); }
}

(async () => {
  console.log("\nSemeadura no modo arquivo (sem servidor)");

  const ler = async (A, key) => {
    const r = await A.get(key, true);
    return r ? JSON.parse(r.value) : null;
  };

  await test("base nova nasce com o CADASTRO pronto", async () => {
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    const r = await A.transaction(montarPartes(false));
    assert.equal(r.ok, true, `a transação falhou: ${JSON.stringify(r.conflicts)}`);
    assert.equal((await ler(A, KEYS.locations)).length, 15, "locais");
    assert.equal((await ler(A, KEYS.activities)).length, 29, "atividades");
    assert.equal((await ler(A, KEYS.equipment)).length, 26, "equipamentos");
    assert.equal((await ler(A, KEYS.supplies)).length, 5, "insumos");
    assert.equal((await ler(A, KEYS.sponsors)).length, 37, "patrocinadores");
    assert.equal((await ler(A, KEYS.collaborators)).length, 10, "colaboradores");
    assert.equal((await ler(A, KEYS.doctors)).length, 5, "médicos");
    assert.equal((await ler(A, KEYS.trainingTypes)).length, 3, "tipos de treinamento");
  });

  await test("base nova nasce com o MOVIMENTO vazio", async () => {
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.transaction(montarPartes(false));
    for (const k of [KEYS.studies, KEYS.timepoints, KEYS.bookings, KEYS.trainingRequests, KEYS.overtimeRequests, KEYS.staffRequests]) {
      assert.deepEqual(await ler(A, k), [], k);
    }
  });

  await test("há acessórios entre os equipamentos", async () => {
    // "Acessórios" é uma categoria própria no Cadastro, filtrada de equipment.
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.transaction(montarPartes(false));
    const eq = await ler(A, KEYS.equipment);
    assert.ok(eq.filter((e) => e.isAccessory).length > 0, "nenhum acessório");
    assert.ok(eq.filter((e) => !e.isAccessory).length > 0, "nenhum equipamento principal");
  });

  await test("toda conta entra com o mesmo PIN", async () => {
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.transaction(montarPartes(false));
    const users = await ler(A, KEYS.users);
    assert.ok(users.length >= 4, "poucas contas");
    assert.deepEqual([...new Set(users.map((u) => u.pin))], ["1234"]);
    assert.ok(users.some((u) => u.level === "admin"), "sem Administrador");
  });

  await test("a equipe nasce habilitada em todos os métodos", async () => {
    // Sem isso a primeira parede ao testar é "ninguém treinado".
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.transaction(montarPartes(false));
    const act = await ler(A, KEYS.activities);
    const col = await ler(A, KEYS.collaborators);
    col.forEach((c) => act.forEach((a) => {
      assert.ok((c.levels[a.id] || 0) >= (a.minLevel || 3), `${c.name} sem nível em ${a.name}`);
    }));
  });

  await test("RECUPERAÇÃO: base marcada como inicializada mas sem cadastro volta a ter cadastro", async () => {
    /* O estado que quebrou de verdade: uma versão anterior gravou a sentinela
     * junto com quase nada, e as versões seguintes não semeavam porque a marca
     * estava lá. */
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.set(KEYS.seedLock, JSON.stringify([{ id: "__base", at: "2026-08-20T00:00:00.000Z" }]), true);
    await A.set(KEYS.users, JSON.stringify([{ id: "u1", name: "Administrador", pin: "1234", level: "admin" }]), true);

    const r = await A.transaction(montarPartes(true));
    assert.equal(r.ok, true, `a recuperação falhou: ${JSON.stringify(r.conflicts)}`);
    assert.equal((await ler(A, KEYS.locations)).length, 15);
    assert.equal((await ler(A, KEYS.activities)).length, 29);
  });

  await test("RECUPERAÇÃO não apaga o que já existe", async () => {
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    await A.set(KEYS.seedLock, JSON.stringify([{ id: "__base", at: "x" }]), true);
    await A.set(KEYS.users, JSON.stringify([{ id: "u9", name: "Gente de verdade", pin: "9999", level: "gestor" }]), true);
    await A.set(KEYS.studies, JSON.stringify([{ id: "s9", name: "Estudo real" }]), true);

    await A.transaction(montarPartes(true));
    const users = await ler(A, KEYS.users);
    assert.deepEqual(users.map((u) => u.name), ["Gente de verdade"], "as contas não podem ser sobrescritas");
    const studies = await ler(A, KEYS.studies);
    assert.deepEqual(studies.map((s) => s.name), ["Estudo real"], "o trabalho não pode ser apagado");
  });

  await test("semear duas vezes na mesma base é recusado pela sentinela", async () => {
    const ls = fakeLocalStorage();
    const A = carregarAdaptador(ls);
    assert.equal((await A.transaction(montarPartes(false))).ok, true);
    const segunda = await A.transaction(montarPartes(false));
    assert.equal(segunda.ok, false, "a segunda semeadura deveria ser recusada");
  });

  await test("as coleções semeadas são as que o HTML realmente lista", async () => {
    /* Trava contra este teste virar ficção: se alguém acrescentar uma coleção
     * na semeadura do HTML e esquecer daqui, isto acusa. */
    const bloco = SRC.slice(SRC.indexOf("const seedLock = (await get(KEYS.seedLock))"));
    const trecho = bloco.slice(0, bloco.indexOf("const r = await window.storage.transaction(partes)"));
    const noHtml = new Set([...trecho.matchAll(/key: KEYS\.(\w+)/g)].map((m) => m[1]));
    const noTeste = new Set(montarPartes(false).map((p) => {
      const nome = Object.keys(KEYS).find((k) => KEYS[k] === p.key);
      return nome;
    }));
    const faltando = [...noHtml].filter((k) => !noTeste.has(k));
    assert.deepEqual(faltando, [], `o HTML semeia coleções que este teste não cobre: ${faltando.join(", ")}`);
  });

  console.log(`\n${passed} passaram, ${failed} falharam\n`);
  process.exit(failed ? 1 : 0);
})();
