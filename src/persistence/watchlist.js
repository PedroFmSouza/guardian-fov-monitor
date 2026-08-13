/**
 * Persistência da lista de equipamentos em observação.
 *
 * Guardada separado do histórico semanal (chaves próprias) porque tem ciclo de
 * vida diferente: o histórico é descartável, a série diária é o ativo do
 * acompanhamento — encerrar a observação de um equipamento NÃO apaga a série
 * dele.
 *
 * A lista é sempre manual: só entra equipamento que passou por manutenção e foi
 * indicado por alguém. Nenhum upload adiciona ou remove entradas.
 */

const KEY_WATCHLIST = 'gfm.v2.watchlist'
const KEY_DAILY = 'gfm.v2.daily'

/** Teto de dias mantidos por equipamento (≈ 6 meses). */
export const DAILY_RETENTION_DAYS = 180

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    return parsed == null ? fallback : parsed
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

/**
 * Normaliza uma entrada da lista de observação.
 *
 * Aceita string (formato v2.0, uma data global para toda a lista) ou objeto
 * (formato atual, data de manutenção por equipamento). A migração acontece na
 * leitura para que watchlists antigas não sejam perdidas: cada equipamento
 * herda a data global como sua data de manutenção.
 *
 * @param {string|object} raw
 * @param {string|null} fallbackDate
 */
export function normalizeEntry(raw, fallbackDate = null) {
  if (raw == null) return null
  if (typeof raw === 'string' || typeof raw === 'number') {
    const vehicle = String(raw).trim()
    return vehicle ? { vehicle, maintenanceDate: fallbackDate || null, note: '' } : null
  }
  const vehicle = String(raw.vehicle == null ? '' : raw.vehicle).trim()
  if (!vehicle) return null
  const date = raw.maintenanceDate || raw.tratativaDate || fallbackDate || null
  return {
    vehicle,
    maintenanceDate: typeof date === 'string' && date ? date : null,
    note: typeof raw.note === 'string' ? raw.note : '',
  }
}

/** Remove duplicatas por equipamento, mantendo a primeira ocorrência. */
function dedupe(entries) {
  const seen = new Set()
  const out = []
  for (const e of entries) {
    if (!e || seen.has(e.vehicle)) continue
    seen.add(e.vehicle)
    out.push(e)
  }
  return out
}

export function loadWatchlist() {
  const stored = readJson(KEY_WATCHLIST, {})
  const defaultDate = typeof stored.tratativaDate === 'string' ? stored.tratativaDate : null
  const raw = Array.isArray(stored.vehicles) ? stored.vehicles : []
  return {
    entries: dedupe(raw.map((r) => normalizeEntry(r, defaultDate)).filter(Boolean)),
    defaultDate,
  }
}

export function saveWatchlist({ entries, defaultDate }) {
  return writeJson(KEY_WATCHLIST, {
    vehicles: dedupe((entries || []).map((e) => normalizeEntry(e)).filter(Boolean)),
    tratativaDate: defaultDate || null,
  })
}

/* --------------------------------------- operações puras sobre a lista */

export function addEntry(entries, vehicle, maintenanceDate = null, note = '') {
  const v = String(vehicle).trim()
  if (!v || entries.some((e) => e.vehicle === v)) return entries
  return [...entries, { vehicle: v, maintenanceDate: maintenanceDate || null, note: note || '' }]
}

export function removeEntry(entries, vehicle) {
  return entries.filter((e) => e.vehicle !== String(vehicle))
}

export function patchEntry(entries, vehicle, patch) {
  return entries.map((e) => (e.vehicle === String(vehicle) ? { ...e, ...patch } : e))
}

/** @returns {Object<string, Object<string, number>>} { vehicle: { day: count } } */
export function loadDaily() {
  const stored = readJson(KEY_DAILY, {})
  return stored && typeof stored === 'object' ? stored : {}
}

/**
 * Funde a série do upload na série persistida.
 *
 * DEDUPLICAÇÃO POR DATA — o requisito mais fácil de quebrar em silêncio:
 * a contagem do dia é ATRIBUÍDA, nunca somada. Subir a mesma planilha duas
 * vezes, ou duas semanas com overlap de fim de semana, reescreve o mesmo dia
 * com o mesmo valor em vez de dobrá-lo.
 *
 * Função pura — devolve um objeto novo, não muta `stored`.
 *
 * @param {Object<string, Object<string, number>>} stored
 * @param {Object<string, Object<string, number>>} incoming
 * @param {number} [retentionDays]
 */
export function mergeDaily(stored, incoming, retentionDays = DAILY_RETENTION_DAYS) {
  const out = {}
  for (const [vehicle, byDay] of Object.entries(stored || {})) {
    out[vehicle] = { ...byDay }
  }
  for (const [vehicle, byDay] of Object.entries(incoming || {})) {
    const target = out[vehicle] || (out[vehicle] = {})
    for (const [day, count] of Object.entries(byDay)) {
      target[day] = count // atribuição, não acumulação
    }
  }
  // poda por retenção, mantendo apenas os N dias mais recentes de cada veículo
  for (const [vehicle, byDay] of Object.entries(out)) {
    const days = Object.keys(byDay).sort()
    if (days.length > retentionDays) {
      const keep = new Set(days.slice(-retentionDays))
      out[vehicle] = Object.fromEntries(days.filter((d) => keep.has(d)).map((d) => [d, byDay[d]]))
    }
  }
  return out
}

export function saveDaily(daily) {
  return writeJson(KEY_DAILY, daily)
}

export function clearWatchlistStorage() {
  try {
    localStorage.removeItem(KEY_WATCHLIST)
    localStorage.removeItem(KEY_DAILY)
  } catch {
    /* noop */
  }
}