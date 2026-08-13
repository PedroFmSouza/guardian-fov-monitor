import { fmtInt } from '../../ui/kpis.js'
import { dayKeyToUtc, OBS_STATUS } from '../../aggregate/byDailyVehicle.js'

export const STATUS_LABEL = {
  [OBS_STATUS.RECURRED]: 'Reincidente',
  [OBS_STATUS.MONITORING]: 'Em observação',
  [OBS_STATUS.CLEARED]: 'Liberado',
  [OBS_STATUS.NO_DATA]: 'Sem série diária',
  [OBS_STATUS.NO_DATE]: 'Sem data de manutenção',
}

/**
 * Ids de canvas derivados do número do equipamento.
 *
 * São a superfície pela qual o Chart.js encontra o nó que o React desenhou, e
 * também por onde o teste de fumaça encontra os gráficos. Precisam ser estáveis
 * e válidos como id de HTML — daí a limpeza dos caracteres.
 */
const safeId = (vehicle) => String(vehicle).replace(/[^A-Za-z0-9_-]/g, '_')
export const canvasIdFor = (vehicle) => `wl-chart-${safeId(vehicle)}`
export const dayCanvasIdFor = (vehicle, zone, i) => `wl-day-${safeId(vehicle)}-${zone}-${i}`
export const shiftCanvasIdFor = (vehicle) => `wl-shift-${safeId(vehicle)}`

/** Hora do dia na mesma grafia do eixo dos gráficos: 7 → "07h". */
export const hh = (h) => `${String(h).padStart(2, '0')}h`

/** 2026-07-12 → 12/07. Ano fica implícito no período do documento. */
export const dm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
/** Dia da semana do dia-chave. Ajuda a ler padrão de operação (fim de semana, escala). */
export const dow = (day) => WEEKDAYS[new Date(dayKeyToUtc(day)).getUTCDay()]

export const exc = (n) => `${fmtInt(n)} ${n === 1 ? 'exceção' : 'exceções'}`

export const today = () => new Date().toISOString().slice(0, 10)

export { fmtInt }
