/**
 * HEURÍSTICA DE GRUPO DE FROTA — ponto único de troca.
 *
 * O export do Guardian não traz o tipo de equipamento. Hoje o agrupamento é
 * inferido pela centena do número do veículo (207 → "200s", 712 → "700s").
 * No dia em que existir um mapeamento real (id → caminhão / escavadeira / etc),
 * troque APENAS `fleetGroupOf` — nenhum outro módulo conhece essa regra.
 */

export const UNKNOWN_GROUP = 'outros'

/**
 * @param {string|number} vehicle número do equipamento
 * @returns {string} chave do grupo de frota, ex. "200s"
 */
export function fleetGroupOf(vehicle) {
  const digits = String(vehicle ?? '').match(/\d+/)
  if (!digits) return UNKNOWN_GROUP
  const n = Number(digits[0])
  if (!Number.isFinite(n) || n < 100) return UNKNOWN_GROUP
  return `${Math.floor(n / 100) * 100}s`
}

/** Rótulo legível do grupo. */
export function fleetGroupLabel(key) {
  return key === UNKNOWN_GROUP ? 'Outros' : `Frota ${key}`
}

/**
 * Cor institucional do grupo. 200s = azul primário, 700s = âmbar (par definido
 * no sistema visual); demais grupos recebem cores neutras derivadas, estáveis
 * por chave para não trocar entre renders.
 */
const FIXED_COLORS = {
  '200s': '#17475F',
  '700s': '#B26A00',
  [UNKNOWN_GROUP]: '#56616E',
}

const FALLBACK_COLORS = ['#0D6B54', '#9E2F27', '#3F6B87', '#7A5C2E', '#4A4F66', '#2F6E6A']

export function fleetGroupColor(key, allKeys = []) {
  if (FIXED_COLORS[key]) return FIXED_COLORS[key]
  const extras = allKeys.filter((k) => !FIXED_COLORS[k])
  const idx = Math.max(0, extras.indexOf(key))
  return FALLBACK_COLORS[idx % FALLBACK_COLORS.length]
}

/** Ordena grupos: numéricos crescentes primeiro, "outros" por último. */
export function sortFleetGroups(keys) {
  return [...keys].sort((a, b) => {
    if (a === UNKNOWN_GROUP) return 1
    if (b === UNKNOWN_GROUP) return -1
    return parseInt(a, 10) - parseInt(b, 10)
  })
}