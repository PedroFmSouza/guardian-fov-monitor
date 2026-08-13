/**
 * Gera arquivos sintéticos nos formatos de export do Guardian, para testar o app
 * sem esperar o export real da semana.
 *
 * Uso: npm run sample
 * Saída:
 *   sample/guardian-semana-1.xlsx  baseline (.xlsx, valores em inglês)
 *   sample/guardian-semana-2.xlsx  pós-tratativa, queda forte em 707 e 224
 *   sample/guardian-semana-3.csv   semana seguinte no formato NOVO: CSV do
 *                                  portal, valores em pt-BR, colunas de GPS,
 *                                  alertas e totais de viagem
 *
 * A semana 2 repete propositalmente o último dia da semana 1 — é o overlap de
 * fim de semana que exercita a deduplicação por data da série diária.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(here, '..', 'sample')
mkdirSync(outDir, { recursive: true })

const VEHICLES = [
  { id: 707, weight: 1.0 },
  { id: 224, weight: 0.85 },
  { id: 712, weight: 0.6 },
  { id: 208, weight: 0.45 },
  { id: 731, weight: 0.35 },
  { id: 215, weight: 0.25 },
  { id: 703, weight: 0.2 },
  { id: 241, weight: 0.15 },
  { id: 726, weight: 0.12 },
  { id: 233, weight: 0.08 },
]

const EVENT_TYPES = [
  ['FOV exception', 0.42],
  ['fatigue', 0.12],
  ['glance away', 0.16],
  ['low tracking', 0.1],
  ['distraction', 0.12],
  ['glance down', 0.08],
]

// o export real prefixa a classificação com o próprio event_type
const CAUSES = [
  ['FOV exception - tracking issue', 0.55],
  ['FOV exception - camera misaligned', 0.3],
  ['FOV exception - sensor covered', 0.15],
]

const DRIVERS = ['A. Ramos', 'C. Duarte', 'J. Nogueira', 'M. Prado', 'R. Vieira', 'T. Barbosa']
const CREWS = ['Alfa', 'Bravo', 'Charlie', 'Delta']

// PRNG determinístico — mesma amostra a cada geração
let seed = 20260727
function rnd() {
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
}

function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0)
  let r = rnd() * total
  for (const [value, w] of pairs) {
    r -= w
    if (r <= 0) return value
  }
  return pairs[pairs.length - 1][0]
}

const EXCEL_EPOCH = Date.UTC(1899, 11, 30)
const toSerial = (ms) => (ms - EXCEL_EPOCH) / 86400000

function isoDay(dayMs) {
  const d = new Date(dayMs)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`
}

/**
 * @param {string} startDay YYYY-MM-DD
 * @param {number} days
 * @param {number} idBase
 * @param {(vehicleId:number)=>number} fovFactor multiplicador pós-tratativa
 */
function buildRows(startDay, days, idBase, fovFactor) {
  const [y, m, d] = startDay.split('-').map(Number)
  const start = Date.UTC(y, m - 1, d)
  const rows = []
  let n = 0

  for (let day = 0; day < days; day++) {
    const dayMs = start + day * 86400000
    for (const v of VEHICLES) {
      const base = 26 * v.weight
      const count = Math.max(0, Math.round(base * (0.7 + rnd() * 0.6)))
      for (let i = 0; i < count; i++) {
        // pico às 05h e 17h (troca de turno) com cauda ao longo do dia
        const peak = rnd() < 0.42 ? (rnd() < 0.5 ? 5 : 17) : Math.floor(rnd() * 24)
        const hour = Math.min(23, Math.max(0, peak + (rnd() < 0.3 ? (rnd() < 0.5 ? -1 : 1) : 0)))
        const minute = Math.floor(rnd() * 60)
        const second = Math.floor(rnd() * 60)

        let eventType = weighted(EVENT_TYPES)
        if (eventType === 'FOV exception' && rnd() > fovFactor(v.id)) {
          eventType = weighted(EVENT_TYPES.filter(([t]) => t !== 'FOV exception'))
        }

        const ms = dayMs + hour * 3600000 + minute * 60000 + second * 1000
        // duração assimétrica: mediana baixa, cauda longa
        const duration = rnd() < 0.9 ? 2 + rnd() * 12 : 60 + rnd() * 900

        rows.push({
          event_id: `EV-${idBase + n}`,
          vehicle_id: `GU-${v.id}-A`,
          vehicle: v.id,
          driver: DRIVERS[Math.floor(rnd() * DRIVERS.length)],
          detection_time: toSerial(ms),
          utc_offset: '-03:00',
          event_type: eventType,
          detected_event_type: eventType,
          duration_seconds: rnd() < 0.2 ? duration.toFixed(2) : Number(duration.toFixed(2)),
          speed_kph: Number((rnd() * 42).toFixed(1)),
          travel_metres: Math.round(rnd() * 900),
          confirmation: rnd() < 0.85 ? 'confirmed' : 'pending',
          classification: eventType === 'FOV exception' ? weighted(CAUSES) : '',
          fleet: v.id >= 700 ? 'Haul Fleet B' : 'Haul Fleet A',
          shift: hour >= 6 && hour < 18 ? 'First Shift' : 'Second Shift',
          crew: CREWS[Math.floor(rnd() * CREWS.length)],
          guardian_unit: `GRD-${1000 + v.id}`,
        })
        n++
      }
    }
  }
  return { rows, lastDay: isoDay(start + (days - 1) * 86400000) }
}

function write(file, sheetName, rows) {
  const ws = XLSX.utils.json_to_sheet(rows)
  // marca a coluna de datetime com formato de data, como faz o export real
  const range = XLSX.utils.decode_range(ws['!ref'])
  const header = XLSX.utils.sheet_to_json(ws, { header: 1 })[0]
  const col = header.indexOf('detection_time')
  for (let r = 1; r <= range.e.r; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: col })
    if (ws[addr]) {
      ws[addr].t = 'n'
      ws[addr].z = 'yyyy-mm-dd hh:mm:ss'
    }
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['relatório gerado localmente']]), 'capa')
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  writeFileSync(resolve(outDir, file), XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  return rows.length
}

/* ----------------------------------------------- formato novo: CSV pt-BR */

/**
 * Como o portal escreve cada tipo de evento em português. O mesmo dado, outro
 * idioma — é exatamente isso que o `isFovEventType` precisa reconhecer.
 */
const PT_EVENT = {
  'FOV exception': 'Exceção FOV',
  fatigue: 'fadiga',
  'glance away': 'olhada para fora',
  'low tracking': 'rastreamento baixo',
  distraction: 'distração',
  'glance down': 'olhada para baixo',
}
const PT_CAUSE = {
  'tracking issue': 'problema de rastreamento',
  'camera misaligned': 'câmera desalinhada',
  'sensor covered': 'sensor coberto',
}

/** Cabeçalho do export novo, na ordem exata em que o portal entrega. */
const CSV_HEADER = [
  'event_id',
  'vehicle_id',
  'vehicle',
  'driver',
  'detection_time',
  'utc_offset',
  'event_type',
  'detected_event_type',
  'duration_seconds',
  'speed_kph',
  'travel_metres',
  'latitude',
  'longitude',
  'audio_alert',
  'vibration_alert',
  'visual_alert',
  'trip_distance_metres',
  'trip_time_seconds',
  'confirmation',
  'confirmation_time',
  'classification',
  'fleet', // no .csv vem o SITE, não um grupo de frota
  'timezone',
  'account',
  'service_provider',
  'shift',
  'crew',
  'guardian_unit',
  'software_version',
]

/** Serial de Excel → "YYYY-MM-DD HH:MM:SS" em UTC, como o CSV grava. */
function stamp(serial, plusSeconds = 0) {
  const d = new Date(EXCEL_EPOCH + Math.round(serial * 86400000) + plusSeconds * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`
}

/** Escapa um campo no padrão RFC 4180 (aspas dobradas). */
const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : `"${s}"`
}

function writeCsv(file, rows) {
  const lines = [CSV_HEADER.map(csvCell).join(',')]
  for (const r of rows) {
    const ptType = PT_EVENT[r.event_type] || r.event_type
    const isFov = r.event_type === 'FOV exception'
    // no export novo a classificação carrega o tipo CONFIRMADO na revisão e o
    // veredito da revisão; "critérios não atendidos" é um veredito, não uma causa
    const verified = isFov ? rnd() < 0.7 : rnd() < 0.4
    const confirmation = verified ? 'verificado' : 'critérios não atendidos'
    const cause = verified
      ? PT_CAUSE[String(r.classification).replace('FOV exception - ', '')] || ''
      : 'critérios não atendidos'
    const detectedAt = r.detection_time

    lines.push(
      [
        r.event_id.replace(/\D/g, ''),
        r.vehicle_id.replace(/\D/g, ''),
        r.vehicle,
        '', // o export novo costuma vir sem motorista identificado
        stamp(detectedAt),
        -180, // minutos, não "-03:00"
        ptType,
        ptType,
        (r.duration_seconds || 0).toString(),
        Math.round(r.speed_kph),
        r.travel_metres,
        // coordenadas fictícias: a amostra não aponta para operação nenhuma
        (-10.0 - rnd() * 0.02).toFixed(4),
        (-50.0 - rnd() * 0.02).toFixed(4),
        rnd() < 0.8 ? 'yes' : 'no',
        rnd() < 0.3 ? 'yes' : 'no',
        'no',
        Math.round(rnd() * 200000),
        Math.round(rnd() * 60000),
        confirmation,
        stamp(detectedAt, 60 + Math.round(rnd() * 600)),
        cause ? `${ptType} - ${cause}` : '',
        'Mineração Exemplo - Unidade Exemplo',
        'America/Sao_Paulo',
        'Mineração Exemplo',
        'Caterpillar',
        r.shift, // o .csv traz o turno pronto, em inglês, como o .xlsx
        r.crew.slice(0, 1).toUpperCase(),
        `GU-${String(r.vehicle).padStart(4, '0')}-A`,
        '4.6.4',
      ]
        .map(csvCell)
        .join(','),
    )
  }
  // UTF-8 sem BOM: é o caso mais hostil, o que exige o fallback de decodificação
  writeFileSync(resolve(outDir, file), lines.join('\r\n') + '\r\n', 'utf8')
  return rows.length
}

// Semana 1: 2026-07-06 → 2026-07-19 (14 dias de baseline)
const w1 = buildRows('2026-07-06', 14, 100000, () => 1)
// Semana 2: 2026-07-19 → 2026-07-26 — 19/07 se repete de propósito (overlap).
// 707 e 224 receberam tratativa em 2026-07-20 e caem ~75%.
const w2 = buildRows('2026-07-19', 8, 500000, (id) => (id === 707 || id === 224 ? 0.25 : 0.95))
// Semana 3: 2026-07-26 → 2026-08-01, já no formato novo (CSV pt-BR).
const w3 = buildRows('2026-07-26', 7, 900000, (id) => (id === 707 || id === 224 ? 0.3 : 0.95))

const n1 = write('guardian-semana-1.xlsx', 'events-2026-07-19T07_45_11', w1.rows)
const n2 = write('guardian-semana-2.xlsx', 'events-2026-07-26T06_12_40', w2.rows)
const n3 = writeCsv('guardian-semana-3.csv', w3.rows)

console.log(`sample/guardian-semana-1.xlsx  ${n1} eventos  (2026-07-06 → ${w1.lastDay})`)
console.log(`sample/guardian-semana-2.xlsx  ${n2} eventos  (2026-07-19 → ${w2.lastDay})`)
console.log(`sample/guardian-semana-3.csv   ${n3} eventos  (2026-07-26 → ${w3.lastDay}) · pt-BR`)
console.log('Data de tratativa sugerida para teste: 2026-07-20')