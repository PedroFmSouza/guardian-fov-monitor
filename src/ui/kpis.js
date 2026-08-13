import { percentile } from '../aggregate/byVehicle.js'

export const fmtInt = (n) => new Intl.NumberFormat('pt-BR').format(Math.round(n || 0))

/**
 * Agregado do dataset gravado no histórico local (ver persistence/history.js),
 * de onde sai a numeração de revisão exibida nos metadados. Puro.
 */
export function computeKpis(rows, vehicleStats) {
  const fovRows = rows.filter((r) => r.isFov)
  const durations = fovRows.map((r) => r.durationSeconds).sort((a, b) => a - b)
  const top = vehicleStats.find((v) => v.fov > 0) || null

  return {
    totalEvents: rows.length,
    fovEvents: fovRows.length,
    fovShare: rows.length ? fovRows.length / rows.length : 0,
    durationMean: durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
    durationMedian: percentile(durations, 0.5),
    durationP90: percentile(durations, 0.9),
    topVehicle: top ? top.vehicle : null,
    topVehicleFov: top ? top.fov : 0,
    topVehicleShare: top && fovRows.length ? top.fov / fovRows.length : 0,
  }
}
