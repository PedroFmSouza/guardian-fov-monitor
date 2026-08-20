/**
 * Série HORÁRIA de um equipamento, filtrada por causa raiz.
 *
 * É o gráfico principal do card de observação. Diferente da série diária
 * persistida em duas coisas que importam:
 *
 *  · a granularidade é a HORA, e hora só existe no export carregado agora — o
 *    `localStorage` guarda `{dia: {s1, s2}}`, sem recorte por hora. Este gráfico
 *    portanto NÃO atravessa uploads, ao contrário dos vereditos do card, que
 *    continuam saindo da série acumulada;
 *  · conta só uma causa (câmera desalinhada, por padrão), enquanto reincidência
 *    e médias pré/pós contam toda exceção de FOV.
 *
 * Hora dentro de um dia coberto pelo export vale `0`; hora de um dia que
 * nenhum arquivo cobre vale `null` — mesma distinção da série diária, e é o que
 * faz a linha quebrar no vão em vez de afirmar que não houve exceção num dia
 * que ninguém mediu.
 *
 * Função pura.
 */

import { chartWindow } from './byDailyVehicle.js'

/** Causa plotada por padrão no card. */
export const CAMERA_MISALIGNED = 'camera misaligned'

const HOURS_PER_DAY = 24

/**
 * @param {object[]} rows linhas normalizadas do export atual (frota inteira)
 * @param {string} vehicle
 * @param {{maintenanceDate?: string|null, cause?: string,
 *          bounds?: {from: string|null, to: string|null}|null}} [opts]
 *        `bounds` é o período escolhido na barra de filtro; `cause` cai em
 *        câmera desalinhada quando a barra não isola nenhuma
 * @returns {{days: string[], hours: {day: string, hour: number}[],
 *            values: (number|null)[], total: number, cutIndex: number,
 *            coveredDays: number, missingDays: number, inExport: boolean,
 *            cause: string}}
 */
export function hourlyCauseSeries(rows, vehicle, opts = {}) {
  const { maintenanceDate = null, bounds = null } = opts
  const cause = opts.cause || CAMERA_MISALIGNED
  const id = String(vehicle)
  /** dias que o export cobre — inclusive os sem nenhuma exceção desta causa */
  const covered = {}
  const counts = new Map()

  for (const r of rows || []) {
    if (r.vehicle !== id || !r.dayKey) continue
    covered[r.dayKey] = true
    if (!r.isFov || r.cause !== cause) continue
    const key = `${r.dayKey}|${r.hour}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  const days = chartWindow(covered, maintenanceDate, bounds)
  const hours = []
  const values = []
  let total = 0
  let missingDays = 0

  for (const day of days) {
    const measured = day in covered
    if (!measured) missingDays++
    for (let hour = 0; hour < HOURS_PER_DAY; hour++) {
      hours.push({ day, hour })
      if (!measured) {
        values.push(null)
        continue
      }
      const n = counts.get(`${day}|${hour}`) || 0
      values.push(n)
      total += n
    }
  }

  // o marco da manutenção cai na primeira hora do dia da intervenção
  const dayIndex = maintenanceDate ? days.indexOf(maintenanceDate) : -1

  return {
    days,
    hours,
    values,
    total,
    cutIndex: dayIndex < 0 ? -1 : dayIndex * HOURS_PER_DAY,
    coveredDays: days.length - missingDays,
    missingDays,
    inExport: Object.keys(covered).length > 0,
    cause,
  }
}
