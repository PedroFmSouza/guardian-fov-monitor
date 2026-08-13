import { fleetGroupOf } from './fleetGroup.js'

/**
 * Chave canônica da exceção de FOV. Os exports escrevem o tipo em idiomas
 * diferentes (`FOV exception` no .xlsx, `Exceção FOV` no .csv do portal) — todo
 * o resto do pipeline enxerga só esta chave.
 */
export const FOV_EVENT_TYPE = 'fov exception'

/**
 * Como cada fonte escreve a exceção de FOV, já sem acento e em minúsculas.
 * É a diferença entre um relatório completo e um relatório com zero FOV: o
 * `isFov` de cada linha nasce daqui e todo painel depende dele.
 */
export const FOV_EVENT_TYPE_ALIASES = [
  'fov exception',
  'fov exceptions',
  'excecao fov',
  'excecao de fov',
  'excecao de campo de visao',
]
const FOV_ALIAS_SET = new Set(FOV_EVENT_TYPE_ALIASES)

/** Causas conhecidas de FOV exception — sempre plotadas, mesmo com zero. */
export const KNOWN_CAUSES = ['tracking issue', 'camera misaligned', 'sensor covered']
export const OTHER_CAUSE = 'não classificado'

/**
 * Causa em pt-BR → chave canônica em inglês.
 *
 * Sem isso, um relatório que mistura os dois formatos mostra "camera
 * misaligned" e "câmera desalinhada" como duas causas distintas, cada uma com
 * metade da contagem.
 */
const CAUSE_ALIASES = new Map([
  ['problema de rastreamento', 'tracking issue'],
  ['falha de rastreamento', 'tracking issue'],
  ['camera desalinhada', 'camera misaligned'],
  ['camera fora de alinhamento', 'camera misaligned'],
  ['sensor coberto', 'sensor covered'],
  ['sensor obstruido', 'sensor covered'],
  ['sensor bloqueado', 'sensor covered'],
])

/**
 * Minúsculas, sem acento, espaços colapsados.
 * Comparar `Exceção FOV` com `excecao fov` só funciona depois disso — e o
 * mesmo texto chega com acentuação diferente conforme a codificação do arquivo.
 */
export function foldText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // marcas de acentuação separadas pelo NFD
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/** Separador entre o tipo de evento e a causa, no primeiro que aparecer. */
const CLASSIFICATION_SPLIT = /^(.+?)\s*[-–—:]\s*(.+)$/

/** O tipo de evento DETECTADO é uma exceção de FOV, em qualquer formato aceito? */
export function isFovEventType(eventType) {
  return FOV_ALIAS_SET.has(foldText(eventType))
}

/** Tipo que a revisão confirmou — o texto antes do primeiro `-` da classificação. */
export function classifiedEventType(classification) {
  const raw = String(classification ?? '').trim()
  if (!raw) return ''
  const m = CLASSIFICATION_SPLIT.exec(raw)
  return m ? m[1].trim() : raw
}

/**
 * Tipos de evento que NÃO são FOV, como cada export os escreve (sem acento).
 *
 * Serve para uma distinção que decide contagem: quando a classificação começa
 * com um destes, a revisão está dizendo "não é FOV, é outra coisa". Quando
 * começa com qualquer outro texto, ela está trazendo só a causa raiz — e aí
 * não há veredito de tipo nenhum para ler.
 */
export const NON_FOV_EVENT_TYPES = new Set([
  'fadiga',
  'distracao',
  'olhada para fora',
  'olhada para baixo',
  'longo olhar para longe',
  'baixo rastreamento',
  'rastreamento baixo',
  'fatigue',
  'distraction',
  'glance away',
  'glance down',
  'low tracking',
])

/**
 * A linha é uma exceção de FOV?
 *
 * Decide pela **revisão** (`classification`), não pelo `event_type`.
 *
 * `event_type` é o que o detector disparou no momento; `classification` é o que
 * um humano confirmou depois. Os dois divergem sistematicamente no export do
 * portal: num arquivo real de 132 eventos do equipamento 228, todas as 132
 * linhas foram confirmadas como FOV na revisão, mas 41 (31%) tinham
 * `event_type` = "baixo rastreamento" — o detector disparou rastreamento e a
 * revisão concluiu que era campo de visão. Decidir pelo `event_type` descartava
 * um terço de um arquivo que é inteiramente FOV, derrubando na mesma proporção
 * toda média diária, limiar de reincidência e veredito de tratativa.
 *
 * Três casos, nesta ordem:
 *
 *  1. a revisão diz FOV  → é FOV, qualquer que seja o `event_type`;
 *  2. a revisão nomeia outro tipo conhecido → não é FOV;
 *  3. qualquer outra coisa → cai no `event_type`.
 *
 * O caso 3 é o que impede um desastre silencioso: há export cuja
 * `classification` traz **só a causa** ("tracking issue"), sem prefixo de tipo.
 * Lido como veredito de tipo, "tracking issue" não é FOV e o arquivo inteiro
 * zeraria — sem erro na tela. Na dúvida sobre o que a coluna significa, o
 * `event_type` volta a mandar.
 *
 * No `.xlsx` em inglês os dois critérios coincidem, então o histórico já
 * carregado por aquele caminho não muda.
 *
 * @param {string} eventType valor cru de `event_type`
 * @param {string} classification valor cru de `classification`
 */
export function isFovEvent(eventType, classification) {
  const reviewed = foldText(classifiedEventType(classification))
  if (reviewed) {
    if (FOV_ALIAS_SET.has(reviewed)) return true
    if (NON_FOV_EVENT_TYPES.has(reviewed)) return false
  }
  return isFovEventType(eventType)
}

export const SHIFT_FIRST_START = 6 // 06h UTC do registro
export const SHIFT_FIRST_END = 18 // 18h UTC do registro

/** Epoch do serial 0 do Excel (1899-12-30) em dias até 1970-01-01. */
const EXCEL_EPOCH_OFFSET_DAYS = 25569
const MS_PER_DAY = 86400000

/**
 * Converte serial do Excel para Date fixando o horário "naive" da planilha em UTC.
 * O Excel grava datetime sem timezone; ancorar em UTC deixa getUTCHours() devolver
 * exatamente a hora que está escrita na célula, em qualquer máquina.
 */
export function excelSerialToUtcDate(serial) {
  const n = Number(serial)
  if (!Number.isFinite(n)) return null
  // arredonda para o segundo — serial de datetime tem ruído de ponto flutuante
  const ms = Math.round((n - EXCEL_EPOCH_OFFSET_DAYS) * MS_PER_DAY / 1000) * 1000
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d
}

const ISO_LIKE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
const BR_LIKE = /^(\d{2})\/(\d{2})\/(\d{4})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/

/** Parseia string de datetime "naive" ancorando em UTC (sem conversão de fuso). */
export function parseNaiveDateString(value) {
  const s = String(value).trim()
  let m = ISO_LIKE.exec(s)
  if (m) {
    return new Date(
      Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
    )
  }
  m = BR_LIKE.exec(s)
  if (m) {
    return new Date(
      Date.UTC(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
    )
  }
  return null
}

/**
 * Aceita serial do Excel, string ou Date e devolve sempre um Date cujos
 * componentes UTC são o relógio de parede da planilha.
 */
export function parseDetectionTime(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return excelSerialToUtcDate(value)
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    // Um Date materializado por outro parser pode ter vindo em hora local;
    // reancoramos os componentes locais em UTC para preservar o relógio de parede.
    return new Date(
      Date.UTC(
        value.getFullYear(),
        value.getMonth(),
        value.getDate(),
        value.getHours(),
        value.getMinutes(),
        value.getSeconds(),
      ),
    )
  }
  const asNumber = Number(value)
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(asNumber)) {
    return excelSerialToUtcDate(asNumber)
  }
  return parseNaiveDateString(value)
}

/** Chave de dia em UTC — YYYY-MM-DD. Base da deduplicação da série diária. */
export function dayKeyOf(date) {
  if (!date) return null
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const num = (v) => {
  if (v == null || v === '') return 0
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

const text = (v) => (v == null ? '' : String(v).trim())

/** Índice de acesso a colunas tolerante a caixa/espaço no header. */
function keyIndex(row) {
  const map = new Map()
  for (const k of Object.keys(row)) {
    map.set(String(k).trim().toLowerCase().replace(/\s+/g, '_'), k)
  }
  return map
}

function pick(row, idx, name) {
  const key = idx.get(name)
  return key === undefined ? null : row[key]
}

/** Aplica o dicionário pt-BR → chave canônica; o que não está no mapa fica como veio. */
function canonicalCause(value) {
  const c = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
  return CAUSE_ALIASES.get(foldText(c)) || c
}

/**
 * Normaliza o subtipo da exceção.
 *
 * Os dois exports prefixam a classificação com o tipo de evento
 * ("FOV exception - camera misaligned", "Exceção FOV - câmera desalinhada").
 * Sem tirar o prefixo, nenhuma causa casa com KNOWN_CAUSES e o painel 06 vira
 * três barras zeradas ao lado de três barras "novas" com o mesmo significado.
 *
 * O prefixo é comparado sem acento e sem caixa, e também contra os apelidos de
 * FOV: no export novo a classificação carrega o tipo **confirmado** na revisão,
 * que nem sempre é o `event_type` detectado ("olhada para fora" detectado,
 * "distração - critérios não atendidos" classificado).
 *
 * @param {string} classification valor cru da coluna
 * @param {string} eventType event_type da linha
 */
export function normalizeCause(classification, eventType) {
  const raw = String(classification ?? '').trim()
  if (!raw) return ''
  const m = CLASSIFICATION_SPLIT.exec(raw)
  if (m) {
    const head = foldText(m[1])
    if (head && (head === foldText(eventType) || FOV_ALIAS_SET.has(head))) {
      return canonicalCause(m[2])
    }
  }
  return canonicalCause(raw)
}

/** Deriva o turno a partir da hora UTC quando a coluna `shift` vem vazia. */
export function shiftFromHour(hour) {
  return hour >= SHIFT_FIRST_START && hour < SHIFT_FIRST_END ? 'First Shift' : 'Second Shift'
}

/**
 * Normaliza as linhas cruas do workbook.
 * Função pura: não muta a entrada e não lê nada fora dos argumentos.
 *
 * @param {object[]} rawRows
 * @returns {{rows: object[], dropped: number, duplicates: number, reclassified: number}}
 */
export function normalizeRows(rawRows) {
  const out = []
  const seenIds = new Set()
  let dropped = 0
  let duplicates = 0
  /** Linhas em que a revisão discordou do detector — nos dois sentidos. */
  let reclassified = 0

  for (const raw of rawRows || []) {
    if (!raw || typeof raw !== 'object') {
      dropped++
      continue
    }
    const idx = keyIndex(raw)

    const detectionTime = parseDetectionTime(pick(raw, idx, 'detection_time'))
    const vehicle = text(pick(raw, idx, 'vehicle'))
    const eventTypeRaw = text(pick(raw, idx, 'event_type'))

    if (!detectionTime || !vehicle || !eventTypeRaw) {
      dropped++
      continue
    }

    const eventId = text(pick(raw, idx, 'event_id'))
    // Dedup dentro do próprio arquivo: eventos repetidos não podem inflar contagem.
    if (eventId) {
      if (seenIds.has(eventId)) {
        duplicates++
        continue
      }
      seenIds.add(eventId)
    }

    const hour = detectionTime.getUTCHours()
    const classificationRaw = text(pick(raw, idx, 'classification')).toLowerCase()

    // FOV é decidido pela REVISÃO; o event_type é só o palpite do detector
    const isFov = isFovEvent(eventTypeRaw, classificationRaw)
    if (isFov !== isFovEventType(eventTypeRaw)) reclassified++

    // chave canônica para FOV (os formatos escrevem em idiomas diferentes);
    // os demais tipos ficam como vieram, e `eventTypeLabel` guarda o original
    const eventType = isFov ? FOV_EVENT_TYPE : eventTypeRaw.toLowerCase()
    const cause = normalizeCause(classificationRaw, eventTypeRaw)

    out.push({
      eventId: eventId || null,
      vehicleId: text(pick(raw, idx, 'vehicle_id')),
      vehicle,
      driver: text(pick(raw, idx, 'driver')),
      detectionTime,
      dayKey: dayKeyOf(detectionTime),
      hour,
      utcOffset: text(pick(raw, idx, 'utc_offset')),
      eventType,
      eventTypeLabel: eventTypeRaw,
      detectedEventType: text(pick(raw, idx, 'detected_event_type')),
      durationSeconds: num(pick(raw, idx, 'duration_seconds')),
      speedKph: num(pick(raw, idx, 'speed_kph')),
      travelMetres: num(pick(raw, idx, 'travel_metres')),
      confirmation: text(pick(raw, idx, 'confirmation')),
      classification: classificationRaw,
      cause: isFov ? cause || OTHER_CAUSE : null,
      fleet: text(pick(raw, idx, 'fleet')),
      shift: text(pick(raw, idx, 'shift')) || shiftFromHour(hour),
      crew: text(pick(raw, idx, 'crew')),
      guardianUnit: text(pick(raw, idx, 'guardian_unit')),
      fleetGroup: fleetGroupOf(vehicle),
      isFov,
    })
  }

  return { rows: out, dropped, duplicates, reclassified }
}

/** Metadados de cobertura do dataset. Puro. */
export function datasetMeta(rows) {
  const days = new Set()
  const vehicles = new Set()
  const shifts = new Set()
  const groups = new Set()
  let min = null
  let max = null

  for (const r of rows) {
    days.add(r.dayKey)
    vehicles.add(r.vehicle)
    if (r.shift) shifts.add(r.shift)
    groups.add(r.fleetGroup)
    const t = r.detectionTime.getTime()
    if (min === null || t < min) min = t
    if (max === null || t > max) max = t
  }

  return {
    days: [...days].sort(),
    vehicles: [...vehicles],
    shifts: [...shifts].sort(),
    fleetGroups: [...groups],
    periodStart: min === null ? null : dayKeyOf(new Date(min)),
    periodEnd: max === null ? null : dayKeyOf(new Date(max)),
    rowCount: rows.length,
    fovCount: rows.filter((r) => r.isFov).length,
  }
}
