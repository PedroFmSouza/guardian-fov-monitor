import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  normalizeRows,
  parseDetectionTime,
  dayKeyOf,
  isFovEventType,
  normalizeCause,
  foldText,
  shiftFromHour,
} from '../src/data/normalize.js'
import {
  parseDelimitedText,
  parseDelimitedBuffer,
  parseDelimitedRows,
  detectDelimiter,
  decodeText,
} from '../src/ingest/parseDelimited.js'
import { WorkbookContractError } from '../src/ingest/contract.js'
import { fleetGroupOf } from '../src/data/fleetGroup.js'
import { aggregateByVehicle } from '../src/aggregate/byVehicle.js'
import {
  aggregateDailyByVehicle,
  evaluateEffectiveness,
  evaluateObservation,
  summarizeObservation,
  sortObservation,
  chartWindow,
  daysOutsideWindow,
  dayCount,
  dayShifts,
  missingDayRuns,
  missingDayCount,
  unsplitDayRuns,
  unsplitDayCount,
  STATUS,
  OBS_STATUS,
  MIN_POST_DAYS,
  OBSERVATION_DAYS,
} from '../src/aggregate/byDailyVehicle.js'
import {
  mergeDaily,
  normalizeEntry,
  addEntry,
  addEntries,
  removeEntry,
  patchEntry,
} from '../src/persistence/watchlist.js'
import {
  addDays,
  clampRange,
  filterRowsByRange,
  isEmptyRange,
  isFullRange,
  lastNDays,
  rangeLengthDays,
} from '../src/data/dateRange.js'
import {
  buildVehicleDetail,
  WORST_DAY_PROFILES,
  WORST_DAY_PROFILES_UNSPLIT,
} from '../src/aggregate/vehicleDetail.js'
import { fleetDaily, fleetByHour, fleetByCause, causeLabel } from '../src/aggregate/overview.js'

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const serial = (iso) => (Date.parse(`${iso}Z`) - EXCEL_EPOCH) / 86400000

const row = (over = {}) => ({
  event_id: `E${Math.random()}`,
  vehicle: 707,
  detection_time: serial('2026-07-06T05:30:00'),
  event_type: 'FOV exception',
  classification: 'tracking issue',
  duration_seconds: 5,
  ...over,
})

test('detection_time é ancorado em UTC, independente do fuso da máquina', () => {
  const d = parseDetectionTime(serial('2026-07-06T05:30:00'))
  assert.equal(d.getUTCHours(), 5)
  assert.equal(dayKeyOf(d), '2026-07-06')

  const fromString = parseDetectionTime('2026-07-06 23:45:00')
  assert.equal(fromString.getUTCHours(), 23)
  assert.equal(dayKeyOf(fromString), '2026-07-06')
})

test('duration_seconds em string vira número', () => {
  const { rows } = normalizeRows([row({ duration_seconds: '12.5' })])
  assert.equal(rows[0].durationSeconds, 12.5)
})

test('grupo de frota vem da centena do id', () => {
  assert.equal(fleetGroupOf(707), '700s')
  assert.equal(fleetGroupOf('224'), '200s')
  assert.equal(fleetGroupOf('abc'), 'outros')
})

test('event_id repetido não é contado duas vezes', () => {
  const { rows, duplicates } = normalizeRows([row({ event_id: 'X1' }), row({ event_id: 'X1' })])
  assert.equal(rows.length, 1)
  assert.equal(duplicates, 1)
})

test('linhas sem coluna obrigatória são descartadas, não quebram o pipeline', () => {
  const { rows, dropped } = normalizeRows([row(), { vehicle: 707 }, row({ detection_time: null })])
  assert.equal(rows.length, 1)
  assert.equal(dropped, 2)
})

test('aggregateByVehicle reporta média e mediana juntas', () => {
  const durations = [1, 1, 1, 1, 600]
  const { rows } = normalizeRows(durations.map((d) => row({ duration_seconds: d })))
  const [v] = aggregateByVehicle(rows)
  assert.equal(v.fov, 5)
  assert.equal(v.durationMedian, 1)
  assert.ok(v.durationMean > 100, 'média puxada pelo outlier')
})

test('classification prefixada pelo event_type é normalizada para a causa conhecida', () => {
  const { rows } = normalizeRows([
    row({ classification: 'FOV exception - camera misaligned' }),
    row({ classification: 'tracking issue' }),
  ])
  assert.equal(rows[0].cause, 'camera misaligned')
  assert.equal(rows[1].cause, 'tracking issue')
})

/* ------------------------------------------- formato novo: CSV em pt-BR */

test('"Exceção FOV" é reconhecida como exceção de FOV', () => {
  assert.ok(isFovEventType('Exceção FOV'))
  assert.ok(isFovEventType('EXCEÇÃO FOV'))
  assert.ok(isFovEventType('excecao fov'), 'arquivo sem acento (latin-1 mal lido) ainda casa')
  assert.ok(isFovEventType('FOV exception'))
  assert.ok(!isFovEventType('distração'))
  assert.ok(!isFovEventType('fadiga'))
})

test('linha em pt-BR entra no relatório com o mesmo eventType canônico do .xlsx', () => {
  const { rows } = normalizeRows([
    {
      event_id: 'PT-1',
      vehicle: '235',
      detection_time: '2026-08-10 23:58:03',
      event_type: 'Exceção FOV',
      classification: 'Exceção FOV - câmera desalinhada',
      duration_seconds: '43.2',
    },
    row({ event_id: 'EN-1' }),
  ])
  assert.equal(rows.length, 2)
  assert.ok(rows[0].isFov)
  assert.equal(rows[0].eventType, rows[1].eventType, 'os dois idiomas colapsam na mesma chave')
  assert.equal(rows[0].eventTypeLabel, 'Exceção FOV', 'o rótulo original é preservado')
  assert.equal(rows[0].durationSeconds, 43.2)
  assert.equal(rows[0].hour, 23, 'hora de parede da planilha, sem conversão de fuso')
  assert.equal(rows[0].dayKey, '2026-08-10')
})

test('causa em pt-BR colapsa na mesma chave da causa em inglês', () => {
  const { rows } = normalizeRows([
    row({ event_id: 'A', classification: 'FOV exception - camera misaligned' }),
    row({
      event_id: 'B',
      event_type: 'Exceção FOV',
      classification: 'Exceção FOV - câmera desalinhada',
    }),
    row({
      event_id: 'C',
      event_type: 'Exceção FOV',
      classification: 'Exceção FOV - problema de rastreamento',
    }),
  ])
  assert.equal(rows[0].cause, rows[1].cause)
  assert.equal(rows[1].cause, 'camera misaligned')
  assert.equal(rows[2].cause, 'tracking issue')
})

test('classificação com tipo confirmado diferente do detectado perde só o prefixo', () => {
  // o export novo classifica pelo tipo CONFIRMADO na revisão, que pode divergir
  assert.equal(
    normalizeCause('Exceção FOV - critérios não atendidos', 'olhada para fora'),
    'critérios não atendidos',
  )
  // veredito sem prefixo nenhum continua inteiro
  assert.equal(normalizeCause('critérios não atendidos', 'Exceção FOV'), 'critérios não atendidos')
})

test('foldText tira acento e caixa sem destruir o texto', () => {
  assert.equal(foldText(' Câmera   Desalinhada '), 'camera desalinhada')
  assert.equal(foldText(null), '')
})

test('CSV do portal vira linhas-objeto com as colunas do contrato', () => {
  const csv = [
    'event_id,vehicle_id,"vehicle","driver","detection_time",utc_offset,"event_type","duration_seconds","classification"',
    '12672771,14502,"235","","2026-08-10 23:58:03",-180,"Exceção FOV","43.2","Exceção FOV - critérios não atendidos"',
    '12672770,21807,"723","","2026-08-10 23:57:42",-180,"Exceção FOV","49.2","Exceção FOV - câmera desalinhada"',
  ].join('\r\n')

  const parsed = parseDelimitedText(csv)
  assert.equal(parsed.delimiter, ',')
  assert.equal(parsed.rows.length, 2)
  assert.equal(parsed.rows[0].vehicle, '235')
  assert.equal(parsed.rows[0].driver, null, 'campo vazio vira null, como o defval da planilha')

  const { rows, dropped } = normalizeRows(parsed.rows)
  assert.equal(dropped, 0)
  assert.equal(rows.filter((r) => r.isFov).length, 2)
})

test('CSV com ponto e vírgula (Excel pt-BR) é detectado pelo cabeçalho', () => {
  const csv = 'event_id;vehicle;detection_time;event_type\n1;235;2026-08-10 23:58:03;Exceção FOV\n'
  const parsed = parseDelimitedText(csv)
  assert.equal(parsed.delimiter, ';')
  assert.equal(parsed.rows[0].event_type, 'Exceção FOV')
})

test('campo entre aspas guarda delimitador, aspas e quebra de linha', () => {
  const matrix = parseDelimitedRows('a,"b,1","c ""x""","d\ne"\n\n"f",g\n', ',')
  assert.deepEqual(matrix, [
    ['a', 'b,1', 'c "x"', 'd\ne'],
    ['f', 'g'],
  ])
})

test('CSV sem as colunas obrigatórias falha com erro de contrato, não com dado torto', () => {
  assert.throws(
    () => parseDelimitedText('a,b,c\n1,2,3\n'),
    (err) => err instanceof WorkbookContractError && /event_type/.test(err.message),
  )
})

test('acentos sobrevivem a UTF-8 com BOM e a windows-1252', () => {
  const body = 'Exceção FOV'
  const utf8 = new TextEncoder().encode(body)
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8])
  assert.equal(decodeText(withBom).text, body)

  // "Exceção" em windows-1252: ç = 0xE7, ã = 0xE3 — bytes inválidos em UTF-8
  const latin1 = new Uint8Array([0x45, 0x78, 0x63, 0x65, 0xe7, 0xe3, 0x6f])
  const decoded = decodeText(latin1)
  assert.equal(decoded.encoding, 'windows-1252')
  assert.equal(decoded.text, 'Exceção')
})

test('detectDelimiter ignora vírgula dentro de aspas no cabeçalho', () => {
  assert.equal(detectDelimiter('"a,b";"c";"d"\n1;2;3'), ';')
})

/* ------------------- amostra real do portal (linhas transcritas do export) */

/**
 * Amostra no formato do portal, com a ESTRUTURA do export real (ordem das
 * colunas, aspas irregulares, campo vazio, divergências entre `event_type` e
 * `classification`) e valores anonimizados — nenhum identificador de operação,
 * equipamento ou localização real entra no repositório.
 */
const portalCsv = readFileSync(new URL('./fixtures/portal-pt-br.csv', import.meta.url))
const portal = parseDelimitedBuffer(portalCsv, { sourceName: 'portal-pt-br.csv' })

test('o export real do portal satisfaz o contrato inteiro de colunas', () => {
  assert.equal(portal.encoding, 'utf-8')
  assert.equal(portal.delimiter, ',')
  assert.equal(portal.rows.length, 8)
  assert.deepEqual(
    portal.missingOptional,
    [],
    'o .csv traz fleet, shift, crew e guardian_unit — nenhuma opcional falta',
  )
  assert.equal(portal.header.length, 30)
  assert.deepEqual(portal.header.slice(21), [
    'fleet',
    'timezone',
    'account',
    'service_provider',
    'shift',
    'crew',
    'guardian_unit',
    'software_version',
    'tags',
  ])
})

test('linhas reais normalizam sem descarte, com turno e unidade vindos do arquivo', () => {
  const { rows, dropped, duplicates } = normalizeRows(portal.rows)
  assert.equal(dropped, 0)
  assert.equal(duplicates, 0)
  assert.equal(rows.length, 8)

  const first = rows[0]
  assert.equal(first.vehicle, '235')
  assert.equal(first.fleetGroup, '200s')
  assert.equal(first.hour, 23)
  assert.equal(first.dayKey, '2026-08-10')
  assert.equal(first.durationSeconds, 43.2)
  assert.equal(first.utcOffset, '-180')
  assert.equal(first.crew, 'C')
  assert.equal(first.guardianUnit, 'GU-0001-A')
  assert.equal(first.driver, '', 'o export real vem sem motorista identificado')
  // no .csv o `fleet` traz o SITE, não um grupo de frota — o agrupamento do
  // relatório vem do número do equipamento, então isso não contamina nada
  assert.equal(first.fleet, 'Mineração Exemplo - Unidade Exemplo')
})

test('o turno gravado no arquivo bate com o turno derivado da hora', () => {
  const { rows } = normalizeRows(portal.rows)
  for (const r of rows) {
    assert.equal(r.shift, shiftFromHour(r.hour), `${r.eventId} às ${r.hour}h`)
  }
})

test('causas reais colapsam nas chaves canônicas', () => {
  const { rows } = normalizeRows(portal.rows)
  const byId = Object.fromEntries(rows.map((r) => [r.eventId, r]))
  assert.equal(byId['1002'].cause, 'camera misaligned')
  assert.equal(byId['1005'].cause, 'tracking issue')
  // veredito da revisão não é causa raiz: fica como está, sem virar KNOWN_CAUSE
  assert.equal(byId['1001'].cause, 'critérios não atendidos')
})

test('quem decide se é FOV é a revisão, não o detector', () => {
  const { rows, reclassified } = normalizeRows(portal.rows)
  const byId = Object.fromEntries(rows.map((r) => [r.eventId, r]))

  // detectado "baixo rastreamento", confirmado na revisão como FOV: CONTA,
  // e a causa sai canônica. É o caso que sozinho valia 31% de um export real.
  assert.equal(byId['1006'].eventTypeLabel, 'baixo rastreamento')
  assert.equal(byId['1006'].isFov, true)
  assert.equal(byId['1006'].eventType, 'fov exception', 'chave canônica de FOV')
  assert.equal(byId['1006'].cause, 'tracking issue')

  // o inverso: detectado FOV, confirmado como distração — NÃO conta
  assert.equal(byId['1007'].eventTypeLabel, 'Exceção FOV')
  assert.equal(byId['1007'].isFov, false)
  assert.equal(byId['1007'].cause, null)

  // classificação sem prefixo nenhum não é mutilada nem vira FOV
  assert.equal(byId['1008'].classification, 'longo olhar para longe')
  assert.equal(byId['1008'].isFov, false)

  assert.equal(reclassified, 2, 'as duas divergências são contadas para o aviso da ingestão')
})

test('classificação que traz só a causa não é lida como veredito de tipo', () => {
  // "tracking issue" é causa, não tipo — lido como tipo, zeraria o arquivo todo
  const { rows, reclassified } = normalizeRows([
    row({ event_id: 'A', classification: 'tracking issue' }),
    row({ event_id: 'B', event_type: 'Exceção FOV', classification: 'câmera desalinhada' }),
    row({ event_id: 'C', event_type: 'Exceção FOV', classification: 'critérios não atendidos' }),
  ])
  assert.deepEqual(rows.map((r) => r.isFov), [true, true, true])
  assert.equal(reclassified, 0)
})

test('sem classificação, o event_type volta a ser a única evidência', () => {
  const { rows, reclassified } = normalizeRows([
    row({ event_id: 'A', event_type: 'Exceção FOV', classification: '' }),
    row({ event_id: 'B', event_type: 'fadiga', classification: '' }),
    row({ event_id: 'C', event_type: 'FOV exception', classification: null }),
  ])
  assert.deepEqual(rows.map((r) => r.isFov), [true, false, true])
  assert.equal(reclassified, 0, 'fallback não é reclassificação')
})

test('o .xlsx em inglês não muda de contagem com o novo critério', () => {
  // nos dois lados o veredito é o mesmo, então o histórico já carregado fica de pé
  const { rows, reclassified } = normalizeRows([
    row({ event_id: 'A', classification: 'FOV exception - tracking issue' }),
    row({ event_id: 'B', event_type: 'fatigue', classification: 'fatigue - confirmed' }),
  ])
  assert.deepEqual(rows.map((r) => r.isFov), [true, false])
  assert.equal(reclassified, 0)
})

/* ------------------------------------------- agregações da visão geral */

test('fleetDaily soma a frota inteira por dia, e só o que é FOV', () => {
  const { rows } = normalizeRows([
    row({ event_id: 'A', vehicle: 707, detection_time: serial('2026-07-06T09:00:00') }),
    row({ event_id: 'B', vehicle: 224, detection_time: serial('2026-07-06T20:00:00') }),
    row({ event_id: 'C', vehicle: 707, detection_time: serial('2026-07-08T09:00:00') }),
    // não-FOV não entra na contagem, mesmo sendo do mesmo dia
    row({
      event_id: 'D',
      event_type: 'fadiga',
      classification: 'fadiga - x',
      detection_time: serial('2026-07-06T09:00:00'),
    }),
  ])
  const daily = fleetDaily(rows)
  // faixa contínua: 07/07 existe no eixo mesmo sem nenhum arquivo cobrindo
  assert.deepEqual(daily.days, ['2026-07-06', '2026-07-07', '2026-07-08'])
  assert.deepEqual(daily.total, [2, null, 1], 'dia sem arquivo é null, não zero')
  assert.deepEqual(daily.shift1, [1, null, 1])
  assert.deepEqual(daily.shift2, [1, null, 0])
  assert.equal(daily.missing, 1)
  assert.equal(daily.covered, 2)
})

test('fleetDaily separa dia coberto sem FOV de dia sem arquivo', () => {
  const { rows } = normalizeRows([
    row({ event_id: 'A', detection_time: serial('2026-07-06T09:00:00') }),
    // 07/07 tem evento, mas não é FOV: o dia foi medido e deu zero
    row({
      event_id: 'B',
      event_type: 'fadiga',
      classification: 'fadiga - x',
      detection_time: serial('2026-07-07T09:00:00'),
    }),
    row({ event_id: 'C', detection_time: serial('2026-07-09T09:00:00') }),
  ])
  const daily = fleetDaily(rows)
  assert.deepEqual(daily.days, ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09'])
  assert.deepEqual(daily.total, [1, 0, null, 1], '0 = medido e sem exceção; null = não medido')
})

test('fleetByHour devolve sempre 24 posições e acha o pico', () => {
  const at = (h, n) =>
    Array.from({ length: n }, (_, i) => row({ event_id: `${h}-${i}`, detection_time: serial(`2026-07-06T${String(h).padStart(2, '0')}:30:00`) }))
  const { rows } = normalizeRows([...at(5, 3), ...at(17, 5), ...at(9, 1)])
  const profile = fleetByHour(rows)
  assert.equal(profile.hours.length, 24)
  assert.equal(profile.total, 9)
  assert.equal(profile.peakHour, 17)
  assert.equal(profile.hours[5], 3)
  assert.equal(profile.hours[0], 0, 'hora sem evento é 0, não ausente')
})

test('fleetByCause mantém as causas conhecidas mesmo zeradas', () => {
  const { rows } = normalizeRows([
    row({ event_id: 'A', classification: 'FOV exception - camera misaligned' }),
    row({ event_id: 'B', classification: 'FOV exception - camera misaligned' }),
    row({ event_id: 'C', classification: 'FOV exception - tracking issue' }),
  ])
  const causes = fleetByCause(rows)
  const byKey = Object.fromEntries(causes.map((c) => [c.cause, c]))

  assert.equal(byKey['camera misaligned'].count, 2)
  assert.equal(byKey['camera misaligned'].label, 'Câmera desalinhada')
  assert.ok(Math.abs(byKey['camera misaligned'].share - 2 / 3) < 1e-9)
  // "sensor coberto: 0" é afirmação útil; a ausência da barra não seria
  assert.equal(byKey['sensor covered'].count, 0)
  assert.deepEqual(
    causes.map((c) => c.count),
    [2, 1, 0],
    'ordenado por contagem decrescente',
  )
})

test('causeLabel traduz o que conhece e capitaliza o resto', () => {
  assert.equal(causeLabel('tracking issue'), 'Problema de rastreamento')
  assert.equal(causeLabel('critérios não atendidos'), 'Critérios não atendidos')
})

/* ---------------------------- dias sem cobertura (buraco na série diária) */

test('arquivos com dias descontínuos deixam a série com buraco, não com zeros', () => {
  // .xlsx até 07/18 e .csv a partir de 07/22 — 21 e 22/07 sem ninguém
  const day = (d, hour, n) =>
    Array.from({ length: n }, (_, i) => ({
      event_id: `${d}-${hour}-${i}`,
      vehicle: 707,
      detection_time: serial(`${d}T${String(hour).padStart(2, '0')}:00:00`),
      event_type: 'FOV exception',
    }))
  const rows = [
    ...day('2026-07-17', 9, 4),
    ...day('2026-07-18', 9, 4),
    ...day('2026-07-22', 9, 2),
    ...day('2026-07-23', 9, 2),
  ]
  const { rows: normalized, dropped } = normalizeRows(rows)
  assert.equal(dropped, 0, 'nenhuma linha foi descartada — o buraco não vem de dado perdido')

  const { series } = aggregateDailyByVehicle(normalized)
  const byDay = series['707']
  assert.ok(!('2026-07-19' in byDay), 'dia sem export não vira zero, fica ausente')
  assert.equal(dayCount(byDay['2026-07-22']), 2)

  const days = chartWindow(byDay, '2026-07-20')
  assert.deepEqual(missingDayRuns(days, byDay), [[2, 4]], '19, 20 e 21/07 formam um vão só')
  assert.equal(missingDayCount(days, byDay), 3)
})

test('missingDayRuns agrupa vãos separados e cobre as pontas da janela', () => {
  const byDay = { '2026-07-02': 1, '2026-07-05': 1 }
  const days = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04', '2026-07-05', '2026-07-06']
  assert.deepEqual(missingDayRuns(days, byDay), [[0, 0], [2, 3], [5, 5]])
  assert.equal(missingDayCount(days, byDay), 4)
  assert.deepEqual(missingDayRuns(days, {}), [[0, 5]], 'série vazia é um vão só')
  assert.deepEqual(missingDayRuns([], byDay), [], 'janela vazia não tem vão')
})

test('dia no formato antigo quebra a linha mas NÃO é "sem dado"', () => {
  // o total é real e conta em tudo; o que falta é só a divisão por turno
  const byDay = {
    '2026-08-05': { s1: 9, s2: 3 },
    '2026-08-06': 14, // gravado antes da quebra por turno
    '2026-08-07': { s1: 16, s2: 1 },
  }
  const days = ['2026-08-05', '2026-08-06', '2026-08-07']

  assert.deepEqual(missingDayRuns(days, byDay), [], 'o dia existe: não é ausência de dado')
  assert.deepEqual(unsplitDayRuns(days, byDay), [[1, 1]], 'é ausência de divisão por turno')
  assert.equal(missingDayCount(days, byDay), 0)
  assert.equal(unsplitDayCount(days, byDay), 1)

  // as duas linhas ficam sem ponto nesse dia — é o buraco que o usuário vê
  assert.deepEqual(days.map((d) => dayShifts(byDay[d])[0]), [9, null, 16])
  // e o total continua contando
  assert.equal(dayCount(byDay['2026-08-06']), 14)
  const res = evaluateObservation(byDay, '2026-08-04')
  assert.equal(res.postDays, 3, 'o dia sem turno entra nas médias como qualquer outro')
  assert.equal(res.postTotal, 12 + 14 + 17)
})

test('os dois motivos de buraco coexistem sem se confundir', () => {
  const byDay = { '2026-08-05': 14, '2026-08-08': { s1: 2, s2: 1 } }
  const days = ['2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08']
  assert.deepEqual(missingDayRuns(days, byDay), [[1, 2]], 'só 06 e 07 são sem dado')
  assert.deepEqual(unsplitDayRuns(days, byDay), [[0, 0]], 'só 05 é sem turno')
})

test('a média pós-manutenção usa só os dias com dado, e o vão é contável', () => {
  // é o que faz "pós X/dia (7d)" não mentir quando o calendário tem 12 dias
  const byDay = {}
  for (const d of ['2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18']) byDay[d] = { s1: 10, s2: 0 }
  for (const d of ['2026-07-20', '2026-07-21']) byDay[d] = { s1: 4, s2: 0 }
  for (const d of ['2026-07-26', '2026-07-27']) byDay[d] = { s1: 6, s2: 0 }

  const res = evaluateObservation(byDay, '2026-07-19')
  assert.equal(res.postDays, 4, 'só os dias presentes entram na média')
  assert.equal(res.daysObserved, 8, 'o calendário desde a manutenção é maior que postDays')

  const days = chartWindow(byDay, '2026-07-19')
  assert.equal(missingDayCount(days, byDay), days.length - Object.keys(byDay).length)
})

test('série diária é idempotente: mesmo arquivo duas vezes não duplica', () => {
  const { rows } = normalizeRows([
    row({ detection_time: serial('2026-07-06T05:00:00') }), // 2º turno
    row({ detection_time: serial('2026-07-06T09:00:00') }), // 1º turno
    row({ detection_time: serial('2026-07-07T09:00:00') }),
  ])
  const { series } = aggregateDailyByVehicle(rows)
  assert.deepEqual(series['707']['2026-07-06'], { s1: 1, s2: 1 }, 'o dia é partido por turno')
  assert.equal(dayCount(series['707']['2026-07-06']), 2)

  const once = mergeDaily({}, series)
  const twice = mergeDaily(once, series)
  assert.deepEqual(twice, once)
  assert.equal(dayCount(twice['707']['2026-07-06']), 2)
})

test('série no formato antigo (só o total) continua sendo lida', () => {
  // histórico gravado antes da quebra por turno: o total vale, o split não existe
  assert.equal(dayCount(7), 7)
  assert.deepEqual(dayShifts(7), [null, null], 'sem split, a linha do turno fica com buraco')
  assert.deepEqual(dayShifts({ s1: 3, s2: 4 }), [3, 4])
  assert.equal(evaluateObservation({ '2026-07-18': 9, '2026-07-21': 9 }, '2026-07-19').postDays, 1)
})

test('overlap de dias entre uploads reescreve o dia em vez de somar', () => {
  const stored = { 707: { '2026-07-19': 4, '2026-07-18': 6 } }
  const incoming = { 707: { '2026-07-19': 4, '2026-07-20': 1 } }
  const merged = mergeDaily(stored, incoming)
  assert.equal(merged[707]['2026-07-19'], 4)
  assert.equal(merged[707]['2026-07-18'], 6)
  assert.equal(merged[707]['2026-07-20'], 1)
})

test('sem dias suficientes após a tratativa o status é aguardando', () => {
  const byDay = {
    '2026-07-18': 5,
    '2026-07-19': 6,
    '2026-07-20': 4,
    '2026-07-21': 0,
  }
  const res = evaluateEffectiveness(byDay, '2026-07-20')
  assert.equal(res.status, STATUS.WAITING)
  assert.ok(res.postDays < MIN_POST_DAYS)
})

test('queda acima do limiar marca a tratativa como efetiva', () => {
  const byDay = {
    '2026-07-16': 8,
    '2026-07-17': 10,
    '2026-07-18': 9,
    '2026-07-19': 11,
    '2026-07-20': 5,
    '2026-07-21': 2,
    '2026-07-22': 1,
    '2026-07-23': 2,
  }
  const res = evaluateEffectiveness(byDay, '2026-07-20')
  assert.equal(res.status, STATUS.EFFECTIVE)
  assert.ok(res.delta < -0.3)
})

test('queda insuficiente marca como não efetiva', () => {
  const byDay = {
    '2026-07-18': 6,
    '2026-07-19': 6,
    '2026-07-21': 6,
    '2026-07-22': 5,
    '2026-07-23': 6,
  }
  const res = evaluateEffectiveness(byDay, '2026-07-20')
  assert.equal(res.status, STATUS.NOT_EFFECTIVE)
})

test('sem data de tratativa não há veredito', () => {
  assert.equal(evaluateEffectiveness({ '2026-07-18': 3 }, null).status, STATUS.NO_DATE)
})

test('janela do gráfico não força dias futuros inexistentes', () => {
  const byDay = { '2026-07-19': 3, '2026-07-20': 2, '2026-07-21': 1 }
  const days = chartWindow(byDay, '2026-07-20')
  assert.equal(days[days.length - 1], '2026-07-21')
  assert.equal(days[0], '2026-07-19')
})

test('manutenção posterior ao último export não esvazia a janela', () => {
  // caso real: data sugerida é hoje e a planilha é de semanas atrás — esticar a
  // janela até a manutenção devolvia só dias vazios e o gráfico sumia
  const byDay = { '2026-06-20': 5, '2026-06-21': 3, '2026-06-22': 4 }
  const days = chartWindow(byDay, '2026-07-31')
  assert.equal(days[days.length - 1], '2026-06-22', 'termina no dado mais recente')
  assert.ok(
    days.filter((d) => d in byDay).length === 3,
    'todos os dias com dado continuam na janela',
  )
})

/* ------------------------------------------------------------- observação */

/** Série diária contínua a partir de um dia inicial. */
const series = (from, counts) => {
  const out = {}
  const [y, m, d] = from.split('-').map(Number)
  for (let i = 0; i < counts.length; i++) {
    const day = new Date(Date.UTC(y, m - 1, d + i))
    out[day.toISOString().slice(0, 10)] = counts[i]
  }
  return out
}

test('um único dia acima do limiar marca reincidência mesmo com a média em queda', () => {
  // baseline 10/dia; pós-manutenção quase zerado, mas um dia volta a 6
  const byDay = series('2026-07-01', [10, 10, 10, 10, 0, 0, 0, 6, 0, 0])
  const res = evaluateObservation(byDay, '2026-07-05')
  assert.equal(res.status, OBS_STATUS.RECURRED)
  assert.deepEqual(res.recurrenceDays, ['2026-07-08'])
  assert.ok(res.delta < 0, 'a média caiu, mas o problema voltou')
})

test('evento isolado abaixo do piso não conta como reincidência', () => {
  const byDay = series('2026-07-01', [1, 1, 1, 1, 0, 0, 1, 0, 0, 0])
  const res = evaluateObservation(byDay, '2026-07-05')
  assert.equal(res.recurrenceDays.length, 0)
  assert.equal(res.status, OBS_STATUS.MONITORING)
  assert.equal(res.cleanStreak, 3)
})

test('observação completa sem reincidência libera o equipamento', () => {
  const counts = Array.from({ length: 4 + OBSERVATION_DAYS + 1 }, (_, i) => (i < 4 ? 8 : 0))
  const byDay = series('2026-06-01', counts)
  const res = evaluateObservation(byDay, '2026-06-05')
  assert.equal(res.status, OBS_STATUS.CLEARED)
  assert.ok(res.daysObserved >= OBSERVATION_DAYS)
})

test('sem data de manutenção ou sem série não há veredito de observação', () => {
  assert.equal(evaluateObservation({ '2026-07-18': 3 }, null).status, OBS_STATUS.NO_DATE)
  assert.equal(evaluateObservation({}, '2026-07-18').status, OBS_STATUS.NO_DATA)
})

test('resumo e ordenação colocam reincidentes na frente', () => {
  const daily = {
    707: series('2026-07-01', [10, 10, 10, 10, 0, 0, 0, 9]),
    224: series('2026-07-01', [4, 4, 4, 4, 0, 0, 0, 0]),
  }
  const entries = [
    { vehicle: '224', maintenanceDate: '2026-07-05', note: '' },
    { vehicle: '707', maintenanceDate: '2026-07-05', note: '' },
  ]
  const sum = summarizeObservation(entries, daily)
  assert.equal(sum.total, 2)
  assert.equal(sum.recurred, 1)
  assert.equal(sum.monitoring, 1)
  assert.equal(sortObservation(entries, daily)[0].entry.vehicle, '707')
})

test('watchlist antiga (lista de strings) migra herdando a data global', () => {
  const migrated = normalizeEntry('707', '2026-07-20')
  assert.deepEqual(migrated, { vehicle: '707', maintenanceDate: '2026-07-20', note: '' })
})

/* -------------------------------------------- detalhe do equipamento */

test('detalhe parte o export entre antes e depois da manutenção', () => {
  const { rows } = normalizeRows([
    // antes: 05h
    row({ vehicle: 707, detection_time: serial('2026-07-18T05:10:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-18T05:40:00') }),
    // dia da manutenção: não entra em nenhum dos lados
    row({ vehicle: 707, detection_time: serial('2026-07-19T05:00:00') }),
    // depois: 17h
    row({ vehicle: 707, detection_time: serial('2026-07-20T17:30:00') }),
    // outro equipamento não pode vazar para o detalhe
    row({ vehicle: 224, detection_time: serial('2026-07-20T17:30:00') }),
  ])

  const d = buildVehicleDetail(rows, '707', '2026-07-19', { '2026-07-18': 2, '2026-07-20': 1 })
  assert.equal(d.before.fov, 2)
  assert.equal(d.after.fov, 1)
  assert.equal(d.before.peakHour, 5)
  assert.equal(d.after.peakHour, 17)
  assert.ok(d.hasSplit)
  assert.equal(d.maintenanceDate, '2026-07-19')

  assert.deepEqual(d.before.dayKeys, ['2026-07-18'])
  assert.deepEqual(d.after.dayKeys, ['2026-07-20'])
  assert.equal(d.after.firstDay, '2026-07-20')
  assert.equal(d.after.lastDay, '2026-07-20')

  assert.equal(d.worstDays[0].day, '2026-07-18')
  assert.equal(d.worstDays[0].after, false)
})

test('série por turno separa 1º e 2º turno dia a dia', () => {
  const { rows } = normalizeRows([
    row({ vehicle: 707, detection_time: serial('2026-07-18T08:00:00') }), // 1º turno
    row({ vehicle: 707, detection_time: serial('2026-07-18T23:00:00') }), // 2º turno
    row({ vehicle: 707, detection_time: serial('2026-07-20T02:00:00') }), // 2º turno
    row({ vehicle: 707, detection_time: serial('2026-07-20T09:00:00'), event_type: 'fatigue' }),
  ])
  const d = buildVehicleDetail(rows, '707', '2026-07-19', {})
  assert.deepEqual(d.shiftSeries, [
    { day: '2026-07-18', shift1: 1, shift2: 1 },
    { day: '2026-07-20', shift1: 0, shift2: 1 },
  ])
})

test('piores dias saem separados por lado da manutenção, com perfil horário', () => {
  const at = (day, hour) => serial(`2026-07-${day}T${String(hour).padStart(2, '0')}:00:00`)
  const { rows } = normalizeRows([
    // ANTES — 17/07 com 3 exceções (pico às 08h), 18/07 com 1
    row({ vehicle: 707, detection_time: at(17, 8) }),
    row({ vehicle: 707, detection_time: at(17, 8) }),
    row({ vehicle: 707, detection_time: at(17, 22) }),
    row({ vehicle: 707, detection_time: at(18, 9) }),
    // DEPOIS — 21/07 com 2 exceções, 20/07 com 1
    row({ vehicle: 707, detection_time: at(20, 9) }),
    row({ vehicle: 707, detection_time: at(21, 3) }),
    row({ vehicle: 707, detection_time: at(21, 3) }),
    // não-FOV não conta, e outro equipamento não pode vazar
    row({ vehicle: 707, detection_time: at(21, 4), event_type: 'fatigue' }),
    row({ vehicle: 224, detection_time: at(21, 3) }),
  ])

  const d = buildVehicleDetail(rows, '707', '2026-07-19', {})

  assert.deepEqual(
    d.dayProfiles.before.map((p) => [p.day, p.total]),
    [
      ['2026-07-17', 3],
      ['2026-07-18', 1],
    ],
  )
  assert.deepEqual(
    d.dayProfiles.after.map((p) => [p.day, p.total]),
    [
      ['2026-07-21', 2],
      ['2026-07-20', 1],
    ],
  )
  assert.ok(
    d.dayProfiles.before.every((p) => p.after === false),
    'nenhum dia da zona "antes" marcado como posterior',
  )
  assert.ok(
    d.dayProfiles.after.every((p) => p.after === true),
    'todo dia da zona "depois" marcado como posterior',
  )

  const [pior] = d.dayProfiles.before
  assert.equal(pior.hours.length, 24)
  assert.equal(pior.hours[8], 2)
  assert.equal(pior.peakHour, 8)
  assert.deepEqual([pior.shift1, pior.shift2], [2, 1])
})

test('cada lado tem seu próprio teto de dias e o dia da intervenção fica fora', () => {
  const at = (day) => serial(`2026-07-${day}T08:00:00`)
  const days = ['12', '13', '14', '15', '16', '17', '18', '19', '20', '21']
  const { rows } = normalizeRows(days.map((day) => row({ vehicle: 707, detection_time: at(day) })))

  const d = buildVehicleDetail(rows, '707', '2026-07-17', {})
  assert.equal(d.dayProfiles.before.length, WORST_DAY_PROFILES, 'teto vale por lado')
  assert.equal(d.dayProfiles.after.length, WORST_DAY_PROFILES)

  // empate em 1 exceção/dia: desempata pelo dia mais antigo, de forma estável
  assert.deepEqual(
    d.dayProfiles.before.map((p) => p.day),
    ['2026-07-12', '2026-07-13', '2026-07-14'],
  )
  assert.deepEqual(
    d.dayProfiles.after.map((p) => p.day),
    ['2026-07-18', '2026-07-19', '2026-07-20'],
  )

  const shown = [...d.dayProfiles.before, ...d.dayProfiles.after].map((p) => p.day)
  assert.ok(!shown.includes('2026-07-17'), 'o dia da intervenção não entra em nenhum dos lados')
})

test('sem data de manutenção o bloco cai numa zona única', () => {
  const at = (day) => serial(`2026-07-${day}T08:00:00`)
  const { rows } = normalizeRows(
    ['12', '13', '14', '15'].map((day) => row({ vehicle: 707, detection_time: at(day) })),
  )
  const d = buildVehicleDetail(rows, '707', null, {})
  assert.equal(d.dayProfiles.before.length, 0, 'sem data não há lado "antes"')
  assert.equal(d.dayProfiles.after.length, 0, 'sem data não há lado "depois"')
  // 4 dias com exceção, teto de 6: entram todos — a zona única não é limitada
  // ao teto de UM lado, senão a grade encolheria pela metade sem data
  assert.equal(d.dayProfiles.all.length, 4)
  assert.ok(d.dayProfiles.all.length <= WORST_DAY_PROFILES_UNSPLIT)
  assert.ok(d.dayProfiles.all.every((p) => p.after === false), 'sem eixo, nada é "depois"')
})

test('pior turno é decidido pelo pós-manutenção, não pelo total', () => {
  const { rows } = normalizeRows([
    // antes: 3 no 1º turno (o total ainda favoreceria o 1º)
    row({ vehicle: 707, detection_time: serial('2026-07-18T08:00:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-18T09:00:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-18T10:00:00') }),
    // depois: 2 no 2º turno
    row({ vehicle: 707, detection_time: serial('2026-07-20T22:00:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-21T03:00:00') }),
  ])
  const d = buildVehicleDetail(rows, '707', '2026-07-19', {})
  assert.equal(d.worstShift, 2)
  assert.equal(d.worstShiftBasis, 'pos')
  assert.equal(d.worstShiftCount, 2)
  assert.equal(d.worstShiftShare, 1)
})

test('sem lado pós-manutenção o pior turno cai no total do período', () => {
  const { rows } = normalizeRows([
    row({ vehicle: 707, detection_time: serial('2026-07-18T08:00:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-18T22:00:00') }),
    row({ vehicle: 707, detection_time: serial('2026-07-18T23:00:00') }),
  ])
  const d = buildVehicleDetail(rows, '707', '2026-07-19', {})
  assert.equal(d.worstShift, 2)
  assert.equal(d.worstShiftBasis, 'total')
})

test('sem data de manutenção o detalhe não força um lado vazio', () => {
  const { rows } = normalizeRows([row({ vehicle: 707 })])
  const d = buildVehicleDetail(rows, '707', null, {})
  assert.equal(d.all.fov, 1)
  assert.equal(d.hasSplit, false)
})

test('a zona única sem data cabe o mesmo tanto de gráficos que os dois lados', () => {
  // 10 dias com exceção: sobra dia para os dois casos encherem o teto
  const rows = []
  for (let i = 0; i < 10; i++) {
    const day = `2026-07-${String(10 + i).padStart(2, '0')}`
    for (let n = 0; n <= i; n++) {
      rows.push(row({ event_id: `${day}-${n}`, vehicle: 707, detection_time: `${day} 09:00:00` }))
    }
  }
  const { rows: normalized } = normalizeRows(rows)

  const semData = buildVehicleDetail(normalized, '707', null, {})
  assert.equal(semData.dayProfiles.all.length, WORST_DAY_PROFILES_UNSPLIT)
  assert.equal(semData.dayProfiles.before.length, 0)
  assert.equal(semData.dayProfiles.after.length, 0)

  const comData = buildVehicleDetail(normalized, '707', '2026-07-15', {})
  const comDataTotal = comData.dayProfiles.before.length + comData.dayProfiles.after.length
  assert.equal(comData.dayProfiles.before.length, WORST_DAY_PROFILES)
  assert.equal(comData.dayProfiles.after.length, WORST_DAY_PROFILES)
  assert.equal(
    semData.dayProfiles.all.length,
    comDataTotal,
    'a grade do bloco tem o mesmo tamanho com e sem data',
  )

  // e continua ordenada por volume, decrescente
  const totals = semData.dayProfiles.all.map((d) => d.total)
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a))
})

test('equipamento fora do export atual é sinalizado, não quebra', () => {
  const d = buildVehicleDetail([], '999', '2026-07-19', { '2026-07-21': 4 })
  assert.equal(d.inExport, false)
  assert.equal(d.all.fov, 0)
  assert.deepEqual(d.worstDays, [{ day: '2026-07-21', count: 4, after: true }])
})

test('cada equipamento mantém sua própria data de manutenção', () => {
  let entries = addEntry([], '707', '2026-07-10', 'troca de câmera')
  entries = addEntry(entries, '224', '2026-07-18')
  assert.equal(addEntry(entries, '707', '2026-07-25').length, 2, 'duplicata é ignorada')

  entries = patchEntry(entries, '224', { maintenanceDate: '2026-07-19' })
  assert.equal(entries.find((e) => e.vehicle === '707').maintenanceDate, '2026-07-10')
  assert.equal(entries.find((e) => e.vehicle === '224').maintenanceDate, '2026-07-19')
  assert.equal(removeEntry(entries, '707').length, 1)
})
/* ------------------------------------------------- recorte por data da tela */

const BOUNDS = { periodStart: '2026-07-06', periodEnd: '2026-07-20' }
const dayRows = (...days) => days.map((dayKey) => ({ dayKey }))

test('intervalo vazio resolve para o período inteiro carregado', () => {
  assert.deepEqual(clampRange({ from: null, to: null }, BOUNDS), {
    from: '2026-07-06',
    to: '2026-07-20',
  })
  assert.equal(isFullRange({ from: null, to: null }, BOUNDS), true)
  assert.equal(isFullRange({ from: '2026-07-10', to: null }, BOUNDS), false)
})

test('cada ponta é grampeada ao período; sem dado carregado nada é grampeado', () => {
  // pedido mais largo que o arquivo encolhe para as bordas reais
  assert.deepEqual(clampRange({ from: '2026-01-01', to: '2026-12-31' }, BOUNDS), {
    from: '2026-07-06',
    to: '2026-07-20',
  })
  assert.deepEqual(clampRange({ from: '2026-07-10', to: '2026-07-12' }, BOUNDS), {
    from: '2026-07-10',
    to: '2026-07-12',
  })
  assert.deepEqual(
    clampRange({ from: '2026-07-10', to: null }, { periodStart: null, periodEnd: null }),
    { from: '2026-07-10', to: null },
  )
})

test('intervalo invertido não seleciona nada — nunca é "consertado" por inversão', () => {
  // Com as duas pontas preenchidas, "digitei ao contrário" e "pedi um intervalo
  // que não existe no arquivo" são a MESMA entrada. Inverter para salvar o
  // primeiro caso faria o segundo exibir silenciosamente um dia qualquer.
  const invertido = clampRange({ from: '2026-07-15', to: '2026-07-08' }, BOUNDS)
  assert.equal(isEmptyRange(invertido), true)
  assert.deepEqual(filterRowsByRange(dayRows('2026-07-10'), invertido), [])

  // pedir 2030 num arquivo que termina em julho/2026: o grampeamento leva `to`
  // para a borda e o resultado tem de continuar vazio, não virar o último dia
  const foraDoPeriodo = clampRange({ from: '2030-01-01', to: '2026-07-19' }, BOUNDS)
  assert.deepEqual(foraDoPeriodo, { from: '2030-01-01', to: '2026-07-19' })
  assert.equal(isEmptyRange(foraDoPeriodo), true)
  assert.deepEqual(filterRowsByRange(dayRows('2026-07-19'), foraDoPeriodo), [])

  // e o caso com uma ponta só, que vira invertido depois do grampeamento
  const semInterseccao = clampRange({ from: '2026-09-01', to: null }, BOUNDS)
  assert.equal(isEmptyRange(semInterseccao), true)
  assert.deepEqual(filterRowsByRange(dayRows('2026-07-10'), semInterseccao), [])
})

test('o recorte filtra pelo dia e devolve o MESMO array quando não recorta nada', () => {
  const rows = dayRows('2026-07-06', '2026-07-10', '2026-07-20')

  assert.equal(filterRowsByRange(rows, { from: null, to: null }), rows, 'identidade preservada')

  assert.deepEqual(
    filterRowsByRange(rows, { from: '2026-07-10', to: '2026-07-20' }).map((r) => r.dayKey),
    ['2026-07-10', '2026-07-20'],
    'os limites são inclusivos nas duas pontas',
  )
  assert.deepEqual(
    filterRowsByRange(rows, { from: null, to: '2026-07-06' }).map((r) => r.dayKey),
    ['2026-07-06'],
  )
})

test('atalho de N dias ancora no dia mais recente COM DADO, não em hoje', () => {
  assert.deepEqual(lastNDays('2026-07-20', 7), { from: '2026-07-14', to: '2026-07-20' })
  assert.equal(rangeLengthDays('2026-07-14', '2026-07-20'), 7, 'a janela é fechada dos dois lados')

  // atravessa a virada de mês sem depender do fuso da máquina
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')

  // pedir mais dias do que o arquivo tem não inventa dias antes do início
  assert.deepEqual(clampRange(lastNDays('2026-07-20', 90), BOUNDS), {
    from: '2026-07-06',
    to: '2026-07-20',
  })
})

test('entrada em lote pula quem já está em observação e reporta quem entrou', () => {
  const entries = addEntry([], '707', '2026-07-10')

  const first = addEntries(entries, ['707', '224', '712'], '2026-07-18')
  assert.deepEqual(first.added, ['224', '712'], '707 já estava na lista')
  assert.equal(first.entries.length, 3)
  assert.equal(
    first.entries.find((e) => e.vehicle === '707').maintenanceDate,
    '2026-07-10',
    'a data de quem já estava não é reescrita',
  )

  // idempotente: reclicar não duplica nem altera nada
  const second = addEntries(first.entries, ['707', '224', '712'], '2026-07-25')
  assert.deepEqual(second.added, [])
  assert.equal(second.entries, first.entries, 'sem entrada nova, devolve por identidade')
})

test('a janela do gráfico do card é recortada ao período exibido', () => {
  // série acumulada de 3 semanas no localStorage; o export aberto cobre só a última
  const byDay = {
    '2026-06-29': 5,
    '2026-07-06': 4,
    '2026-07-20': 3,
    '2026-08-10': 7,
    '2026-08-16': 2,
  }
  const exibido = { from: '2026-08-10', to: '2026-08-16' }

  const janela = chartWindow(byDay, null, exibido)
  assert.equal(janela[0], '2026-08-10')
  assert.equal(janela[janela.length - 1], '2026-08-16')
  assert.equal(daysOutsideWindow(byDay, janela), 3, 'os 3 dias de junho/julho ficam de fora')

  // sem recorte, continua desenhando a série inteira — comportamento antigo intacto
  const cheia = chartWindow(byDay, null)
  assert.equal(cheia[0], '2026-06-29')
  assert.equal(daysOutsideWindow(byDay, cheia), 0)
})

test('o baseline pré-manutenção não escapa do período exibido', () => {
  const byDay = { '2026-07-01': 9, '2026-08-11': 4, '2026-08-14': 6 }
  // a manutenção é 12/08: o baseline puxaria a janela semanas para trás
  const janela = chartWindow(byDay, '2026-08-12', { from: '2026-08-10', to: '2026-08-16' })
  assert.equal(janela[0], '2026-08-11', 'a janela começa dentro do período exibido')
  assert.equal(janela[janela.length - 1], '2026-08-14')
})

test('equipamento sem nenhum dia no período exibido devolve janela vazia', () => {
  const byDay = { '2026-06-29': 5, '2026-07-06': 4 }
  const janela = chartWindow(byDay, null, { from: '2026-08-10', to: '2026-08-16' })
  assert.deepEqual(janela, [], 'não desenha em vez de inventar dias')
  assert.equal(daysOutsideWindow(byDay, janela), 2, 'o card pode dizer quantos dias existem fora')
})
