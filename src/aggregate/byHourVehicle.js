/**
 * Série temporal de um equipamento, filtrada por causa raiz, em resolução
 * variável — de uma hora a um minuto por ponto.
 *
 * É o gráfico principal do card de observação. Diferente da série diária
 * persistida em duas coisas que importam:
 *
 *  · a granularidade é sub-diária, e isso só existe no export carregado agora —
 *    o `localStorage` guarda `{dia: {s1, s2}}`. Este gráfico portanto NÃO
 *    atravessa uploads, ao contrário dos vereditos do card, que continuam
 *    saindo da série acumulada;
 *  · conta só uma causa (câmera desalinhada, por padrão), enquanto reincidência
 *    e médias pré/pós contam toda exceção de FOV.
 *
 * O eixo x é **minuto decorrido desde o início da janela**, não o índice do
 * ponto. É o que permite trocar a resolução sem perder o enquadramento: mudar o
 * bin muda quantos pontos existem, mas não muda onde cada instante cai no eixo.
 *
 * Bin dentro de um dia coberto pelo export vale `0`; bin de um dia que nenhum
 * arquivo cobre vale `null` — a linha quebra no vão em vez de afirmar que não
 * houve exceção num dia que ninguém mediu.
 *
 * Todas as funções são puras.
 */

import { chartWindow, dayKeyToUtc } from './byDailyVehicle.js'

/** Causa plotada por padrão no card. */
export const CAMERA_MISALIGNED = 'camera misaligned'

export const MINUTES_PER_DAY = 1440

/**
 * Resoluções oferecidas, da mais grossa para a mais fina (minutos por ponto).
 *
 * Não há passo abaixo de um minuto: o `detection_time` tem segundo, mas 21 dias
 * em segundos dariam 1,8 milhão de pontos para ~1240px de canvas — mil e
 * quatrocentos pontos por pixel. Precisão que não cabe na tela não é precisão,
 * é serrilhado.
 */
export const BIN_LADDER = [60, 15, 5, 1]

/**
 * A resolução mais fina que ainda tem pixel para ser desenhada.
 *
 * Sem esse teto, aproximar o zoom só empilharia pontos dentro do mesmo pixel: a
 * linha ficaria mais pesada de desenhar e não mais informativa.
 *
 * @param {number} spanMinutes minutos visíveis no enquadramento atual
 * @param {number} widthPx largura útil do canvas
 * @param {number} [minPxPerPoint] pixels mínimos por ponto
 */
export function pickBin(spanMinutes, widthPx, minPxPerPoint = 2) {
  const maxPoints = Math.max(1, (widthPx || 0) / minPxPerPoint)
  let chosen = BIN_LADDER[0]
  for (const bin of BIN_LADDER) {
    if (spanMinutes / bin <= maxPoints) chosen = bin
  }
  return chosen
}

/** Rótulo curto da resolução, para o rodapé do card. */
export function binLabel(binMinutes) {
  if (binMinutes >= 60) return binMinutes === 60 ? '1 hora' : `${binMinutes / 60} horas`
  return binMinutes === 1 ? '1 minuto' : `${binMinutes} minutos`
}

/**
 * @param {object[]} rows linhas normalizadas do export atual (frota inteira)
 * @param {string} vehicle
 * @param {{maintenanceDate?: string|null, cause?: string, binMinutes?: number,
 *          bounds?: {from: string|null, to: string|null}|null}} [opts]
 * @returns {{days: string[], windowStart: string|null, binMinutes: number,
 *            points: {x: number, y: number|null}[], spanMinutes: number,
 *            gaps: number[][], cutX: number|null, total: number,
 *            coveredDays: number, missingDays: number, inExport: boolean,
 *            cause: string}}
 */
export function binnedCauseSeries(rows, vehicle, opts = {}) {
  const { maintenanceDate = null, bounds = null } = opts
  const cause = opts.cause || CAMERA_MISALIGNED
  const binMinutes = opts.binMinutes || BIN_LADDER[0]
  const id = String(vehicle)

  /** dias que o export cobre — inclusive os sem nenhuma exceção desta causa */
  const covered = {}
  const events = []

  for (const r of rows || []) {
    if (r.vehicle !== id || !r.dayKey) continue
    covered[r.dayKey] = true
    if (!r.isFov || r.cause !== cause) continue
    events.push(r)
  }

  const days = chartWindow(covered, maintenanceDate, bounds)
  const empty = {
    days: [],
    windowStart: null,
    binMinutes,
    points: [],
    spanMinutes: 0,
    gaps: [],
    cutX: null,
    total: 0,
    coveredDays: 0,
    missingDays: 0,
    inExport: Object.keys(covered).length > 0,
    cause,
  }
  if (!days.length) return empty

  const windowStart = days[0]
  const startMs = dayKeyToUtc(windowStart)
  const spanMinutes = days.length * MINUTES_PER_DAY
  const binCount = Math.ceil(spanMinutes / binMinutes)

  // contagem por bin; o minuto do evento vem do relógio de parede da planilha
  const counts = new Map()
  let total = 0
  for (const r of events) {
    const offset = Math.floor((r.detectionTime.getTime() - startMs) / 60000)
    if (offset < 0 || offset >= spanMinutes) continue
    const bin = Math.floor(offset / binMinutes)
    counts.set(bin, (counts.get(bin) || 0) + 1)
    total++
  }

  /** um bin é medido quando o dia em que ele começa está coberto pelo export */
  const measuredBin = (bin) => {
    const day = days[Math.floor((bin * binMinutes) / MINUTES_PER_DAY)]
    return day !== undefined && day in covered
  }

  const points = []
  for (let bin = 0; bin < binCount; bin++) {
    points.push({
      x: bin * binMinutes,
      y: measuredBin(bin) ? counts.get(bin) || 0 : null,
    })
  }

  // vãos em MINUTOS, não em índice de ponto: a faixa precisa cair no mesmo
  // lugar do eixo qualquer que seja a resolução ativa
  const gaps = []
  let open = null
  days.forEach((day, i) => {
    const missing = !(day in covered)
    if (missing && open === null) open = i
    else if (!missing && open !== null) {
      gaps.push([open * MINUTES_PER_DAY, i * MINUTES_PER_DAY])
      open = null
    }
  })
  if (open !== null) gaps.push([open * MINUTES_PER_DAY, days.length * MINUTES_PER_DAY])

  const missingDays = days.filter((d) => !(d in covered)).length
  const cutDay = maintenanceDate ? days.indexOf(maintenanceDate) : -1

  return {
    days,
    windowStart,
    binMinutes,
    points,
    spanMinutes,
    gaps,
    cutX: cutDay < 0 ? null : cutDay * MINUTES_PER_DAY,
    total,
    coveredDays: days.length - missingDays,
    missingDays,
    inExport: true,
    cause,
  }
}

/**
 * Minuto decorrido → instante de parede, para rótulo e tooltip.
 * @returns {{day: string, hour: number, minute: number}}
 */
export function offsetToClock(windowStart, offsetMinutes) {
  const ms = dayKeyToUtc(windowStart) + offsetMinutes * 60000
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return {
    day: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`,
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
  }
}
