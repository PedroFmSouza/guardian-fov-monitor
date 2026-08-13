/**
 * Detalhamento de um único equipamento em observação.
 *
 * Em vez de ler a frota inteira, responde pelo equipamento que está sendo
 * acompanhado — e sempre com a manutenção como eixo: o que mudou depois dela.
 *
 * Duas fontes, com alcances diferentes, e o card deixa isso explícito:
 *  · `rows` — eventos do export carregado agora (tem hora e duração);
 *  · `byDay` — série diária persistida, que atravessa uploads (só contagem).
 *
 * Todas as funções são puras.
 */

import { percentile } from './byVehicle.js'
import { isFirstShiftHour } from './byHour.js'
import { dayCount } from './byDailyVehicle.js'

/** Quantos dias piores listar no detalhe. */
export const WORST_DAYS = 5
/** Quantos dias piores desenhar como perfil horário (um gráfico cada). */
export const WORST_DAY_PROFILES = 3

const emptySide = () => ({
  events: 0,
  fov: 0,
  days: 0,
  perDay: 0,
  hours: new Array(24).fill(0),
  shift1: 0,
  shift2: 0,
  durations: [],
})

function closeSide(side, dayKeys = new Set()) {
  const sorted = side.durations.slice().sort((a, b) => a - b)
  const days = [...dayKeys].sort()
  return {
    events: side.events,
    fov: side.fov,
    days: side.days,
    // dias exatos cobertos pelo lado — "5d" sozinho não diz QUAIS dias
    dayKeys: days,
    firstDay: days.length ? days[0] : null,
    lastDay: days.length ? days[days.length - 1] : null,
    perDay: side.days ? side.fov / side.days : 0,
    hours: side.hours,
    shift1: side.shift1,
    shift2: side.shift2,
    durationMean: sorted.length ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0,
    durationMedian: percentile(sorted, 0.5),
    durationP90: percentile(sorted, 0.9),
    durationMax: sorted.length ? sorted[sorted.length - 1] : 0,
    peakHour: peakOf(side.hours),
  }
}

function peakOf(hours) {
  let peak = null
  let value = 0
  for (let h = 0; h < 24; h++) {
    if (hours[h] > value) {
      value = hours[h]
      peak = h
    }
  }
  return peak
}

/**
 * @param {object[]} rows linhas normalizadas do export atual (frota inteira)
 * @param {string} vehicle
 * @param {string|null} maintenanceDate dia da intervenção (excluído dos dois lados)
 * @param {Object<string, number>} byDay série diária persistida do equipamento
 */
export function buildVehicleDetail(rows, vehicle, maintenanceDate, byDay = {}) {
  const mine = (rows || []).filter((r) => r.vehicle === String(vehicle))

  const before = emptySide()
  const after = emptySide()
  const all = emptySide()
  const daysBefore = new Set()
  const daysAfter = new Set()
  const daysAll = new Set()
  const drivers = new Set()

  for (const r of mine) {
    // sem data de manutenção tudo cai em "depois": o card ainda não tem eixo
    const isAfter = !maintenanceDate || r.dayKey > maintenanceDate
    const isBefore = maintenanceDate && r.dayKey < maintenanceDate
    if (!isAfter && !isBefore) continue // o próprio dia da intervenção não conta

    const side = isAfter ? after : before
    const sideDays = isAfter ? daysAfter : daysBefore
    for (const target of [side, all]) {
      target.events++
      if (r.isFov) {
        target.fov++
        target.hours[r.hour]++
        target.durations.push(r.durationSeconds)
        if (isFirstShiftHour(r.hour)) target.shift1++
        else target.shift2++
      }
    }
    sideDays.add(r.dayKey)
    daysAll.add(r.dayKey)
    if (r.driver) drivers.add(r.driver)
  }

  before.days = daysBefore.size
  after.days = daysAfter.size
  all.days = daysAll.size

  // Perfil de cada dia do export: total, turno e as 24 horas. Uma passada só
  // alimenta duas leituras diferentes — a série por turno (migração de turno) e
  // os piores dias hora a hora.
  const byDayProfile = new Map()
  for (const r of mine) {
    if (!r.isFov) continue
    let bucket = byDayProfile.get(r.dayKey)
    if (!bucket) {
      bucket = { day: r.dayKey, total: 0, shift1: 0, shift2: 0, hours: new Array(24).fill(0) }
      byDayProfile.set(r.dayKey, bucket)
    }
    bucket.total++
    bucket.hours[r.hour]++
    if (isFirstShiftHour(r.hour)) bucket.shift1++
    else bucket.shift2++
  }
  const dayProfiles = [...byDayProfile.values()]

  // série diária partida por turno — mostra se a falha migrou de turno depois
  // da manutenção, o que a contagem total do dia esconde
  const shiftSeries = dayProfiles
    .map(({ day, shift1, shift2 }) => ({ day, shift1, shift2 }))
    .sort((a, b) => (a.day < b.day ? -1 : 1))

  // Piores dias com o perfil horário de cada um: onde a falha se concentra
  // DENTRO do dia é o que a contagem diária esconde.
  //
  // Separados nos mesmos lados do resto do card — antes × depois da manutenção,
  // com o dia da intervenção fora dos dois. Ranquear o export inteiro junto
  // deixaria os piores dias pré-manutenção ocuparem as três vagas e esconderia
  // exatamente o que se quer ver: como ficou DEPOIS.
  const decorate = (d) => ({
    ...d,
    peakHour: peakOf(d.hours),
    after: Boolean(maintenanceDate && d.day > maintenanceDate),
  })
  const worstOf = (list) =>
    list
      .slice()
      .sort((a, b) => b.total - a.total || (a.day < b.day ? -1 : 1))
      .slice(0, WORST_DAY_PROFILES)
      .map(decorate)

  const dayProfilesByZone = {
    before: worstOf(dayProfiles.filter((d) => maintenanceDate && d.day < maintenanceDate)),
    after: worstOf(dayProfiles.filter((d) => maintenanceDate && d.day > maintenanceDate)),
    // sem data de manutenção não há dois lados: o card cai numa zona única
    all: worstOf(dayProfiles),
  }

  const worstDays = Object.entries(byDay || {})
    .map(([day, value]) => [day, dayCount(value)])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, WORST_DAYS)
    .map(([day, count]) => ({
      day,
      count,
      after: Boolean(maintenanceDate && day > maintenanceDate),
    }))

  const closedBefore = closeSide(before, daysBefore)
  const closedAfter = closeSide(after, daysAfter)
  const closedAll = closeSide(all, daysAll)
  const hasSplit = Boolean(maintenanceDate) && before.fov > 0 && after.fov > 0

  // Pior turno: o que concentra mais exceções. Com os dois lados disponíveis, a
  // pergunta é sobre o estado ATUAL do equipamento, então decide pelo pós-
  // manutenção; o total só desempata.
  const basis = hasSplit && closedAfter.fov ? closedAfter : closedAll
  let worstShift = basis.shift1 >= basis.shift2 ? 1 : 2
  if (basis.shift1 === basis.shift2) worstShift = closedAll.shift1 >= closedAll.shift2 ? 1 : 2
  const basisTotal = basis.shift1 + basis.shift2

  return {
    vehicle: String(vehicle),
    maintenanceDate: maintenanceDate || null,
    inExport: mine.length > 0,
    before: closedBefore,
    after: closedAfter,
    all: closedAll,
    shiftSeries,
    /** piores dias hora a hora, por lado: { before, after, all } */
    dayProfiles: dayProfilesByZone,
    worstShift,
    worstShiftCount: worstShift === 1 ? basis.shift1 : basis.shift2,
    worstShiftShare: basisTotal ? (worstShift === 1 ? basis.shift1 : basis.shift2) / basisTotal : 0,
    /** de onde saiu o veredito do pior turno: 'pos' (só pós-manutenção) ou 'total' */
    worstShiftBasis: basis === closedAfter ? 'pos' : 'total',
    worstDays,
    driverCount: drivers.size,
    hasSplit,
  }
}
