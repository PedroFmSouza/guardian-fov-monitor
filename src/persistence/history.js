/**
 * Histórico semanal em localStorage — usado só para a tendência ▲/▼ dos KPIs.
 * Nenhum dado bruto é persistido, apenas o agregado do upload.
 */

const KEY = 'gfm.v2.history'
export const HISTORY_CAP = 12

function read() {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    /* quota/modo privado: histórico é opcional, o relatório segue funcionando */
  }
}

export function loadHistory() {
  return read()
}

/**
 * Impressão digital do dataset. Subir o MESMO arquivo duas vezes gera a mesma
 * fingerprint e não cria uma segunda entrada — senão a tendência compararia o
 * upload com ele mesmo e mostraria 0% falso.
 */
export function fingerprintOf(meta) {
  return [meta.periodStart, meta.periodEnd, meta.rowCount, meta.fovCount, meta.vehicles.length].join('|')
}

export function snapshotFrom(meta, kpis, savedAt) {
  return {
    fingerprint: fingerprintOf(meta),
    savedAt,
    periodStart: meta.periodStart,
    periodEnd: meta.periodEnd,
    totalEvents: kpis.totalEvents,
    fovEvents: kpis.fovEvents,
    fovShare: kpis.fovShare,
    durationMean: kpis.durationMean,
    durationMedian: kpis.durationMedian,
    topVehicle: kpis.topVehicle,
    topVehicleFov: kpis.topVehicleFov,
  }
}

/**
 * Registra o snapshot e devolve o snapshot IMEDIATAMENTE anterior (ou null,
 * estado explícito de "sem histórico" — nunca 0/undefined disfarçado).
 *
 * @returns {{previous: object|null, history: object[], isNew: boolean}}
 */
export function recordSnapshot(snapshot) {
  const history = read()
  const existingIdx = history.findIndex((h) => h.fingerprint === snapshot.fingerprint)

  if (existingIdx >= 0) {
    // Re-upload do mesmo arquivo: compara com o que veio antes dele.
    const previous = existingIdx > 0 ? history[existingIdx - 1] : null
    return { previous, history, isNew: false }
  }

  const previous = history.length ? history[history.length - 1] : null
  const next = [...history, snapshot].slice(-HISTORY_CAP)
  write(next)
  return { previous, history: next, isNew: true }
}

export function clearHistory() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}