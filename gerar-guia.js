/* Gera o guia de instalação em Word. Rodar: node gerar-guia.js */
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  LevelFormat, convertInchesToTwip,
} = require("docx");

/* ---- paleta, a mesma do sistema ---- */
const TEAL = "0E7C7B";
const TEAL_ESCURO = "0A5E5D";
const TINTA = "10232B";
const CINZA = "4B5F66";
const LINHA = "D7E2E2";
const FUNDO_CODIGO = "F2F6F6";
const AMBAR = "C1812E";
const AMBAR_FUNDO = "F8ECD9";
const VERMELHO = "B0402A";

const LARGURA_TEXTO = 9360; // 6,5" em DXA (Carta com margens de 1")

/* ---- blocos ---- */
const titulo = (texto) => new Paragraph({
  heading: HeadingLevel.HEADING_1,
  spacing: { before: 360, after: 140 },
  children: [new TextRun({ text: texto, bold: true, size: 30, color: TEAL_ESCURO, font: "Calibri" })],
});

const subtitulo = (texto) => new Paragraph({
  heading: HeadingLevel.HEADING_2,
  spacing: { before: 240, after: 100 },
  children: [new TextRun({ text: texto, bold: true, size: 24, color: TINTA, font: "Calibri" })],
});

const p = (texto, opts = {}) => new Paragraph({
  spacing: { after: opts.after ?? 120, line: 276 },
  children: Array.isArray(texto) ? texto : [new TextRun({ text: texto, size: 22, color: TINTA, font: "Calibri" })],
});

const forte = (t) => new TextRun({ text: t, bold: true, size: 22, color: TINTA, font: "Calibri" });
const normal = (t) => new TextRun({ text: t, size: 22, color: TINTA, font: "Calibri" });
const mono = (t) => new TextRun({ text: t, size: 20, font: "Consolas", color: TEAL_ESCURO });

/* Comando: fundo claro, monoespaçado, com respiro. É o que a pessoa vai
 * digitar, então tem que saltar da página. */
const comando = (texto) => new Paragraph({
  spacing: { before: 100, after: 100 },
  shading: { type: ShadingType.CLEAR, fill: FUNDO_CODIGO },
  /* Só a barra da esquerda, de propósito. O schema do Word exige as bordas de
   * parágrafo na ordem top → left → bottom → right, e o docx-js as emite
   * sempre em top → bottom → left → right — então qualquer caixa que combine
   * `bottom` com `left` gera um arquivo que abre no Word mas não valida.
   * A barra sozinha, com o fundo claro, marca o bloco igual e é válida. */
  border: { left: { style: BorderStyle.SINGLE, size: 18, color: TEAL } },
  indent: { left: 120, right: 120 },
  children: [new TextRun({ text: texto, font: "Consolas", size: 20, color: TINTA })],
});

const passo = (texto) => new Paragraph({
  numbering: { reference: "passos", level: 0 },
  spacing: { after: 100, line: 276 },
  children: Array.isArray(texto) ? texto : [normal(texto)],
});

const marcador = (texto) => new Paragraph({
  numbering: { reference: "pontos", level: 0 },
  spacing: { after: 100, line: 276 },
  children: Array.isArray(texto) ? texto : [normal(texto)],
});

/* Caixa de atenção. Usada com parcimônia: se tudo é aviso, nada é aviso. */
const atencao = (rotulo, corpo, cor = AMBAR, fundo = AMBAR_FUNDO) => new Table({
  columnWidths: [LARGURA_TEXTO],
  width: { size: LARGURA_TEXTO, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: cor },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: cor },
    left: { style: BorderStyle.SINGLE, size: 18, color: cor },
    right: { style: BorderStyle.SINGLE, size: 2, color: cor },
    insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  },
  rows: [new TableRow({
    children: [new TableCell({
      width: { size: LARGURA_TEXTO, type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: fundo },
      margins: { top: 140, bottom: 140, left: 160, right: 160 },
      children: [
        new Paragraph({
          spacing: { after: 60 },
          children: [new TextRun({ text: rotulo, bold: true, size: 21, color: cor, font: "Calibri", allCaps: true })],
        }),
        ...(Array.isArray(corpo) ? corpo : [corpo]).map((linha) => new Paragraph({
          spacing: { after: 60, line: 264 },
          children: Array.isArray(linha) ? linha : [new TextRun({ text: linha, size: 21, color: TINTA, font: "Calibri" })],
        })),
      ],
    })],
  })],
});

/* Tabela simples de duas colunas. */
const tabela = (cabecalho, linhas, larguras) => new Table({
  columnWidths: larguras,
  width: { size: LARGURA_TEXTO, type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    bottom: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: LINHA },
    insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  },
  rows: [
    new TableRow({
      tableHeader: true,
      children: cabecalho.map((t, i) => new TableCell({
        width: { size: larguras[i], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: FUNDO_CODIGO },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 21, color: TEAL_ESCURO, font: "Calibri" })] })],
      })),
    }),
    ...linhas.map((linha) => new TableRow({
      children: linha.map((celula, i) => new TableCell({
        width: { size: larguras[i], type: WidthType.DXA },
        margins: { top: 100, bottom: 100, left: 140, right: 140 },
        children: [new Paragraph({
          spacing: { line: 264 },
          children: Array.isArray(celula) ? celula : [new TextRun({ text: celula, size: 21, color: TINTA, font: "Calibri" })],
        })],
      })),
    })),
  ],
});

const linhaFina = () => new Paragraph({
  spacing: { before: 200, after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINHA } },
  children: [new TextRun({ text: "", size: 2 })],
});

/* ---------------------------------------------------------------- */
const doc = new Document({
  creator: "Central de Recursos",
  title: "Central de Recursos — Guia de teste em rede",
  description: "Passo a passo para rodar o sistema no PC e acessar de outra máquina",
  numbering: {
    config: [
      {
        reference: "passos",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
      {
        reference: "pontos",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.25) } } },
        }],
      },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 }, // Carta
        margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      },
    },
    children: [
      /* ---------------- capa ---------------- */
      new Paragraph({
        spacing: { after: 60 },
        children: [new TextRun({ text: "CENTRAL DE RECURSOS", bold: true, size: 20, color: TEAL, font: "Calibri", characterSpacing: 40 })],
      }),
      new Paragraph({
        spacing: { after: 120 },
        children: [new TextRun({ text: "Guia de teste em rede", bold: true, size: 44, color: TINTA, font: "Calibri" })],
      }),
      new Paragraph({
        spacing: { after: 240 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: TEAL } },
        children: [new TextRun({
          text: "Como rodar o sistema no seu computador e acessar de outra máquina da empresa",
          size: 24, color: CINZA, font: "Calibri", italics: true,
        })],
      }),

      p([
        normal("Antes de começar, o mais importante: "),
        forte("o banco de dados não vai para a internet."),
        normal(" Ele continua sendo um arquivo no seu computador. O que você faz aqui é deixar o seu PC atender o navegador da outra pessoa pela rede da empresa — o seu computador vira o servidor, e os outros só abrem um endereço no navegador."),
      ]),
      p([
        normal("Isso significa duas coisas na prática: enquanto o seu PC estiver ligado e com o servidor rodando, todo mundo enxerga os mesmos dados; quando você desliga, ninguém acessa. Para um teste, é exatamente o que se quer."),
      ], { after: 240 }),

      /* ---------------- 1 ---------------- */
      titulo("1. Preparar o computador"),

      subtitulo("Node.js"),
      p("Abra o PowerShell (menu Iniciar, digite “powershell”) e digite:"),
      comando("node --version"),
      p([
        normal("Se aparecer "), mono("v22"), normal(" ou maior, está pronto. Se der erro, ou se o número for v20 ou menor, baixe em "),
        forte("nodejs.org"), normal(" (o botão LTS) e instale clicando em "), forte("Next"), normal(" até o fim — não precisa mudar nenhuma opção."),
      ]),

      subtitulo("Os arquivos"),
      p([
        normal("No GitHub, clique no botão verde "), forte("Code"), normal(" e depois em "), forte("Download ZIP"),
        normal(". Extraia numa pasta de caminho curto, como "), mono("C:\\Cronogramas"),
        normal(". Nessa máquina não é preciso instalar o Git."),
      ], { after: 240 }),

      /* ---------------- 2 ---------------- */
      titulo("2. Gerar os dados e subir o servidor"),
      p("No PowerShell, um comando de cada vez:"),
      comando("cd C:\\Cronogramas"),
      comando("node demo-seed.js --force"),
      comando("node server.js"),
      p([
        normal("Deve aparecer a mensagem "),
        mono("Central de Recursos — servidor em http://localhost:8124"),
        normal("."),
      ]),

      atencao("Deixe essa janela aberta", [
        [forte("Fechar o PowerShell desliga o servidor"), normal(" e derruba todo mundo. Deixe a janela aberta durante o teste inteiro — pode minimizar, mas não fechar.")],
        [normal("Para parar o servidor quando terminar: clique na janela e aperte "), mono("Ctrl + C"), normal(".")],
      ]),

      p([
        normal("Antes de chamar alguém, teste você mesmo: abra "),
        forte("http://localhost:8124"),
        normal(" no navegador do seu PC e entre como "), forte("Administrador"), normal(" com o PIN "), forte("1234"), normal(" — o PIN é 1234 para todas as contas"),
        normal(". Se funcionar aqui, qualquer problema seguinte é de rede, não do sistema — e isso já economiza metade do tempo de procura."),
      ], { after: 240 }),

      /* ---------------- 3 ---------------- */
      titulo("3. Descobrir o endereço do seu PC"),
      p([
        normal("Abra "), forte("outra"), normal(" janela do PowerShell — a primeira está ocupada com o servidor — e digite:"),
      ]),
      comando("ipconfig"),
      p([
        normal("Procure a linha "), forte("Endereço IPv4"), normal(", algo como "), mono("192.168.1.47"),
        normal(". Esse é o endereço do seu computador na rede da empresa. O endereço que a outra pessoa vai usar é esse número seguido de "), mono(":8124"), normal(":"),
      ]),
      comando("http://192.168.1.47:8124"),
      p([new TextRun({ text: "Troque 192.168.1.47 pelo número que apareceu no seu ipconfig.", size: 21, color: CINZA, font: "Calibri", italics: true })], { after: 240 }),

      /* ---------------- 4 ---------------- */
      titulo("4. Liberar no firewall"),
      p([
        forte("Este é o passo que trava quase todo mundo."),
        normal(" O Windows bloqueia conexões vindas de fora por padrão, então o servidor pode estar funcionando perfeitamente e ainda assim ninguém conseguir abrir. Há dois caminhos:"),
      ]),

      subtitulo("Se apareceu a janela do firewall"),
      p([
        normal("Logo que você rodou "), mono("node server.js"),
        normal(", o Windows pode ter perguntado se permite o acesso. Marque "),
        forte("Redes privadas"), normal(" e clique em "), forte("Permitir acesso"), normal(". Pronto, nada mais a fazer."),
      ]),

      subtitulo("Se não apareceu nada (ou você clicou em Cancelar)"),
      p("Crie a regra na mão:"),
      passo("Menu Iniciar → digite “powershell”"),
      passo([
        normal("Clique com o "), forte("botão direito"), normal(" em Windows PowerShell → "), forte("Executar como administrador"),
      ]),
      passo("Cole o comando abaixo e aperte Enter:"),
      comando('New-NetFirewallRule -DisplayName "Central de Recursos 8124" -Direction Inbound -LocalPort 8124 -Protocol TCP -Action Allow -Profile Private'),
      p([
        normal("Se a resposta for um bloco de texto começando com "), mono("Name :"), normal(", deu certo."),
      ], { after: 240 }),

      /* ---------------- 5 ---------------- */
      titulo("5. A outra pessoa acessa"),
      p([
        normal("Ela abre o navegador e digita o endereço do passo 3. "),
        forte("Só isso"), normal(" — ela não baixa nada, não instala nada, não abre arquivo nenhum."),
      ]),

      atencao("Não deixe ninguém abrir o arquivo direto", [
        [normal("Se a pessoa abrir o "), mono("Cronogramas_v2.html"), normal(" com dois cliques, o sistema até funciona — mas com dados só dela, guardados no navegador dela, separados dos seus.")],
        [forte("O teste inteiro perde o sentido e ninguém percebe:"), normal(" as duas telas parecem certas, só não conversam. Acesso apenas pelo link.")],
      ], VERMELHO, "F7E4DD"),

      linhaFina(),

      /* ---------------- 6 ---------------- */
      titulo("6. O roteiro do teste a dois"),
      p("Vale ter isto em mãos, senão o teste vira “duas pessoas olhando a mesma tela”. Cada item abaixo mostra uma coisa que uma planilha compartilhada não faz:"),

      tabela(
        ["O que fazer", "O que isso prova"],
        [
          [
            [forte("Entrem com usuários diferentes."), normal(" Você como Gestor, ela como Agendador. O PIN é 1234 nas duas.")],
            "Cada perfil vê um menu diferente. As permissões são reais, não decoração.",
          ],
          [
            [forte("Ela cria uma reserva. Você não faz nada e espera 5 segundos.")],
            "A reserva aparece na sua tela sozinha. É a atualização automática.",
          ],
          [
            [forte("Os dois tentam marcar a mesma sala no mesmo horário, quase juntos.")],
            "O segundo recebe uma recusa dizendo qual reserva está no caminho. Quem decide é o servidor, não a tela.",
          ],
          [
            [forte("Você aprova uma hora extra enquanto ela está com a tela aberta.")],
            "O número no menu dela muda sozinho, sem recarregar a página.",
          ],
          [
            [forte("Abra o Cronograma em dias diferentes do mês.")],
            "A agenda vem cheia: são três meses de dados simulados, com cerca de oito reservas por dia.",
          ],
        ],
        [4200, 5160],
      ),

      new Paragraph({ spacing: { after: 240 }, children: [] }),

      /* ---------------- 7 ---------------- */
      titulo("7. Se alguma coisa der errado"),

      tabela(
        ["Sintoma", "Causa provável e o que fazer"],
        [
          [
            "A outra pessoa não consegue abrir o endereço",
            "Quase sempre é o firewall — refaça o passo 4. Se a regra já existe e mesmo assim não abre, a rede da empresa pode estar isolando as máquinas entre si (comum em Wi-Fi corporativo). Testem os dois no cabo, ou peça à TI para liberar a porta 8124 entre as duas máquinas.",
          ],
          [
            "A tela abre em branco, nos dois PCs",
            "O sistema baixa algumas bibliotecas da internet para montar a tela. Se o firewall da empresa bloquear esses endereços, a página não carrega e não aparece mensagem de erro nenhuma. Descobrir isso agora é muito melhor do que descobrir na apresentação — avise que dá para resolver, mas exige um ajuste no programa.",
          ],
          [
            "O servidor cai no meio do teste",
            "Provavelmente o PC dormiu ou a janela do PowerShell foi fechada. Deixe a tela ligada e a janela aberta.",
          ],
          [
            "O endereço parou de funcionar no dia seguinte",
            "É normal: a rede distribui o número automaticamente e ele muda. Rode ipconfig de novo antes de cada teste.",
          ],
          [
            "Quero começar do zero",
            "Pare o servidor (Ctrl + C) e rode node demo-seed.js --force de novo. Isso apaga tudo que foi feito no teste e recria os dados de demonstração com as datas do dia.",
          ],
        ],
        [3000, 6360],
      ),

      new Paragraph({ spacing: { after: 240 }, children: [] }),

      /* ---------------- 8 ---------------- */
      titulo("8. Duas coisas para não estranhar"),

      marcador([
        forte("O sino de notificação fica apagado para a outra pessoa. "),
        normal("A notificação do Windows só funciona em endereços seguros (https), e o teste roda em http. No seu PC, por localhost, ela funciona. Para as outras máquinas, o aviso aparece como número no menu e no título da aba — que é o que importa."),
      ]),
      marcador([
        forte("Tudo que vocês fizerem grava de verdade. "),
        normal("As reservas criadas no teste ficam no banco do seu PC. Se quiser voltar ao estado inicial antes da apresentação, rode o comando de recriar os dados."),
      ]),

      linhaFina(),

      /* ---------------- contas ---------------- */
      titulo("Contas para entrar"),
      p([
        forte("O PIN de todas as contas é 1234. "),
        normal("Nos dados de teste é o mesmo para todo mundo, de propósito: quem apresenta troca de usuário várias vezes e não pode travar lembrando qual PIN é de quem."),
      ]),
      tabela(
        ["Usuário", "O que enxerga"],
        [
          ["Administrador", "Tudo, inclusive Usuários e Permissões"],
          ["Gestor", "Indicadores, Estimativas, Configurações, Cadastro"],
          ["Agendador", "Planejar estudo, Estimativas, Cronograma"],
          ["Equipe de Treinamento", "Treinamentos e o dia a dia"],
          ["Qualquer colaborador ou médico, pelo nome", "Meu dia e o dia a dia"],
        ],
        [4200, 5160],
      ),

      new Paragraph({
        spacing: { before: 400 },
        children: [new TextRun({
          text: "Este guia cobre o teste em rede. O roteiro da apresentação e a lista de cenários preparados estão no arquivo LEIA-ME.md, na mesma pasta.",
          size: 20, color: CINZA, font: "Calibri", italics: true,
        })],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync("Central de Recursos - Guia de teste em rede.docx", buf);
  console.log("gerado");
});
