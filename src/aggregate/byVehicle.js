import { OTHER_CAUSE } from '../data/normalize.js'

/** Percentil por interpolação linear sobre lista já ordenada asc. */
export function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0
  if (sortedValues.length === 1) return sortedValues[0]
  const pos = (sortedValues.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sortedValues[lo]
  return sortedValues[lo] + (sortedValues[hi] - sortedValues[lo]) * (pos - lo)
}

/**
 * Agrega por equipamento individual (nunca por frota) e ordena por FOV desc.
 * A distribuição de duração é assimétrica, então média nunca vai sozinha:
 * mediana e P90 saem juntas no mesmo registro.
 *
 * Função pura.
 * @param {object[]} rows linhas normalizadas
 * @returns {Array<object>}
 */
export function aggregateByVehicle(rows) {
  const map = new Map()

  for (const r of rows) {
    let v = map.get(r.vehicle)
    if (!v) {
      v = {
        vehicle: r.vehicle,
        fleetGroup: r.fleetGroup,
        total: 0,
        fov: 0,
        fovDurations: [],
        durationSum: 0,
        causes: {},
        drivers: new Set(),
        days: new Set(),
      }
      map.set(r.vehicle, v)
    }
    v.total++
    v.days.add(r.dayKey)
    if (r.driver) v.drivers.add(r.driver)
    if (r.isFov) {
      v.fov++
      v.durationSum += r.durationSeconds
      v.fovDurations.push(r.durationSeconds)
      const cause = r.cause || OTHER_CAUSE
      v.causes[cause] = (v.causes[cause] || 0) + 1
    }
  }

  const out = []
  for (const v of map.values()) {
    const sorted = v.fovDurations.slice().sort((a, b) => a - b)
    out.push({
      vehicle: v.vehicle,
      fleetGroup: v.fleetGroup,
      total: v.total,
      fov: v.fov,
      fovShare: v.total ? v.fov / v.total : 0,
      durationMean: v.fov ? v.durationSum / v.fov : 0,
      durationMedian: percentile(sorted, 0.5),
      durationP90: percentile(sorted, 0.9),
      durationMax: sorted.length ? sorted[sorted.length - 1] : 0,
      causes: v.causes,
      driverCount: v.drivers.size,
      dayCount: v.days.size,
      fovPerDay: v.days.size ? v.fov / v.days.size : 0,
    })
  }

  out.sort((a, b) => b.fov - a.fov || b.total - a.total || a.vehicle.localeCompare(b.vehicle))
  return out
}
