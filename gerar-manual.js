/* Gera o manual de uso em Word. Rodar: node gerar-manual.js */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, convertInchesToTwip,
} = require("docx");

const TEAL = "0E7C7B", TEAL_ESC = "0A5E5D", TINTA = "10232B", CINZA = "4B5F66";
const LINHA = "D7E2E2", FUNDO = "F2F6F6";
const AMBAR = "C1812E", AMBAR_F = "F8ECD9", VERMELHO = "B0402A", VERM_F = "F7E4DD";
const VERDE_F = "E4F1F0";
const L = 9360;

const titulo = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 130 },
  children: [new TextRun({ text: t, bold: true, size: 30, color: TEAL_ESC, font: "Calibri" })] });
const sub = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 90 },
  children: [new TextRun({ text: t, bold: true, size: 24, color: TINTA, font: "Calibri" })] });
const forte = (t) => new TextRun({ text: t, bold: true, size: 22, color: TINTA, font: "Calibri" });
const normal = (t) => new TextRun({ text: t, size: 22, color: TINTA, font: "Calibri" });
const mono = (t) => new TextRun({ text: t, size: 20, font: "Consolas", color: TEAL_ESC });
const p = (t, o = {}) => new Paragraph({ spacing: { after: o.after ?? 120, line: 276 },
  children: Array.isArray(t) ? t : [normal(t)] });
const passo = (t) => new Paragraph({ numbering: { reference: "passos", level: 0 }, spacing: { after: 90, line: 276 },
  children: Array.isArray(t) ? t : [normal(t)] });
const item = (t) => new Paragraph({ numbering: { reference: "pontos", level: 0 }, spacing: { after: 90, line: 276 },
  children: Array.isArray(t) ? t : [normal(t)] });
const comando = (t) => new Paragraph({ spacing: { before: 90, after: 90 },
  shading: { type: ShadingType.CLEAR, fill: FUNDO },
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: TEAL } },
  indent: { left: 120, right: 120 },
  children: [new TextRun({ text: t, font: "Consolas", size: 20, color: TINTA })] });

const caixa = (rot, linhas, cor = AMBAR, fundo = AMBAR_F) => new Table({
  columnWidths: [L], width: { size: L, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: cor },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: cor },
    left: { style: BorderStyle.SINGLE, size: 18, color: cor },
    right: { style: BorderStyle.SINGLE, size: 2, color: cor },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  },
  rows: [new TableRow({ children: [new TableCell({
    width: { size: L, type: WidthType.DXA },
    shading: { type: ShadingType.CLEAR, fill: fundo },
    margins: { top: 130, bottom: 130, left: 150, right: 150 },
    children: [
      new Paragraph({ spacing: { after: 55 }, children: [new TextRun({ text: rot, bold: true, size: 21, color: cor, font: "Calibri", allCaps: true })] }),
      ...linhas.map((x) => new Paragraph({ spacing: { after: 55, line: 264 },
        children: Array.isArray(x) ? x : [new TextRun({ text: x, size: 21, color: TINTA, font: "Calibri" })] })),
    ],
  })] })],
});

const tabela = (cab, linhas, larg) => new Table({
  columnWidths: larg, width: { size: L, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  },
  rows: [
    new TableRow({ tableHeader: true, children: cab.map((t, i) => new TableCell({
      width: { size: larg[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: FUNDO },
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 21, color: TEAL_ESC, font: "Calibri" })] })],
    })) }),
    ...linhas.map((ln) => new TableRow({ children: ln.map((cel, i) => new TableCell({
      width: { size: larg[i], type: WidthType.DXA },
      margins: { top: 90, bottom: 90, left: 130, right: 130 },
      children: [new Paragraph({ spacing: { line: 264 },
        children: Array.isArray(cel) ? cel : [new TextRun({ text: cel, size: 21, color: TINTA, font: "Calibri" })] })],
    })) })),
  ],
});

const regua = () => new Paragraph({ spacing: { before: 180, after: 180 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINHA } },
  children: [new TextRun({ text: "", size: 2 })] });

const doc = new Document({
  creator: "Central de Recursos",
  title: "Central de Recursos — Manual de uso",
  numbering: { config: [
    { reference: "passos", levels: [{ level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
    { reference: "pontos", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.START,
      style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } } }] },
  ] },
  sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    children: [
      /* ---------------- capa ---------------- */
      new Paragraph({ spacing: { after: 55 }, children: [new TextRun({ text: "CENTRAL DE RECURSOS", bold: true, size: 20, color: TEAL, font: "Calibri", characterSpacing: 40 })] }),
      new Paragraph({ spacing: { after: 110 }, children: [new TextRun({ text: "Manual de uso", bold: true, size: 44, color: TINTA, font: "Calibri" })] }),
      new Paragraph({ spacing: { after: 220 }, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL } },
        children: [new TextRun({ text: "O que o programa faz, como se usa, e o que ele ainda não faz — versão 3.4", size: 24, color: CINZA, font: "Calibri", italics: true })] }),

      p([forte("Para que serve. "), normal("Agendar salas, equipe, médicos e equipamentos dos estudos do setor, respeitando o protocolo de cada um: quantos dias depois do D0 cada visita acontece, qual a tolerância, quem está habilitado para cada método, qual aparelho está calibrado e quem está de férias.")]),
      p([normal("Ele substitui a planilha compartilhada em três coisas que planilha não faz: "), forte("impede"), normal(" dois estudos de marcarem a mesma sala no mesmo horário, "), forte("sugere"), normal(" o encaixe em vez de exigir que alguém procure, e "), forte("avisa"), normal(" quando um prazo de protocolo está para vencer sem ninguém ter marcado.")], { after: 220 }),

      /* ---------------- começar ---------------- */
      titulo("1. Como abrir"),
      p("Há dois modos, e a diferença entre eles é quem enxerga os dados."),
      tabela(["Modo", "Como abrir", "Quem vê os dados"], [
        ["Sozinho (teste)", "Dois cliques no Cronogramas_v2.html", "Só você, naquele computador. Os dados ficam guardados no navegador."],
        ["Em rede (uso real)", [mono("node server.js"), normal(" e abrir "), mono("http://localhost:8124")], "Todo mundo que abrir o endereço. Os dados ficam num banco único."],
      ], [1800, 3300, 4260]),
      caixa("A diferença que mais confunde", [
        [forte("Abrir o arquivo com dois cliques não conversa com o servidor."), normal(" Cada computador fica com a sua própria cópia dos dados, guardada no navegador. Duas pessoas testando assim não enxergam o trabalho uma da outra.")],
        [normal("Para trabalharem juntos, uma máquina roda o servidor e as outras abrem o endereço dela. Nunca o arquivo.")],
      ]),
      p([forte("Primeiro acesso: "), normal("o sistema já vem com o cadastro pronto — salas, equipamentos, métodos, insumos, patrocinadores e equipe — e "), forte("sem nenhum estudo"), normal(". O cadastro é infraestrutura e pode ser editado; o trabalho é seu.")]),
      p([normal("Entre como "), forte("Administrador"), normal(". O PIN de todas as contas é "), forte("1234"), normal(".")], { after: 220 }),

      /* ---------------- o caminho ---------------- */
      titulo("2. O caminho de sempre"),
      p("Tudo que diz respeito a um estudo está na tela Estudos: cadastrar, planejar e acompanhar."),
      passo([forte("Estudos → Novo estudo. "), normal("O cadastro pergunta pouco de propósito: código/nome do protocolo, patrocinador, o modelo de protocolo (que já preenche as visitas no formato mais usado), o período combinado com o cliente e os grupos de participantes. Só isso.")]),
      passo([forte("Clique na visita, na coluna da esquerda. "), normal("A bolha diz a situação sem precisar abrir: verde completa, âmbar falta alguém, cinza nem começou.")]),
      passo([forte("Acrescente uma atividade. "), normal("Escolha o método e a hora. A reserva nasce na hora, com a sala já escolhida pelo sistema e sem equipe — e fica marcada como incompleta, que é o que ela é.")]),
      passo([forte("Preencha pela coluna da direita. "), normal("Ela mostra, para a atividade selecionada, quem está livre, que salas atendem o método e que aparelhos estão calibrados. Um clique escala. “Preencher o que falta” faz isso de uma vez em toda a visita.")]),
      passo([forte("Repita. "), normal("Atividade acrescentada no MESMO horário fica na mesma sala da anterior e as duas aparecem num quadro só — é como acontece na prática, com as voluntárias numa sala e as medições rodando ali.")]),

      caixa("Três campos que sumiram do cadastro — de propósito", [
        [forte("Situação, data do D0 e técnico do estudo não são mais perguntados."), normal(" Os três já estão escritos na agenda, e perguntar de novo era pedir que alguém repetisse o que o sistema sabe — com a chance de as duas respostas divergirem. Estudo marcado “em planejamento” com dez visitas agendadas é pior que não ter campo nenhum.")],
        [normal("A "), forte("situação"), normal(" sai do que está marcado: sem reserva é planejamento, com reserva é ativo, tudo concluído é concluído. O "), forte("D0"), normal(" é o começo do período combinado enquanto a primeira visita não estiver marcada; o dia em que ela entra na agenda vira o D0 de verdade, e todas as outras visitas se reposicionam. O "), forte("técnico"), normal(" é quem for escalado na primeira visita de cada atividade mestre — e a partir daí é ele até o fim.")],
      ], TEAL, VERDE_F),
      p([normal("A coluna da direita mostra "), forte("quem está livre naquele dia"), normal(" e, para quem não está, em que atividade e de qual estudo.")]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      sub("Quando falta gente, sala ou aparelho"),
      p([normal("A coluna da direita tem três listas — "), forte("Equipe"), normal(", "), forte("Salas"), normal(" e "), forte("Equipamentos"), normal(" — e todas são da atividade selecionada, nunca do dia em geral: a mesma sala atende um método e não atende outro, e o nível exigido muda quem pode entrar.")]),
      p([normal("Nada some da lista sem dizer por quê. Quem não tem nível continua aparecendo, com o que falta e um botão que "), forte("manda o pedido de treinamento"), normal(" já preenchido. Quem está fora do próprio horário aparece com o botão de "), forte("hora extra"), normal(". Sala que não atende o método aparece marcada como tal. Uma lista que esconde quem quase pode esconde também a solução.")]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      sub("Preencher uma vaga com quem já está ocupado"),
      p([normal("Quando uma atividade da visita fica sem gente suficiente, ela aparece no alto da coluna da direita, em "), forte("\u201cpreencher a vaga de\u201d"), normal(". A partir daí cada pessoa da lista ganha o botão que a regra permite — e é a regra cadastrada na atividade "), forte("de onde a pessoa sairia"), normal(" que decide, não o seu cargo.")]),
      tabela(["Situação", "O que aparece", "O que acontece ao clicar"], [
        ["Livre", "escolher", "Entra na vaga na hora."],
        [[forte("Cedível")], "puxar", "Sai de onde estava e entra aqui, imediatamente, sem pedir nada a ninguém. A reserva de origem volta a aparecer como incompleta, para o outro agendador ver."],
        ["Precisa pedir", "pedir", "Cria uma solicitação. Nada muda na agenda até o outro agendador aceitar."],
        ["Não sai", "(nenhum botão)", "Atividade mestre, atividade já iniciada ou ausência. Não há caminho — nem pedindo."],
      ], [1900, 1700, 5760]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),
      p([forte("Do outro lado. "), normal("O pedido aparece em "), forte("Pedidos de equipe"), normal(", na tela Estudos, para quem tem permissão de planejar — e vira aviso no sino. Quem recebe vê de onde a pessoa sairia e responde: "), forte("Aceitar e remanejar"), normal(" faz a troca na mesma gravação em que marca o pedido como aceito; "), forte("Recusar"), normal(" devolve uma resposta escrita. Quem pediu acompanha o resultado e pode cancelar enquanto ninguém respondeu.")]),
      caixa("Cedível é configuração, não improviso", [
        [normal("Quais atividades são cedíveis e quais são mestres se marca em "), forte("Configurações → Cadastro → Atividades"), normal(". O sistema já vem com um combinado razoável — Apoio e Fluxo cedíveis, as avaliações com aparelho como mestres — mas quem manda é o seu setor.")],
        [normal("Marcar uma atividade como cedível é dizer, de uma vez, que qualquer agendador pode tirar gente dali. É por isso que \u201cpuxar\u201d não pede autorização: ela já foi dada no cadastro.")],
      ], TEAL, VERDE_F),
      new Paragraph({ spacing: { after: 220 }, children: [] }),

      /* ---------------- regras ---------------- */
      titulo("3. As regras que o sistema impõe"),
      p("Estas não são avisos que dá para ignorar: o sistema recusa a gravação."),
      tabela(["Regra", "Por que existe"], [
        ["Ninguém entra numa vaga sem sair de onde estava",
         "Puxar e aceitar um pedido gravam a saída e a entrada juntas. Em duas gravações separadas, uma falha no meio deixaria a pessoa em lugar nenhum — ou nos dois ao mesmo tempo."],
        ["Duas reservas não podem disputar a mesma sala, pessoa, médico ou equipamento no mesmo horário",
         "É a razão de o sistema existir. A conta considera preparo e desmontagem, não só a execução."],
        ["Quem executa precisa ter o nível mínimo do método",
         "Escalar quem não foi treinado é o erro que a planilha não pegava."],
        ["Equipamento com calibração vencida não é escalado",
         "Medida feita com aparelho fora de validade não vale, e só se descobre depois."],
        ["Ninguém é escalado durante férias, folga, feriado ou manutenção",
         "Ausência não se resolve com hora extra: a pessoa não está."],
        [[forte("Atividade mestre: "), normal("a equipe não pode ser trocada")],
         "Nessas atividades a leitura depende de quem executa. Trocar no meio do protocolo introduz variação entre medidas que deveriam ser comparáveis."],
        [[forte("Quem começa a operar um equipamento termina o estudo com ele")],
         "Assim que o aparelho roda na mão de alguém, a série de medidas passa a carregar o jeito daquela pessoa. Antes de começar dá para trocar — mas o substituto assume todas as visitas do estudo, nunca só uma."],
      ], [3400, 5960]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      /* ---------------- telas ---------------- */
      titulo("4. As telas"),
      tabela(["Tela", "Para que serve"], [
        ["Painel", "Onde você aterrissa. Mostra o dia, os alertas e o que exige ação."],
        ["Estudos", "Cadastrar, montar a visita atividade por atividade, acompanhar e negociar equipe. É o centro do sistema."],
        ["Cronograma", "O dia em três vistas: agenda em grade, por sala (cada quadro é uma sala com tudo que acontece dentro) e planta baixa. No alto, o dia em números; abaixo, filtros por estudo, patrocinador, atividade, sala, equipamento, pessoa e situação."],
        ["Estimativas", "Orçamento antes de virar estudo. Dá para segurar recursos por um prazo e converter depois."],
        ["Calendário", "Férias, folgas, feriados, eventos e manutenção do ano."],
        ["Treinamentos", "Pedidos de treinamento e agendamento das aulas. Concluir a aula sobe o nível da pessoa."],
        ["Horas Extras", "Pedido, resposta da pessoa e aprovação da gestão."],
        ["Meu dia", "A agenda pessoal de quem está logado, com iniciar e finalizar."],
        ["Indicadores", "Custo, ocupação, perdas por cancelamento e conversão de estimativas."],
        ["Configurações", "Cadastro, calibração, estoque, custos, horários, usuários e permissões."],
        ["Histórico", "Quem mexeu em quê e quando."],
      ], [2200, 7160]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      /* ---------------- não faz ---------------- */
      titulo("5. O que o programa NÃO faz"),
      p("Vale ler antes de decidir usar em produção. Nada aqui é defeito escondido — são limites conhecidos."),

      caixa("Não tem segurança de verdade", [
        [forte("O PIN é conferido no navegador, não no servidor."), normal(" Isso é identificação (“quem é você”), não segurança (“prove”). Quem alcança o endereço consegue ler tudo e entrar como qualquer usuário, inclusive Administrador — e os PINs de todos ficam legíveis.")],
        [normal("Serve para rede interna, entre colegas, com dados de teste. "), forte("Não serve exposto na internet, nem com dado real de voluntário."), normal(" Para isso faltam: login conferido no servidor, PIN guardado com hash e HTTPS.")],
      ], VERMELHO, VERM_F),

      p(""),
      item([forte("Não funciona sem internet. "), normal("A tela é montada com bibliotecas baixadas de fora (React, Tailwind e as fontes). Sem rede, ou com firewall bloqueando esses endereços, a página abre em branco e não aparece mensagem nenhuma explicando.")]),
      item([forte("Não avisa no Windows pela rede. "), normal("A notificação do sistema operacional exige HTTPS. Em rede interna por http, o sino fica apagado — mas a contagem no menu e o título da aba funcionam normalmente.")]),
      item([forte("Não negocia sozinho. "), normal("Puxar e pedir existem, mas quem decide é sempre uma pessoa: o sistema não sai remanejando equipe para otimizar a agenda por conta própria.")]),
      item([forte("Não conversa fora do sistema. "), normal("O pedido de equipe aparece para quem abrir o programa e para quem estiver com ele aberto. Não sai e-mail, não sai mensagem no celular.")]),
      item([forte("Não arrasta para reagendar. "), normal("A agenda é de leitura; mudar horário é pela edição da reserva.")]),
      item([forte("Não importa nem exporta planilha."), normal(" Nem gera relatório em PDF.")]),
      item([forte("Não guarda dado de voluntário. "), normal("O sistema trabalha com quantidades e grupos, nunca com nomes de participantes — de propósito.")]),
      new Paragraph({ spacing: { after: 200 }, children: [] }),

      /* ---------------- cuidados ---------------- */
      titulo("6. Cuidados"),
      caixa("Backup: não copie o arquivo do banco à mão", [
        [normal("O banco usa um modo em que as gravações recentes ficam num arquivo à parte ("), mono("data.db-wal"), normal("). Copiar só o "), mono("data.db"), normal(" pode gerar um backup vazio "), forte("que parece bom"), normal(" — o arquivo existe e tem tamanho.")],
        [normal("Use o comando, que gera uma cópia consistente mesmo com o servidor no ar:")],
      ]),
      comando("node server.js --backup"),
      p([forte("Trocar o técnico do estudo muda todas as visitas futuras. "), normal("O sistema mostra o plano antes de aplicar: quantas visitas mudam, quais já aconteceram e ficam como estão, e onde o substituto tem conflito de agenda. Se houver conflito, a troca não é aplicada pela metade.")]),
      p([forte("Mudar o tamanho de um grupo não reescreve o passado. "), normal("Reservas que já aconteceram guardam o número que valia no dia. As futuras são apontadas para você decidir.")], { after: 200 }),

      regua(),
      titulo("7. Contas e permissões"),
      p("O menu de cada pessoa sai da matriz de permissões, editável pelo Admin em Configurações → Permissões. Quem pode aprovar prazo é quem recebe o aviso de prazo — a mesma configuração governa as duas coisas."),
      tabela(["Conta", "O que enxerga"], [
        ["Administrador", "Tudo, inclusive Usuários e Permissões"],
        ["Gestor", "Indicadores, Estimativas, Configurações, Cadastro e aprovações"],
        ["Agendador", "Estudos, Estimativas e Cronograma"],
        ["Equipe de Treinamento", "Treinamentos e o dia a dia"],
        ["Colaborador ou médico, pelo nome", "Meu dia e o dia a dia"],
      ], [3000, 6360]),
      p([new TextRun({ text: "O PIN de todas as contas de teste é 1234. Em uso real, troque em Configurações → Usuários — lembrando do limite descrito no item 5.", size: 20, color: CINZA, font: "Calibri", italics: true })], { after: 120 }),

      regua(),
      p([new TextRun({ text: "Versão 3.4 · a versão aparece na tela de login e na barra lateral. Se o que você está vendo não bate com este manual, confira ali primeiro: quase sempre é uma cópia antiga do arquivo.", size: 20, color: CINZA, font: "Calibri", italics: true })]),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("Central de Recursos - Manual de uso.docx", buf);
  console.log("gerado");
});
