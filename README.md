# Guardian FOV Monitor · v2

Relatório client-side de exceções de campo de visão (FOV) do sistema Guardian
(Caterpillar), a partir do export semanal — `.xlsx` ou `.csv`, em inglês ou em
português.

**Sem backend.** Nenhum dado da planilha sai da máquina: parse, agregação e
gráficos rodam no navegador; histórico e watchlist ficam em `localStorage`.
Isso é decisão de produto — não há API, banco ou envio de telemetria.

---

## Comandos

```bash
npm install
npm run dev       # servidor local com hot reload
npm run build     # gera dist/ estático
npm run preview   # serve o dist/ para conferência
npm test          # testes das funções puras (node:test, sem browser)
npm run sample    # gera 3 arquivos sintéticos em sample/ (2 .xlsx + 1 .csv pt-BR)
npm run smoke     # build + teste end-to-end no Chrome/Edge instalado
```

`dist/` funciona offline a partir de qualquer servidor estático (IIS, `npm run
preview`, share de rede). Não abra por `file://` — módulos ES exigem HTTP.

---

## Vários arquivos por relatório

A ingestão aceita **um ou vários arquivos de uma vez, misturando os formatos**, e
cada arquivo novo **soma** ao período já carregado em vez de substituí-lo —
várias semanas, ou várias bases, lidas como um único período. A união é
deduplicada por `event_id`, então overlap entre exports não infla contagem;
re-subir um arquivo com o mesmo nome apenas substitui a versão anterior dele. A
lista abaixo da dropzone mostra o que está dentro do relatório (período, linhas,
FOV por arquivo) e permite remover um ou limpar tudo, recalculando na hora.

## Pipeline

```
File (.xlsx | .csv)
  → parseEventFile(file)       escolhe o leitor pelo conteúdo do arquivo
      ├ parseWorkbookBuffer()  .xlsx — acha a aba de eventos pelo header
      └ parseDelimitedBuffer() .csv  — decodifica, detecta delimitador, tabula
                               ambos devolvem { sheetName, header, rows: raw[] }
  → normalizeRows(raw[])       tipos corretos, hour/dayKey em UTC, fleetGroup
  → aggregate*(normalized[])   dados prontos pra gráfico
  → hooks React                useReport (arquivos/relatório), useWatchlist (observação)
  → componentes                JSX + <canvas>; Chart.js montado em useChart
  → persistence                history.js, watchlist.js → localStorage
```

Todo `aggregate*` é função pura — mesma entrada, mesma saída, sem tocar em DOM
ou storage. É o que permite testá-los em `node:test` sem browser.

## Front-end em React

A camada de tela é React (19) + Vite. A divisão que importa: **`ingest`, `data`,
`aggregate` e `persistence` não conhecem React** — são os mesmos módulos puros
de antes, com os mesmos testes. O React entra só de `src/app/` para cima.

Duas decisões que não são óbvias:

- **`useChart`** monta o Chart.js no `<canvas>` que o React desenhou e destrói na
  limpeza do efeito. Recriar o gráfico quando os dados mudam (em vez de atualizar
  o dataset) é barato porque a animação é desligada, e evita toda a classe de bug
  de atualização parcial. A troca de tema entra pelo `ChartThemeContext`: o
  Chart.js copia as cores na criação e nunca mais olha o CSS, então trocar o tema
  precisa **recriar** cada gráfico — o contexto faz isso sem remontar o painel e
  sem perder quais cards estão abertos.
- **`useNativeListener`** ouve o evento `change` nativo nos campos de data,
  observação e arquivo, em vez do `onChange` do React. Dois motivos: a semântica
  desejada é comitar no valor confirmado, não a cada tecla (cada tecla viraria um
  setState e remontaria os gráficos do card); e o React deduplica eventos pelo
  valor rastreado do input, então um `change` disparado por script é engolido.
  Ele devolve uma **ref de callback**, não um efeito — um efeito com `[ref]` nas
  dependências não roda de novo quando o React troca o nó, e o listener fica
  preso no nó antigo.

Sem `<StrictMode>`: em dev ele monta cada efeito duas vezes, o que faria todo
gráfico ser criado, destruído e recriado — trocando o comportamento de dev pelo
de produção justamente na camada imperativa mais frágil.

O teste de fumaça **não mudou uma linha** na migração: ele seleciona por
`#wl-grid`, `.wl-card`, `[data-detail]`, `[data-date]`, `[data-file]` e pelos ids
de canvas, que a versão React preserva. As 28 verificações são a prova de que a
troca de camada não mexeu em comportamento.

## Estrutura

| Caminho | Responsabilidade |
| --- | --- |
| `src/main.jsx` | monta o React em `#root` |
| `src/app/App.jsx` | orquestra os dois hooks de estado e o layout |
| `src/app/hooks.js` | `useChart`, `useNativeListener`, `ChartThemeContext` |
| `src/app/useReport.js` | arquivos carregados, união deduplicada, ingestão |
| `src/app/useWatchlist.js` | lista de observação + série diária persistida |
| `src/app/watchlist/*` | painel, card e detalhe do equipamento |
| `src/ingest/parseEventFile.js` | porta única da ingestão: escolhe o leitor **pelo conteúdo** |
| `src/ingest/contract.js` | contrato de colunas, compartilhado por todos os leitores |
| `src/ingest/parseWorkbook.js` | abre o .xlsx e acha a aba de eventos **pelo header** |
| `src/ingest/parseDelimited.js` | abre o .csv: codificação, delimitador, aspas |
| `src/data/normalize.js` | tipagem, UTC, dayKey, dedup por `event_id`, idioma |
| `src/data/fleetGroup.js` | **única** função que conhece a heurística de frota |
| `src/aggregate/*` | agregações puras (veículo, hora, causa, série diária, detalhe) |
| `src/charts/*` | wrappers de Chart.js (imperativos, sem React) |
| `src/persistence/*` | `localStorage` (histórico semanal, lista de observação, série diária) |
| `src/ui/kpis.js`, `theme.js` | KPIs puros e o `data-theme` do documento |

## Formatos de entrada

Dois formatos, o mesmo relatório. O **cabeçalho é idêntico nos dois** — só o
conteúdo muda de idioma —, então o contrato de colunas é único
(`src/ingest/contract.js`) e o pipeline depois da ingestão não sabe de onde o
dado veio.

| | `.xlsx` (export da planilha) | `.csv` (export do portal) |
| --- | --- | --- |
| Aba/origem | nome variável por semana (`events-2026-07-27T07_45_11`), **não usado** | arquivo único |
| Idioma dos valores | inglês (`FOV exception`) | português (`Exceção FOV`) |
| `detection_time` | serial do Excel | texto `2026-08-10 23:58:03` |
| `utc_offset` | `-03:00` | `-180` (minutos) |
| Colunas a mais | — | `latitude`, `longitude`, `*_alert`, `trip_*`, `confirmation_time`, `timezone`, `account`, `service_provider`, `software_version` |

O `.csv` traz **todas** as colunas opcionais do contrato, inclusive `shift`,
`crew`, `guardian_unit` e `fleet` — nenhum aviso de coluna ausente. Um cuidado:
o `fleet` do `.csv` vem com o nome do **site** da operação, não com um grupo de
frota como no `.xlsx`. Nada depende dele — o agrupamento sai de
`fleetGroupOf(vehicle)`.

Obrigatórias: `event_type`, `vehicle`, `detection_time`.
Opcionais (ausência vira aviso): `event_id`, `vehicle_id`, `driver`,
`utc_offset`, `detected_event_type`, `duration_seconds`, `speed_kph`,
`travel_metres`, `confirmation`, `classification`, `fleet`, `shift`, `crew`,
`guardian_unit`.

O formato é decidido pelo **conteúdo dos primeiros bytes** (`PK` = zip = xlsx),
não pela extensão: arquivo renomeado continua sendo lido certo, e o `accept` do
seletor é só uma dica para o sistema.

## Armadilhas tratadas

- **Nome da aba muda toda semana** → detecção por conteúdo do header.
- **O tipo do evento muda de idioma** (`FOV exception` × `Exceção FOV`) →
  `isFovEventType` compara sem acento e sem caixa contra a lista de apelidos, e
  o `eventType` gravado na linha é sempre a chave canônica. Se essa comparação
  falhar, o arquivo carrega inteiro e **sem erro nenhum** — com zero exceções de
  FOV, que é o pior modo de falha possível. Daí o teste de fumaça exigir que o
  `fovCount` suba ao ler o CSV, não só o `rowCount`.
- **Causa também muda de idioma** → `câmera desalinhada` e `camera misaligned`
  colapsam na mesma chave; sem isso, um relatório misto parte a contagem de cada
  causa em duas.
- **Quem decide se é FOV é a revisão, não o detector.** `event_type` é o que o
  detector disparou na hora; `classification` é o que um humano confirmou
  depois, e os dois divergem sistematicamente. Num export real de 132 eventos de
  um único equipamento, **todas** as 132 linhas foram confirmadas como FOV na
  revisão, mas 41 (31%) tinham `event_type` = `baixo rastreamento`. Contar pelo
  `event_type` descartava um terço de um arquivo inteiramente FOV — e derrubava
  na mesma proporção média diária, limiar de reincidência e veredito de
  tratativa. `isFovEvent` decide em três casos: a revisão diz FOV → é FOV; a
  revisão nomeia outro tipo conhecido (`NON_FOV_EVENT_TYPES`) → não é; qualquer
  outra coisa → cai no `event_type`.
- **O terceiro caso não é preciosismo.** Existe export cuja `classification` traz
  **só a causa** (`tracking issue`), sem prefixo de tipo. Lida como veredito de
  tipo, "tracking issue" não é FOV e o arquivo inteiro zeraria — sem erro na
  tela. Na dúvida sobre o que a coluna significa, o `event_type` volta a mandar.
- No `.xlsx` em inglês os dois critérios coincidem, então o histórico já
  carregado por aquele caminho **não muda**. A ingestão avisa quantos eventos a
  revisão reclassificou, para a diferença entre "132 FOV" e "91 FOV" não ficar
  invisível. Fixture com linhas reais em `tests/fixtures/portal-pt-br.csv`.
- **CSV não é `split(',')`** → campos entre aspas guardam vírgula, aspas
  dobradas e quebra de linha; Excel pt-BR salva com `;`. O delimitador é
  detectado no cabeçalho, que não tem decimal com vírgula para confundir.
- **`Exceção` vira `Exce��o`** se o arquivo for latin-1 lido como UTF-8 — e aí o
  tipo de evento deixa de casar. A decodificação valida UTF-8 (`fatal: true`) e
  cai para windows-1252 quando falha; BOM de UTF-8 e UTF-16 é tratado.
- **O CSV não passa pelo SheetJS** de propósito: ao ler texto ele converte
  `2026-08-10 23:58:03` para serial usando o fuso da máquina, deslocando hora e
  dia. No leitor próprio todo campo sai como string e quem tipa é `normalize.js`.
- **Hora/dia sempre em UTC.** A planilha grava datetime "naive"; o serial do
  Excel é ancorado em UTC e lido com `getUTC*`. Usar hora local do navegador
  desalinharia turno e série diária conforme a máquina que abre a página.
- **`duration_seconds` às vezes vem como string** → `Number(...)` sempre.
- **`fleetGroup` é heurística** (centena do id), isolada em `fleetGroupOf`,
  pronta para virar mapeamento real de tipo de equipamento.
- **Duração é assimétrica** → média nunca sai sozinha: mediana e P90 juntas.
- **Dedup por data na série diária** → a contagem do dia é *atribuída*, nunca
  somada. Subir a mesma planilha duas vezes, ou semanas com overlap de fim de
  semana, não infla o acompanhamento.
- **"Sem histórico anterior" é estado explícito** — nunca vira variação
  percentual contra `undefined`/zero.

## Equipamentos em observação (painel 02)

Setor no topo do relatório: equipamentos que **passaram por manutenção** são
indicados manualmente e ficam em observação para responder uma pergunta só —
**o problema voltou?**

- **Data de manutenção por equipamento** (não uma data global): as intervenções
  acontecem em momentos diferentes e as janelas não coincidem. A data do
  formulário é apenas a sugestão para o próximo equipamento adicionado.
- **Reincidência é avaliada por dia, não por média.** Um único dia
  pós-manutenção acima do limiar já marca o equipamento como reincidente, mesmo
  que a média da janela tenha caído — é o oposto do critério de efetividade, que
  compara médias.
- **Lista 100% manual.** Nenhum upload adiciona ou remove equipamentos: entra só
  quem passou por manutenção e foi indicado. O ranking do painel 05 mostra quem
  está pior; colocar em observação é decisão de quem opera.
- Série diária acumulada entre uploads, por **todos** os equipamentos — encerrar
  a observação só some da tela; recolocar traz o histórico de volta.
- Janela do gráfico: de `manutenção − 14d` até o dado mais recente. Nunca força
  dias que ainda não existem — inclusive quando a data da manutenção é posterior
  ao último export, que esvaziaria a janela inteira.
- **Dia sem export ≠ dia com zero exceção.** Quando os arquivos carregados não
  cobrem dias contíguos (um `.xlsx` que vai até 02/08 e um `.csv` que começa em
  08/08), esses dias não existem na série: a linha quebra ali de propósito, e o
  trecho sai **hachurado com "SEM DADO"**. Plotar zero afirmaria que o
  equipamento não teve exceção num dia que ninguém mediu. As médias `pré`/`pós`
  contam só dias com dado — por isso o card diz quantos dias faltam, senão
  "pós 17.14/dia (7d)" parece cobrir os 12 dias de calendário desde a manutenção.
- **São DOIS motivos de buraco, e a faixa diz qual.** Um dia gravado antes da
  quebra por turno guarda só o total: ele *existe*, conta em todas as médias e
  vereditos, mas as duas linhas não têm o que plotar. Esse dia abre um buraco
  idêntico ao de dia não coberto — e `missingDayRuns` (com razão) não o considera
  ausente, então saía sem faixa e sem contador: buraco sem causa aparente na
  tela. Por isso `unsplitDayRuns` é separado, a faixa sai em âmbar com
  **"SEM TURNO"** (não cinza com "SEM DADO"), e o card conta os dois estados.
  Recarregar um export que cubra esses dias recupera a divisão.
- Com o detalhe aberto, a série vira o gráfico principal do card (**320 px**) e
  ganha **zoom**: roda do mouse amplia, arrastar desloca, "Ver tudo" volta ao
  enquadramento. Fechado, o zoom fica desligado — a roda do mouse precisa
  continuar rolando a página, não ampliando uma miniatura de 132 px.
- **Duas linhas, uma por turno** (1º 06–18 e 2º 18–06). A série diária persistida
  guarda `{ s1, s2 }` por dia; séries gravadas no formato antigo (só o total)
  continuam valendo para os vereditos, mas ficam sem linha — o total existe, a
  divisão não, e plotar zero afirmaria que aquele turno não teve evento.
- **Detalhar** (por equipamento) abre, sempre partido em antes × depois da
  manutenção: hora do dia, turno, causa raiz, duração (mediana/P90) e os dias
  piores da série acumulada, mais o **pior turno** — decidido pelo pós-manutenção
  (o total só desempata) e já plotado como volume diário empilhado, com o turno
  crítico destacado. É o que revela a falha *migrando* de turno em vez de sumir,
  o que a contagem total do dia esconde. Hora/causa/duração vêm do **export carregado
  agora** — só a série diária atravessa uploads, e o card diz isso quando o
  equipamento não está no arquivo atual.
- Watchlists gravadas pela v2.0 (lista de strings + data global) **migram na
  leitura**: cada equipamento herda a data global como sua data de manutenção.

Constantes em `src/aggregate/byDailyVehicle.js`:

| Constante | Valor | Significado |
| --- | --- | --- |
| `PRE_WINDOW_DAYS` | 14 | baseline anterior à manutenção |
| `OBSERVATION_DAYS` | 30 | dias sem reincidência para liberar o equipamento |
| `RECURRENCE_RATIO` | 0.50 | fração da média do baseline que caracteriza reincidência |
| `RECURRENCE_FLOOR` | 2 | piso absoluto do limiar — evento isolado não conta |
| `MIN_POST_DAYS` | 3 | mínimo pós-tratativa para o veredito de efetividade |
| `EFFECTIVENESS_THRESHOLD` | 0.30 | queda da média diária que caracteriza efetividade |

O **dia da manutenção é excluído das duas janelas** — é dia de intervenção, com
o equipamento parcialmente parado, e contaminaria os dois lados da comparação.

Status possíveis: `sem-data`, `sem-dado`, `em-observacao`, `reincidente`,
`liberado`. O badge sempre mostra a variação da média junto do rótulo.
`evaluateEffectiveness` continua disponível (veredito de efetividade por médias)
e é usado pelos testes; o painel exibe o veredito de reincidência.

## Fora de escopo

Backend, API, banco externo, autenticação/multiusuário. O esquemático de FOV é
**ilustrativo**: o export não tem coluna de ângulo ou alcance.