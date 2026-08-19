# Central de Recursos — como rodar e como apresentar

## Em 30 segundos

```
node demo-seed.js --force     # gera 3 meses de dados de demonstração
node server.js                # sobe o servidor
```

Abra **http://localhost:8124** e entre com **Administrador / PIN 1234**.

---

## Antes de apresentar — leia isto

### 1. Regere os dados na véspera

Todas as datas são relativas ao dia em que o gerador roda: "hoje", "em
andamento agora", "vence em 2 dias", "prazo vencido". O banco que veio junto
foi gerado em **19/08/2026**. Apresentar com ele três semanas depois deixa o
Painel com o dia de hoje vazio e os alertas todos vencidos.

Na véspera (ou na manhã do dia), rode:

```
node demo-seed.js --force
node demo-check.js
```

O segundo comando imprime o que cada tela vai mostrar — números, contagens,
alertas — e avisa se alguma abriria vazia. Vale ler antes de apresentar: é
melhor conhecer os números com antecedência do que ser surpreendido por eles
na frente da plateia.

### 2. Teste a internet da sala

**Este é o maior risco da apresentação.** O aplicativo carrega React, Babel,
Tailwind e as fontes de cinco endereços na internet (`esm.sh`, `unpkg.com`,
`cdn.tailwindcss.com`, `fonts.googleapis.com`). Sem rede — ou com um firewall
corporativo que bloqueie qualquer um deles — a página abre **em branco**, e
não há mensagem de erro que explique o motivo.

Faça o teste na máquina e na rede da apresentação, com antecedência: suba o
servidor, abra a página, veja se carrega. Se não carregar, dá para embutir
essas bibliotecas na pasta e rodar sem internet nenhuma — é meia hora de
trabalho, mas precisa ser feito e testado antes, não na hora.

### 3. Contas para entrar

Todas usam o PIN mostrado ao lado. Trocar de usuário no meio da apresentação
é a forma mais rápida de mostrar as permissões por nível — cada um vê um menu
diferente.

**O PIN de todas as contas é `1234`.** Nos dados de teste é o mesmo para todo
mundo, de propósito: quem apresenta troca de usuário várias vezes e não pode
travar lembrando qual PIN é de quem.

| Usuário | O que enxerga |
|---|---|
| Administrador | tudo, inclusive Usuários e Permissões |
| Gestor | Indicadores, Estimativas, Configurações, Cadastro |
| Agendador | Planejar estudo, Estimativas, Cronograma |
| Equipe de Treinamento | Treinamentos e o dia a dia |
| *(qualquer colaborador ou médico pelo nome)* | Meu dia + o dia a dia |

---

## Roteiro sugerido (12–15 minutos)

**1. Painel** — abre já com o dia acontecendo: reservas concluídas, uma em
andamento agora, o que ainda vem. Os alertas do topo não são enfeite: há
visitas de protocolo vencendo em duas semanas sem ninguém ter marcado, um
insumo abaixo do mínimo e um treinamento com prazo estourado.

**2. Cronograma** — o dia inteiro em grade e em planta baixa. Aponte as
atividades **simultâneas** (duas na mesma sala, no mesmo horário, com equipes
diferentes) e a faixa de fora do horário. Mude o dia para mostrar a agenda
cheia do trimestre.

**3. Planejar estudo** — o argumento central. Monte uma visita e deixe o
assistente escolher sala, equipe, médico e equipamento sozinho. Vale mostrar
o "por que essa sugestão?": ele lista as salas recusadas e o motivo de cada
uma (em manutenção, fora do horário, já reservada, não permitida pro método).

**4. Estudos** — protocolo em D0 + offset, e a visita marcada **fora da
tolerância** aparecendo em vermelho com quantos dias estourou. Tem também
solicitação de prazo esperando aprovação do gestor.

**5. Estimativas** — o funil comercial. Orçamento em aberto, pré-reserva
segurando recurso de verdade (uma delas vence em 2 dias), taxa de conversão
e valor. A separação **previsão ≠ pré-reserva ≠ reserva** é o que diferencia
esta tela de uma planilha.

**6. Indicadores** — custo realizado x futuro, perdas por cancelamento,
ocupação das salas e o reaproveitamento de capacidade: quando uma
oportunidade cai, o horário que estava segurado foi revendido ou o dia ficou
vazio?

**7. Trocar de usuário** — entre como um colaborador e mostre o **Meu dia**:
a mesma base, o menu reduzido, só a agenda da pessoa.

**8. Duas telas ao mesmo tempo** *(se der)* — abra o sistema em duas janelas,
marque algo em uma e espere 5 segundos: aparece na outra. É a resposta à
pergunta "e quando 20 pessoas usarem junto?".

---

## Os cenários plantados de propósito

Foram semeados para as telas terem o que mostrar. Todos passam pelas mesmas
regras que o sistema cobra do usuário — nada aqui é inválido:

- visitas de protocolo **vencendo sem agendamento** (alerta do Painel);
- visitas marcadas **fora da tolerância** do protocolo;
- **luvas abaixo do mínimo** e gaze encostando no limite;
- equipamento com **calibração vencida** e outros vencendo;
- **treinamento com prazo vencido** ainda pendente, e outros em cada estado;
- **hora extra** em cada etapa do fluxo de aprovação;
- **pré-reserva vencendo em 2 dias**, mais canceladas e expiradas com
  histórico de horário liberado;
- **férias, folgas, manutenção de sala e confraternização** no calendário,
  que o motor desvia sozinho na hora de sugerir horário;
- **cancelamentos e reagendamentos** alimentando a conta de perdas.

---

## Os arquivos

| Arquivo | O que é |
|---|---|
| `Cronogramas_v2.html` | O aplicativo inteiro. HTML único, sem build. |
| `server.js` | Servidor de referência (Node puro + SQLite). |
| `demo-seed.js` | Gera os dados de demonstração. |
| `demo-check.js` | Confere o que cada tela vai mostrar. |
| `engine-harness.js` | Carrega o motor do HTML — usado pelos testes e pelo gerador. |
| `atualizar-indice.js` | Reescreve o índice do topo do HTML com as linhas atuais. |
| `*.test.js` | 299 testes: motor, servidor e o adaptador entre os dois. |
| `data.db` | O banco. Não versione, não copie à mão (veja abaixo). |

### Comandos

```
npm test              # roda os 299 testes
npm run demo          # regera os dados e confere
npm start             # sobe o servidor
npm run demo:limpo    # base limpa: cadastro de pé, movimento zerado
npm run indice        # atualiza o índice do HTML
```

Variações do gerador:

```
node demo-seed.js --vazio --force   # base LIMPA (veja abaixo)
node demo-seed.js --seed 7          # outra variação dos sorteios
node demo-seed.js --db teste.db     # grava em outro arquivo
```

A mesma semente sempre produz a mesma demonstração — dá para ensaiar sabendo
que a tela do ensaio é a tela do dia.

### Base limpa, para testar criando tudo à mão

```
npm run demo:limpo
```

Deixa o **cadastro de pé** — 15 salas, 29 métodos, 26 equipamentos, 37
patrocinadores, 5 insumos e os feriados do ano — e zera **todo o movimento**:
nenhum estudo, reserva, estimativa, treinamento, hora extra ou histórico.

A equipe encolhe para **4 colaboradores e 4 médicos**, todos habilitados em
todos os métodos, para nada travar por falta de treinamento. São 12 contas ao
todo: Administrador, Gestor, Equipe de Treinamento e Agendador, mais os 4
colaboradores e os 4 médicos pelo nome. Todas com o PIN `1234`.

É a base para testar o sistema de dentro: criar um estudo, montar o protocolo,
deixar o assistente agendar, pedir hora extra, aprovar. Com 4 pessoas dá para
conferir de cabeça cada escolha que o motor fez — com 22 não dá.

Para voltar à base cheia, `npm run demo`.

---

## Backup — não copie o `data.db` à mão

O banco roda em modo WAL: as gravações recentes ficam no `data.db-wal`, não
no `data.db`. Copiar só o `data.db` pode gerar um backup vazio **que parece
bom**, porque o arquivo existe e tem tamanho.

```
node server.js --backup            # com o servidor no ar ou parado
curl -X POST localhost:8124/api/backup
```

Os dois usam `VACUUM INTO`, que escreve um arquivo consistente e completo.

---

## O que este sistema ainda NÃO faz

Vale dizer na apresentação, antes que alguém pergunte:

- **Não tem autenticação de verdade.** O PIN é conferido no navegador — isso
  é identificação ("quem é você"), não segurança ("prove"). Serve para rede
  interna; exposto na internet, não serve. O PIN também está em texto puro.
- **Não tem HTTPS.** Fica a cargo de quem hospedar.
- **Depende de internet para carregar** (veja o item 2 lá em cima).

O resto — gravação por registro, transação, conflito de agenda decidido no
servidor, controle de versão para não perder escrita — já está pronto e
testado.
