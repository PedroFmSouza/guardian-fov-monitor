import { useCallback, useMemo, useState } from 'react'

import {
  clampRange,
  filterRowsByRange,
  isEmptyRange,
  isFullRange,
  lastNDays,
} from '../data/dateRange.js'
import { datasetMeta } from '../data/normalize.js'

/** Atalhos oferecidos na barra, em dias. Ancorados no dia mais recente com dado. */
export const QUICK_RANGES = [7, 14, 30]

/** Metadados de um recorte que não pegou nenhuma linha. */
const EMPTY_META = {
  days: [],
  vehicles: [],
  shifts: [],
  fleetGroups: [],
  periodStart: null,
  periodEnd: null,
  rowCount: 0,
  fovCount: 0,
}

/**
 * Recorte por data da leitura na tela.
 *
 * O intervalo é guardado CRU, como o usuário digitou, e resolvido contra o
 * período carregado a cada render. Guardar já grampeado parece mais simples e
 * não é: ao somar um arquivo que estende o período, um `from` que tinha sido
 * grampeado para a borda antiga ficaria preso lá, e o filtro passaria a mentir
 * sobre o que o usuário pediu. Cru, o mesmo pedido é reinterpretado contra o
 * dataset novo sem que ninguém precise reapertar nada.
 *
 * @param {object[]} rows união deduplicada de todos os arquivos
 * @param {object|null} meta metadados do período INTEIRO
 */
export function useDateFilter(rows, meta) {
  const [range, setRange] = useState({ from: null, to: null })

  const bounds = useMemo(
    () => ({
      periodStart: (meta && meta.periodStart) || null,
      periodEnd: (meta && meta.periodEnd) || null,
    }),
    [meta],
  )

  /** O intervalo pedido resolvido contra o que existe em disco. */
  const effective = useMemo(() => clampRange(range, bounds), [range, bounds])

  const empty = isEmptyRange(effective)
  const active = !isFullRange(range, bounds)

  const filteredRows = useMemo(
    () => filterRowsByRange(rows, effective),
    [rows, effective],
  )

  /**
   * Metadados do recorte. `EMPTY_META` em vez de `null` quando o recorte não
   * pega nada: a faixa de metadados precisa mostrar zero honestamente, e cair
   * de volta no meta completo faria a tela exibir os números do período inteiro
   * embaixo de um filtro que diz outra coisa.
   */
  const filteredMeta = useMemo(() => {
    if (!meta) return null
    return filteredRows.length ? datasetMeta(filteredRows) : EMPTY_META
  }, [meta, filteredRows])

  const setFrom = useCallback((from) => setRange((c) => ({ ...c, from: from || null })), [])
  const setTo = useCallback((to) => setRange((c) => ({ ...c, to: to || null })), [])
  const reset = useCallback(() => setRange({ from: null, to: null }), [])

  const selectLastDays = useCallback(
    (n) => setRange(lastNDays(bounds.periodEnd, n)),
    [bounds.periodEnd],
  )

  /** Qual atalho corresponde ao recorte atual, para marcar o botão. Null se nenhum. */
  const activeQuickRange = useMemo(() => {
    if (!active || empty) return null
    return (
      QUICK_RANGES.find((n) => {
        const q = clampRange(lastNDays(bounds.periodEnd, n), bounds)
        return q.from === effective.from && q.to === effective.to
      }) || null
    )
  }, [active, empty, bounds, effective])

  return {
    /** intervalo resolvido — é o que a UI mostra nos campos */
    range: effective,
    bounds,
    /** o recorte esconde alguma coisa? */
    active,
    /** o recorte não intersecta o período carregado? */
    empty,
    activeQuickRange,
    rows: filteredRows,
    meta: filteredMeta,
    setFrom,
    setTo,
    selectLastDays,
    reset,
  }
}
