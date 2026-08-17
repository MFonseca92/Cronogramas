/* =======================================================================
   Central de Recursos — servidor de referência
   =======================================================================

   Implementação pronta pra rodar do backend que o app espera. Usa SQLite
   (módulo `node:sqlite`, embutido no Node 22+) e nenhuma dependência
   externa — `node Cronogramas/server.js` e pronto.

   Por que ele existe: o localStorage funciona pra um usuário só. Com 20
   pessoas ao mesmo tempo ele quebra de duas formas —
     1. cada aba tem a própria cópia dos dados (não há nada compartilhado);
     2. mesmo com um servidor ingênuo, salvar a COLEÇÃO INTEIRA faz a
        última gravação apagar o que outra pessoa acabou de criar.

   Este servidor resolve as duas:

   * Cada registro é uma linha própria (`entities`), não um blob por
     coleção. Gravar é upsert/delete POR REGISTRO, então duas pessoas
     mexendo em reservas diferentes nunca se atropelam. Só há conflito
     real quando duas editam o MESMO registro — aí vale a última, que é o
     comportamento esperado e o que a tela mostra no próximo poll.

   * Cada coleção tem um número de versão que sobe a cada escrita. O
     cliente manda a versão que tem em mãos e, se nada mudou, recebe 304
     sem corpo. Com poll de 5s e 20 pessoas isso é o que segura a conta:
     a esmagadora maioria das requisições não lê nem serializa nada.

   Rotas
     GET    /api/collections            versão atual de todas as coleções
     GET    /api/:collection            { version, items } (304 com ?since=)
     POST   /api/:collection            { upserts: [], deletes: [] }
     POST   /api/tx                     { changes: [] } — várias coleções
     POST   /api/backup                 gera uma cópia consistente do banco
     GET    /health

   BACKUP — leia antes de copiar arquivo.

     O banco roda em modo WAL (write-ahead logging), que é o que permite
     leitura e escrita ao mesmo tempo sem travar. A consequência prática:
     as gravações recentes ficam em `data.db-wal`, NÃO em `data.db`.
     Copiar só o `data.db` pode gerar um backup vazio ou velho — e o pior
     é que ele parece bom, porque o arquivo existe e tem tamanho.

     Use `POST /api/backup` (ou `node server.js --backup <arquivo>`): os
     dois usam `VACUUM INTO`, que escreve UM arquivo consistente, com o
     WAL já incorporado, sem parar o servidor. O arquivo gerado abre
     sozinho em qualquer SQLite.

     A ROTA grava só dentro de `CRB_BACKUP_DIR` (padrão: `backups/` ao
     lado do banco), com nome escolhido pelo servidor, e essa pasta não é
     servida estaticamente. Caminho livre existe só no CLI. O motivo é
     simples: enquanto não há autenticação, um endpoint que aceita caminho
     do cliente escreve em qualquer lugar que o processo alcance — e um
     backup ao lado do HTML seria baixável pelo navegador.

     Se preferir copiar à mão, pare o servidor antes: no encerramento
     limpo ele faz checkpoint e o `-wal` é absorvido. Copiar com o
     servidor no ar exige levar `data.db`, `data.db-wal` e `data.db-shm`
     juntos, e ainda assim sem garantia de consistência.

   O que este arquivo NÃO faz, de propósito (decisões que dependem do
   ambiente de vocês, não do código):
     - Autenticação de verdade. Hoje o PIN é conferido no cliente, o que
       é identificação, não segurança. Num servidor de produção o login
       tem que ser aqui, devolvendo um token, e cada rota tem que checar
       esse token — e as permissões por nível, que hoje só escondem botão,
       precisam valer por rota. Enquanto o sistema roda na rede interna e
       o risco é "alguém entra como outro por engano", o modelo atual se
       sustenta; exposto na internet, não. O PIN também está em texto
       puro: em produção, hash.
     - HTTPS. Fica a cargo de quem hospedar.
     - CORS. O servidor entrega o próprio HTML, então cliente e API ficam
       na mesma origem e não há o que liberar. Abrir o HTML de outra
       origem e apontar `crb.backend` pra cá NÃO funciona por isso — é
       decisão consciente: liberar CORS num servidor sem autenticação
       significaria deixar qualquer página da internet ler e escrever no
       banco de vocês. Sirva o HTML pelo próprio servidor.
   ======================================================================= */

const http = require("http");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

const PORT = Number(process.env.PORT || 8124);
const DB_PATH = process.env.CRB_DB || path.join(__dirname, "data.db");
const STATIC_ROOT = __dirname;

/* ---------------------------------------------------------------------- */
/* Banco                                                                   */
/* ---------------------------------------------------------------------- */
const db = new DatabaseSync(DB_PATH);
// WAL: leitura não trava escrita. É o que permite os polls dos 20 clientes
// rodarem enquanto alguém está salvando.
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS entities (
    collection TEXT NOT NULL,
    id         TEXT NOT NULL,
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
  );
  CREATE TABLE IF NOT EXISTS collections (
    collection TEXT PRIMARY KEY,
    version    INTEGER NOT NULL DEFAULT 0
  );
`);

const q = {
  items: db.prepare("SELECT json FROM entities WHERE collection = ? ORDER BY id"),
  one: db.prepare("SELECT json FROM entities WHERE collection = ? AND id = ?"),
  version: db.prepare("SELECT version FROM collections WHERE collection = ?"),
  allVersions: db.prepare("SELECT collection, version FROM collections"),
  upsert: db.prepare(`
    INSERT INTO entities (collection, id, json, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (collection, id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`),
  del: db.prepare("DELETE FROM entities WHERE collection = ? AND id = ?"),
  bump: db.prepare(`
    INSERT INTO collections (collection, version) VALUES (?, 1)
    ON CONFLICT (collection) DO UPDATE SET version = version + 1`),
};

const versionOf = (collection) => q.version.get(collection)?.version ?? 0;
const itemsOf = (collection) => q.items.all(collection).map((r) => JSON.parse(r.json));

/* ---------------------------------------------------------------------- */
/* Conflito de agenda — a regra que PRECISA valer no servidor              */
/*                                                                         */
/* Gravar por registro resolve "um cliente apagar o trabalho do outro", mas */
/* não resolve dois clientes criando reservas DIFERENTES que disputam o    */
/* mesmo recurso: são dois ids distintos, e o banco aceitaria os dois.     */
/* O cliente checa conflito antes de enviar, mas essa checagem é feita     */
/* contra uma cópia que pode ter segundos de atraso — e qualquer um pode   */
/* chamar a API direto. Por isso a decisão final é aqui, dentro da mesma   */
/* transação da escrita.                                                   */
/*                                                                         */
/* A janela comparada é a BLOQUEADA (com preparo/desmontagem). Reservas do */
/* mesmo `groupId` são atividades simultâneas combinadas: dividem a sala   */
/* de propósito, mas continuam não podendo repetir pessoa, médico ou       */
/* equipamento.                                                            */
/* ---------------------------------------------------------------------- */
const BOOKINGS = "crb2-bookings";
const toMin = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const blockOf = (b) => ({ s: toMin(b.blockStart || b.start), e: toMin(b.blockEnd || b.end) });
const overlaps = (aS, aE, bS, bE) => aS < bE && bS < aE;

/* Nível de compromisso — a MESMA regra que o cliente aplica (ver
 * `bookingOccupies` no HTML). Precisa existir dos dois lados: a tela usa pra
 * dar resposta rápida, mas a decisão que vale é esta, porque a API pode ser
 * chamada direto e a cópia do cliente pode estar segundos atrasada.
 *
 * Reserva gravada antes de existir `bookingType` não tem o campo: é reserva
 * oficial, igual sempre foi. */
const bookingTypeOf = (b) => b?.bookingType || (b?.kind === "treinamento" ? "training" : "reservation");
const pad2 = (n) => String(n).padStart(2, "0");
// Calendário LOCAL, nunca `toISOString` — em UTC−3 o dia virava às 21h.
function nowStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function holdExpired(holdUntil, agora) {
  if (!holdUntil) return true;
  const lim = String(holdUntil);
  const ref = agora || nowStamp();
  return lim.length <= 10 ? lim < ref.slice(0, 10) : lim < ref;
}
// Previsão pura não tira o horário de ninguém; pré-reserva no prazo, sim.
function bookingOccupies(b, agora) {
  if (bookingTypeOf(b) !== "estimate") return true;
  if (!b.holdsResources) return false;
  return !holdExpired(b.holdUntil, agora);
}

/* Integridade do vínculo com a estimativa. Um bloqueio de estimativa sem dono
 * não teria como ser liberado nem expirado — ficaria preso na agenda pra
 * sempre. Vale aqui e não só na tela porque a API é chamável direto. */
function integrityProblems(b) {
  const out = [];
  if (bookingTypeOf(b) === "estimate") {
    if (!b.estimateId) out.push("ocupação de estimativa sem estimateId");
    if (b.holdsResources && !b.holdUntil) out.push("pré-reserva sem holdUntil");
  } else if (b.estimateId) {
    out.push("só ocupação de estimativa pode ter estimateId");
  }
  return out;
}

function conflictsFor(incoming, existing) {
  const out = [];
  // Estimativa que não segura recurso não disputa nada — mas continua sendo
  // gravada, porque é dela que sai a previsão de capacidade e de custo.
  if (!bookingOccupies(incoming)) return out;
  const mine = blockOf(incoming);
  const myEquip = [incoming.equipmentId, ...(incoming.accessoryIds || [])].filter(Boolean);
  const myCols = incoming.collaboratorIds || [];
  for (const other of existing) {
    if (other.id === incoming.id) continue;
    if (other.date !== incoming.date) continue;
    if (!bookingOccupies(other)) continue;
    const theirs = blockOf(other);
    if (!overlaps(mine.s, mine.e, theirs.s, theirs.e)) continue;
    const mesmoGrupo = incoming.groupId && other.groupId === incoming.groupId;
    if (!mesmoGrupo && incoming.locationId && other.locationId === incoming.locationId) {
      out.push(`sala já reservada nesse horário (reserva ${other.id})`);
    }
    const pessoa = myCols.find((id) => (other.collaboratorIds || []).includes(id));
    if (pessoa) out.push(`colaborador ${pessoa} já tem reserva nesse horário (reserva ${other.id})`);
    if (incoming.doctorId && other.doctorId === incoming.doctorId) {
      out.push(`médico já tem reserva nesse horário (reserva ${other.id})`);
    }
    const otherEquip = [other.equipmentId, ...(other.accessoryIds || [])].filter(Boolean);
    const equip = myEquip.find((id) => otherEquip.includes(id));
    if (equip) out.push(`equipamento ${equip} já reservado nesse horário (reserva ${other.id})`);
  }
  return out;
}

// Valida o lote inteiro: cada reserva contra as que já existem no banco E
// contra as outras do próprio lote (um grupo simultâneo chega junto).
function validateBookingBatch(upserts, deletes) {
  const atuais = itemsOf(BOOKINGS).filter((b) => !deletes.includes(String(b.id)));
  const semAsQueVaoMudar = atuais.filter((b) => !upserts.some((u) => String(u.id) === String(b.id)));
  const universo = [...semAsQueVaoMudar, ...upserts];
  const problemas = [];
  for (const item of upserts) {
    for (const motivo of integrityProblems(item)) problemas.push(`${item.id}: ${motivo}`);
    if (!item.date || !item.start || !item.end) continue; // registro sem agenda: nada a checar
    for (const motivo of conflictsFor(item, universo)) problemas.push(`${item.id}: ${motivo}`);
  }
  return problemas;
}

// Uma escrita = uma transação. Ou entra tudo, ou não entra nada — não existe
// meia gravação se o processo cair no meio.
//
// `validate` roda DENTRO da transação: ler o estado e decidir fora dela abriria
// uma janela em que outra escrita entra no meio e o conflito passa. Se ela
// devolver problemas, nada é gravado.
/* Uma transação pode tocar VÁRIAS coleções de uma vez. É isso que permite
 * "confirmar visita" ser atômico: timepoint, reservas e baixa de estoque
 * entram juntos ou não entram. Antes eram três POSTs independentes, e a rede
 * caindo no meio deixava reserva criada com estoque não descontado.
 *
 * Cada mudança é `{ collection, upserts?, deletes?, deltas? }`.
 *
 * `deltas` é a operação que resolve o lost update do estoque:
 * `{ id, field, delta, min }` faz `campo = campo + delta` LENDO O VALOR ATUAL
 * DENTRO da transação. O cliente manda "consome 5", não "a quantidade nova é
 * 95" — dois usuários confirmando ao mesmo tempo passavam de 100 pra 95 os
 * dois, quando o certo era 90.
 *
 * `expects` é a PRÉ-CONDIÇÃO (compare-and-set): `{ collection, id, field,
 * equals }` exige que o campo tenha aquele valor AGORA, lido dentro da
 * transação. É o que impede uma operação de acontecer duas vezes quando duas
 * pessoas clicam ao mesmo tempo.
 *
 * O caso que motivou: duas conversões simultâneas da mesma estimativa. As
 * duas checavam "já foi convertida?" no cliente, contra cópias que ainda
 * diziam que não; as duas eram aceitas; nasciam dois estudos, um deles órfão,
 * e o estoque era descontado duas vezes. Checar aqui dentro fecha a janela,
 * porque o BEGIN IMMEDIATE serializa as duas: a segunda lê o resultado da
 * primeira e é recusada.
 *
 * A checagem é por CAMPO, não por versão do registro, de propósito: importa
 * "essa estimativa ainda não foi convertida", não "ninguém encostou nela".
 * Alguém ter editado a observação no meio do caminho não deveria derrubar a
 * conversão.
 */
function checkExpectations(changes) {
  const problemas = [];
  for (const ch of changes) {
    for (const e of ch.expects || []) {
      const col = e.collection || ch.collection;
      const row = q.one.get(col, String(e.id));
      /* `absent: true` — "esse registro ainda NÃO pode existir". É o que
       * permite semear a base pela primeira vez em uma transação só: o
       * primeiro cliente cria a sentinela junto com os dados, o segundo lê
       * a sentinela já lá e é recusado, em vez de os dois semearem
       * gerações diferentes e misturarem estudos de uma com visitas de
       * outra. */
      if (e.absent) {
        if (row) problemas.push(e.message || `${e.id} já existe em ${col}`);
        continue;
      }
      if (!row) { problemas.push(`${e.id} não existe em ${col}`); continue; }
      const atual = JSON.parse(row.json)[e.field];
      // Comparação frouxa entre null e undefined: "ainda não tem valor" é a
      // mesma coisa nos dois casos, e o cliente pode mandar qualquer um.
      const vazio = (v) => v === null || v === undefined;
      const igual = (vazio(atual) && vazio(e.equals)) || atual === e.equals;
      if (!igual) {
        problemas.push(e.message
          || `${e.field} de ${e.id} mudou (esperado ${JSON.stringify(e.equals)}, está ${JSON.stringify(atual)})`);
      }
    }
  }
  return problemas;
}

function runTransaction(changes) {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    // Pré-condições primeiro: se o estado mudou desde que o cliente decidiu,
    // nada mais precisa ser checado.
    const precond = checkExpectations(changes);
    if (precond.length) { db.exec("ROLLBACK"); return { conflicts: precond }; }

    // Valida reservas de todas as mudanças ANTES de escrever qualquer coisa.
    const problemas = [];
    for (const ch of changes) {
      if (ch.collection === BOOKINGS && (ch.upserts || []).length) {
        problemas.push(...validateBookingBatch(ch.upserts, (ch.deletes || []).map(String)));
      }
    }
    if (problemas.length) { db.exec("ROLLBACK"); return { conflicts: problemas }; }

    const versions = {};
    for (const ch of changes) {
      for (const item of ch.upserts || []) q.upsert.run(ch.collection, String(item.id), JSON.stringify(item), now);
      for (const id of ch.deletes || []) q.del.run(ch.collection, String(id));
      for (const d of ch.deltas || []) {
        const row = q.one.get(ch.collection, String(d.id));
        if (!row) { db.exec("ROLLBACK"); return { conflicts: [`registro ${d.id} não existe em ${ch.collection}`] }; }
        const obj = JSON.parse(row.json);
        const atual = Number(obj[d.field] ?? 0);
        const alvo = atual + Number(d.delta || 0);
        const piso = d.min == null ? -Infinity : Number(d.min);
        if (alvo < piso) { db.exec("ROLLBACK"); return { conflicts: [`${d.field} de ${d.id} ficaria em ${alvo}, abaixo do mínimo ${piso}`] }; }
        obj[d.field] = alvo;
        q.upsert.run(ch.collection, String(d.id), JSON.stringify(obj), now);
      }
      q.bump.run(ch.collection);
      versions[ch.collection] = versionOf(ch.collection);
    }
    db.exec("COMMIT");
    return { versions };
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
/* Backup consistente com o servidor no ar.
 *
 * `VACUUM INTO` escreve UM arquivo com o banco inteiro já compactado e com
 * o WAL incorporado. Copiar `data.db` à mão não serve: em modo WAL as
 * gravações recentes moram no `-wal`, e o backup sairia vazio ou velho
 * parecendo bom — que é o pior tipo de backup.
 *
 * Recusa sobrescrever arquivo existente de propósito: `VACUUM INTO` também
 * recusa, e é melhor a pessoa escolher outro nome do que descobrir depois
 * que apagou o backup de ontem. */
function backupTo(destino) {
  const alvo = path.resolve(destino);
  if (fs.existsSync(alvo)) throw new Error(`já existe um arquivo em ${alvo} — escolha outro nome`);
  fs.mkdirSync(path.dirname(alvo), { recursive: true });
  // Aspas simples duplicadas: é como SQLite escapa aspas dentro de string.
  db.exec(`VACUUM INTO '${alvo.replace(/'/g, "''")}'`);
  return { path: alvo, bytes: fs.statSync(alvo).size };
}
const nomeDeBackup = () => `backup-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.db`;

/* Onde os backups PODEM ser gravados pela API.
 *
 * Fora da pasta servida estaticamente de propósito: com o padrão anterior o
 * backup caía ao lado do HTML e dava pra baixar o banco inteiro pelo
 * navegador, sem nenhuma credencial. E a rota aceitava um caminho qualquer
 * do corpo, criando diretórios — um endpoint sem autenticação escrevendo em
 * qualquer lugar que o processo alcance.
 *
 * Agora a API só grava aqui dentro, com nome gerado pelo servidor. Caminho
 * livre continua existindo, mas só pelo CLI, onde quem chama já é dono da
 * máquina. */
const BACKUP_DIR = path.resolve(process.env.CRB_BACKUP_DIR || path.join(path.dirname(DB_PATH), "backups"));

// Escrita numa coleção só — continua sendo o caminho comum; delega pra
// transação pra não existirem duas implementações da mesma regra.
function applyChanges(collection, upserts, deletes) {
  const r = runTransaction([{ collection, upserts, deletes }]);
  return r.conflicts ? r : { version: r.versions[collection] };
}

/* ---------------------------------------------------------------------- */
/* HTTP                                                                    */
/* ---------------------------------------------------------------------- */
const COLLECTION_RE = /^[a-z0-9-]{1,64}$/i;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };

function json(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { "content-type": "application/json; charset=utf-8", "content-length": buf.length, "cache-control": "no-store" });
  res.end(buf);
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limitBytes) { reject(new Error("corpo grande demais")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("JSON inválido")); }
    });
    req.on("error", reject);
  });
}

/* Arquivos que NUNCA são servidos, mesmo estando na pasta: o banco e tudo
 * que sai dele. Sem isso, um `GET /data.db` (ou um backup gravado ali ao
 * lado) entregaria a base inteira pelo navegador, sem credencial nenhuma. */
const EXT_PROIBIDA = new Set([".db", ".db-wal", ".db-shm", ".sqlite", ".sqlite3"]);
const bloqueado = (file) => EXT_PROIBIDA.has(path.extname(file))
  || /\.db-(wal|shm)$/i.test(file)
  || path.resolve(file).startsWith(BACKUP_DIR);

function serveStatic(req, res, rel) {
  const file = path.join(STATIC_ROOT, path.normalize(rel === "/" ? "/Cronogramas_v2.html" : rel).replace(/^[\\/]+/, ""));
  if (!file.startsWith(STATIC_ROOT)) return json(res, 403, { error: "proibido" });
  if (bloqueado(file)) return json(res, 403, { error: "proibido" });
  fs.readFile(file, (err, buf) => {
    if (err) return json(res, 404, { error: "não encontrado" });
    let body = buf;
    if (path.extname(file) === ".html") {
      // Marca a página como servida por este servidor. O app lê essa variável
      // de forma síncrona e já nasce falando com a API — sem isso ele começaria
      // a carregar do localStorage antes de qualquer detecção assíncrona.
      body = Buffer.from(buf.toString("utf8").replace(
        "<div id=\"root\"></div>",
        "<div id=\"root\"></div>\n<script>window.CRB_BACKEND = window.location.origin;</script>"
      ));
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);

  if (url.pathname === "/health") return json(res, 200, { ok: true, db: DB_PATH });

  // Backup consistente sem parar o servidor — ver `backupTo` e a nota sobre
  // WAL no cabeçalho deste arquivo.
  if (url.pathname === "/api/backup" && req.method === "POST") {
    // O nome é do SERVIDOR e o destino é fixo: a rota não aceita caminho do
    // cliente. Ver a nota em BACKUP_DIR.
    try { return json(res, 200, { ok: true, ...backupTo(path.join(BACKUP_DIR, nomeDeBackup())) }); }
    catch (e) { return json(res, 400, { error: String(e.message || e) }); }
  }

  if (parts[0] !== "api") return serveStatic(req, res, url.pathname);

  // Versão de todas as coleções de uma vez: deixa o cliente descobrir o que
  // mudou com UMA requisição, em vez de uma por coleção a cada 5 segundos.
  if (parts[1] === "collections" && req.method === "GET") {
    const out = {};
    for (const row of q.allVersions.all()) out[row.collection] = row.version;
    return json(res, 200, out);
  }

  // Uma escrita que toca várias coleções ao mesmo tempo, tudo ou nada.
  // É o que "confirmar visita" usa: timepoint + reservas + baixa de estoque.
  if (parts[1] === "tx" && req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: e.message }); }
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (!changes.length) return json(res, 400, { error: "nenhuma mudança enviada" });
    for (const ch of changes) {
      if (!ch.collection || !COLLECTION_RE.test(ch.collection)) return json(res, 400, { error: `coleção inválida: ${ch.collection}` });
      if ((ch.upserts || []).some((it) => !it || it.id == null)) return json(res, 400, { error: "todo registro precisa de id" });
      if ((ch.deltas || []).some((d) => !d || d.id == null || !d.field)) return json(res, 400, { error: "todo delta precisa de id e field" });
      if ((ch.expects || []).some((e) => !e || e.id == null || (!e.field && !e.absent))) return json(res, 400, { error: "toda pré-condição precisa de id e field (ou absent)" });
      if ((ch.expects || []).some((e) => e.collection && !COLLECTION_RE.test(e.collection))) return json(res, 400, { error: "coleção inválida na pré-condição" });
    }
    try {
      const r = runTransaction(changes);
      if (r.conflicts) return json(res, 409, { error: "conflito", conflicts: r.conflicts });
      return json(res, 200, { versions: r.versions });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  const collection = parts[1];
  if (!collection || !COLLECTION_RE.test(collection)) return json(res, 400, { error: "coleção inválida" });

  if (req.method === "GET") {
    const version = versionOf(collection);
    // Nada mudou desde a última leitura: responde 304 e economiza a
    // serialização inteira. É o caminho da maioria absoluta dos polls.
    // Só vale quando `since` veio de verdade — sem o parâmetro, `Number(null)`
    // daria 0 e uma coleção vazia (versão 0) responderia 304 pra quem ainda
    // não tem dado nenhum, que é justamente quem mais precisa da carga.
    const sinceRaw = url.searchParams.get("since");
    if (sinceRaw !== null) {
      const since = Number(sinceRaw);
      if (Number.isFinite(since) && since === version) { res.writeHead(304).end(); return; }
    }
    return json(res, 200, { version, items: itemsOf(collection) });
  }

  if (req.method === "POST") {
    let body;
    try { body = await readBody(req); }
    catch (e) { return json(res, 400, { error: e.message }); }
    const upserts = Array.isArray(body.upserts) ? body.upserts : [];
    const deletes = Array.isArray(body.deletes) ? body.deletes : [];
    if (upserts.some((it) => !it || it.id == null)) return json(res, 400, { error: "todo registro precisa de id" });
    // Escrita condicional: só aplica se a coleção ainda estiver na versão que o
    // cliente viu. É o que impede dois clientes de semearem a mesma base vazia
    // ao mesmo tempo — o segundo leva 409 e adota o que o primeiro gravou, em
    // vez de misturar duas gerações de dados com IDs que não se cruzam.
    if (body.ifVersion != null) {
      const current = versionOf(collection);
      if (Number(body.ifVersion) !== current) {
        return json(res, 409, { error: "versão mudou", version: current, items: itemsOf(collection) });
      }
    }
    try {
      // Reservas passam pela regra de conflito antes de entrar, dentro da mesma
      // transação da escrita. É a última linha de defesa: o cliente também
      // checa, mas com dados que podem estar segundos atrasados — e a API pode
      // ser chamada direto, sem passar pela tela.
      const r = applyChanges(collection, upserts, deletes);
      if (r.conflicts) {
        return json(res, 409, { error: "conflito de agenda", conflicts: r.conflicts, version: versionOf(collection), items: itemsOf(collection) });
      }
      return json(res, 200, { version: r.version, applied: upserts.length + deletes.length });
    } catch (e) {
      return json(res, 500, { error: String(e.message || e) });
    }
  }

  return json(res, 405, { error: "método não suportado" });
});

/* Modo linha de comando: `node server.js --backup [arquivo]` gera a cópia e
 * sai, sem subir o servidor. Serve pra agendar no Task Scheduler / cron. */
if (process.argv.includes("--backup")) {
  const i = process.argv.indexOf("--backup");
  // No CLI o caminho é livre: quem roda isso já é dono da máquina.
  const destino = process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : path.join(BACKUP_DIR, nomeDeBackup());
  try {
    const r = backupTo(destino);
    console.log(`Backup gravado em ${r.path} (${r.bytes} bytes).`);
    process.exit(0);
  } catch (e) {
    console.error(`Backup falhou: ${e.message}`);
    process.exit(1);
  }
}

server.listen(PORT, () => {
  console.log(`Central de Recursos — servidor em http://localhost:${PORT}`);
  console.log(`Banco: ${DB_PATH}`);
  console.log(`Backup: POST /api/backup — não copie data.db à mão, o banco usa WAL.`);
});

/* Encerramento limpo: checkpoint mescla o `-wal` de volta no `data.db`, pra
 * quem for copiar o arquivo depois de parar o servidor levar tudo. Sem isso,
 * um `data.db` de 4 KB ao lado de um `-wal` de 750 KB é exatamente o que
 * faria alguém achar que tem backup e não ter. */
const encerrar = () => {
  try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch { /* nada a fazer no shutdown */ }
  try { db.close(); } catch {}
  process.exit(0);
};
process.on("SIGINT", encerrar);
process.on("SIGTERM", encerrar);
