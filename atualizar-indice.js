/* =======================================================================
   Atualiza o ÍNDICE do Cronogramas_v2.html
   =======================================================================

   O arquivo é um HTML único sem build, então o índice do topo é escrito à
   mão — e envelhece a cada bloco que muda de lugar. Já esteve 1.200 linhas
   defasado, apontando `KEYS` na linha 1061 quando ela estava na 2326. Um
   índice errado é pior que nenhum: manda a pessoa pro lugar errado com ar
   de certeza.

   Este script acha cada seção pelo código (não pelo número) e reescreve a
   lista com as linhas atuais.

   Rodar:  node atualizar-indice.js           (grava)
           node atualizar-indice.js --check   (só confere; sai 1 se defasou)

   Ao ADICIONAR uma seção nova ao arquivo, acrescente uma linha em `SECOES`
   aqui embaixo: rótulo, âncora (o trecho de código que começa a seção) e o
   recuo. O resto sai sozinho.
   ======================================================================= */
const fs = require("fs");
const path = require("path");

const HTML = path.join(__dirname, "Cronogramas_v2.html");
const CHECK = process.argv.includes("--check");

/* [recuo, rótulo, âncora]. Âncora `null` = linha de título, sem número. */
const SECOES = [
  [1, "Tokens (tema claro/escuro, CSS da splash/login)", /^const T = \{/],
  [1, "Helpers (funções puras: disponibilidade, tempos, custo, protocolo)", null],
  [2, "dayWindow / withinAvailability (horário por dia da semana)", /^function dayWindow\(/],
  [2, "activityTimes / blockedWindow (preparo, desmontagem, folga)", /^function activityTimes\(/],
  [2, "timepointWindow / protocolDeviation (protocolo D0+offset)", /^function timepointWindow\(/],
  [2, "bookingCost / cancellationOutcome / capacidade de sala", /^function bookingCost\(/],
  [1, "Seed data (dados de exemplo — inclui cenários de cada estado)", /^const ACTIVITY_NAMES = /],
  [2, "seedStudiesBundle (estudos, visitas, reservas, treino, h.extra)", /^function seedStudiesBundle\(/],
  [1, "Avisos", null],
  [2, "pendingActionsFor (quem é avisado do quê — regra pura, testada)", /^function pendingActionsFor\(/],
  [2, "useAvisos (contagem no menu, título da aba, balão do Windows)", /^function useAvisos\(/],
  [1, "Small UI atoms (Chip, Btn, SearchPick, ResourceCard...)", /^function Chip\(/],
  [1, "Main App", null],
  [2, "KEYS (nomes das coleções — viram tabelas no banco)", /^const KEYS = \{/],
  [2, "Capacidades / níveis de usuário (CAPABILITIES, USER_LEVELS)", /^const CAPABILITIES = \[/],
  [2, "EntryGate (tela de login: usuário + PIN)", /^function EntryGate\(/],
  [2, "App (estado, carregar/salvar, canI, roteamento das telas)", /^function App\(\)/],
  [1, "Dashboard / Painel (indicadores rápidos + alertas)", /^function Dashboard\(/],
  [1, "Motor de sugestão", null],
  [2, "suggestCombo (escolhe sala/equipe/equipamento pra um horário)", /^function suggestCombo\(/],
  [2, "planSameDay / planSpread (encadeiam as atividades do plano)", /^function planSameDay\(/],
  [1, "Assistente de planejamento", null],
  [2, "PlanItemRow / PlanCard (linha e card do plano sugerido)", /^function PlanItemRow\(/],
  [2, "TimepointPlanner (planejar uma visita)", /^function TimepointPlanner\(/],
  [2, 'BookingWizard (tela "Planejar estudo")', /^function BookingWizard\(/],
  [1, "Cronograma", null],
  [2, "AgendaView (grade do dia, com faixa fora do horário)", /^function AgendaView\(/],
  [2, "FloorPlanView (planta baixa)", /^function FloorPlanView\(/],
  [2, "BookingRow (linha de reserva, iniciar/finalizar)", /^function BookingRow\(/],
  [2, "EncaixeForm (reserva avulsa / pedido de hora extra)", /^function EncaixeForm\(/],
  [2, "Schedule (container: filtros + visão escolhida)", /^function Schedule\(/],
  [1, "Configurações", null],
  [2, "Registry (Cadastro)", /^function Registry\(/],
  [2, "CostsEditor (Custos)", /^function CostsEditor\(/],
  [2, "CalibrationPanel (Calibração)", /^function CalibrationPanel\(/],
  [2, "StockPanel (Estoque)", /^function StockPanel\(/],
  [2, "UserForm / UsersPanel (contas de login)", /^function UserForm\(/],
  [2, "PermissionsPanel (matriz de capacidades por nível)", /^function PermissionsPanel\(/],
  [2, "ActivityTimesPanel (tempos e intervalos por atividade)", /^function ActivityTimesPanel\(/],
  [2, "ScheduleHoursPanel (horário por dia da semana)", /^function ScheduleHoursPanel\(/],
  [2, "ConfigArea (junta os painéis acima em sub-abas)", /^function ConfigArea\(/],
  [1, "EstimatesView (Estimativas — orçamento, pré-reserva, conversão)", /^function EstimatesView\(/],
  [1, "CalendarView (Calendário — férias, folgas, feriados, manutenção)", /^function CalendarView\(/],
  [1, "Estudos", null],
  [2, "StudyForm (cadastro do protocolo: D0 + visitas por offset)", /^function StudyForm\(/],
  [2, "StudiesView (lista, situação, desvio de protocolo)", /^function StudiesView\(/],
  [1, "Estudo — cadastrar, planejar e acompanhar num lugar só", null],
  [2, "visitaSituacao / disponibilidadeNoDia (regras da tela)", /^function visitaSituacao\(/],
  [2, "PainelDisponibilidade (quem está livre, cedível, sob pedido)", /^function PainelDisponibilidade\(/],
  [2, "LimiteDeErro (uma falha aqui não derruba o sistema)", /^class LimiteDeErro/],
  [2, "EstudoView (a moldura que junta cadastro, plano e acompanhamento)", /^function EstudoView\(/],
  [1, "HistoryView (Histórico / auditoria)", /^function HistoryView\(/],
  [1, "MeuDiaView (Meu dia — visão dia e semana)", /^function MeuDiaView\(/],
  [1, "TrainingBoard (Treinamentos)", /^function TrainingBoard\(/],
  [1, "OvertimeBoard (Horas Extras — fluxo de 2 passos)", /^function OvertimeBoard\(/],
  [1, "IndicatorsView (Indicadores — só gestão)", /^function IndicatorsView\(/],
  [1, "ItemForm (formulário genérico de todas as categorias do Cadastro)", /^function ItemForm\(/],
  [1, "Bootstrap (ReactDOM.createRoot)", /^const root = ReactDOM\.createRoot/],
];

const CABECALHO = ` * ATENÇÃO: arquivo único sem build, então estes números envelhecem a cada
 * edição — este índice já esteve 1.200 linhas defasado, apontando KEYS na
 * l. 1061 quando ela estava na 2326, e um índice errado é pior que nenhum,
 * porque manda a pessoa pro lugar errado com ar de certeza. Se o número não
 * bater, o TÍTULO ainda bate: procure pelo nome. E, ao mover um bloco de
 * lugar, \`node atualizar-indice.js\` reescreve esta lista sozinho.
 *
 *   (Persistência: fica ANTES daqui, no primeiro <script> — é o único ponto
 *    a trocar pra ir pra banco/servidor. Vale ler antes de mexer no resto.)
 *`;

/* Reescrever o índice MUDA os números que ele acabou de calcular: o bloco
 * cresce ou encolhe e empurra todo o arquivo abaixo dele. Por isso isto roda
 * até estabilizar, em vez de uma vez só — senão toda alteração exigiria rodar
 * o comando duas vezes, e a segunda é justamente a que todo mundo esquece.
 * Converge em duas passadas na prática; o limite existe só pra não girar pra
 * sempre se alguma âncora nova entrar em conflito. */
const MARCA = "======================================================================== */";

function montar(src) {
  const linhas = src.split("\n");
  const faltando = [];
  const corpo = SECOES.map(([nivel, rotulo, ancora]) => {
    const recuo = nivel === 1 ? "   " : "     ";
    if (!ancora) return ` *${recuo}${rotulo}`;
    const i = linhas.findIndex((l) => ancora.test(l));
    if (i < 0) { faltando.push(rotulo); return ` *${recuo}${rotulo} ... (não encontrado)`; }
    const texto = `${recuo}${rotulo} `;
    const marca = ` l. ${i + 1}`;
    // Pontilhado até a coluna 72, como no índice original; rótulo longo só
    // ganha um espaço, sem quebrar a linha.
    const pontos = Math.max(1, 72 - texto.length - marca.length);
    return ` *${texto}${".".repeat(pontos)}${marca}`;
  }).join("\n");

  const novo = `/* ========================================================================
 * ÍNDICE — seções principais deste arquivo, em ordem, com a linha de cada
 * uma. Busque pelo título abaixo (Ctrl+F) pra pular direto pro bloco; cada
 * um tem seu próprio comentário-cabeçalho no código.
 *
${CABECALHO}
${corpo}
 * ${MARCA}`;

  const inicio = src.indexOf("/* ========================================================================\n * ÍNDICE");
  if (inicio < 0) throw new Error("não achei o bloco do ÍNDICE no HTML");
  const fim = src.indexOf(MARCA, inicio);
  return { antigo: src.slice(inicio, fim + MARCA.length), novo, faltando };
}

let src = fs.readFileSync(HTML, "utf8");
let passadas = 0;
let mudou = false;
for (let i = 0; i < 6; i++) {
  const r = montar(src);
  if (r.faltando.length) {
    console.error(`Seções que não foram encontradas no arquivo (âncora mudou?):\n  · ${r.faltando.join("\n  · ")}`);
    process.exit(1);
  }
  if (r.antigo === r.novo) break;
  if (CHECK) {
    console.error("O índice está DEFASADO. Rode: node atualizar-indice.js");
    process.exit(1);
  }
  src = src.replace(r.antigo, r.novo);
  mudou = true;
  passadas++;
}

if (!mudou) { console.log("O índice já está em dia."); process.exit(0); }
fs.writeFileSync(HTML, src);
console.log(`Índice atualizado — ${SECOES.filter((s) => s[2]).length} seções, ${passadas} passada(s).`);
