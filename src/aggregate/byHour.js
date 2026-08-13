import { SHIFT_FIRST_START, SHIFT_FIRST_END } from '../data/normalize.js'

/**
 * Turno a partir da hora UTC do registro. Base de toda leitura por turno do
 * app — série diária, perfil dos piores dias e sombreamento dos gráficos.
 */
export function isFirstShiftHour(hour) {
  return hour >= SHIFT_FIRST_START && hour < SHIFT_FIRST_END
}
