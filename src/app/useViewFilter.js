import { useCallback, useMemo, useState } from 'react'

import { availableCauses, filterRowsByCause } from '../data/causeFilter.js'
import {
  clampRange,
  filterRowsByRange,
  isEmptyRange,
  isFullRange,
  lastNDays,
  rangeLengthDays,
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
 * Recorte da leitura na tela: período e causa raiz.
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
export function useViewFilter(rows, meta) {
  const [range, setRange] = useState({ from: null, to: null })
  /** Chave canônica da causa isolada; `null` mostra todas. */
  const [cause, setCause] = useState(null)

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
  const dateActive = !isFullRange(range, bounds)
  const active = dateActive || Boolean(cause)

  /**
   * Causas oferecidas no seletor. Saem do dado JÁ RECORTADO POR DATA, mas nunca
   * da própria causa selecionada — senão escolher uma causa apagaria as outras
   * da lista e não haveria como voltar sem limpar tudo.
   */
  const byDate = useMemo(() => filterRowsByRange(rows, effective), [rows, effective])
  const causes = useMemo(() => availableCauses(byDate), [byDate])

  const filteredRows = useMemo(() => filterRowsByCause(byDate, cause), [byDate, cause])

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
  const resetRange = useCallback(() => setRange({ from: null, to: null }), [])

  const selectLastDays = useCallback(
    (n) => setRange(lastNDays(bounds.periodEnd, n)),
    [bounds.periodEnd],
  )

  const selectCause = useCallback((next) => setCause(next || null), [])

  /**
   * Qual atalho corresponde ao recorte atual, para acender o botão.
   *
   * Deliberadamente NÃO exige que o recorte esteja estreitando alguma coisa.
   * Num export de exatamente 7 dias — o formato semanal, ou seja, o caso comum —
   * "últimos 7 dias" é o período inteiro: exigir `dateActive` deixava o botão
   * apagado depois do clique e o app parecia não ter reagido. Aceso, ele diz que
   * o clique valeu e que aquilo já é o que está na tela. Nesse caso "Tudo"
   * acende junto, e está correto: os dois nomeiam o mesmo intervalo.
   */
  const activeQuickRange = useMemo(() => {
    if (empty || !bounds.periodEnd) return null
    return (
      QUICK_RANGES.find((n) => {
        const q = clampRange(lastNDays(bounds.periodEnd, n), bounds)
        return q.from === effective.from && q.to === effective.to
      }) || null
    )
  }, [empty, bounds, effective])

  /** Dias que o período carregado cobre — atalho maior que isso não estreita nada. */
  const loadedDays = rangeLengthDays(bounds.periodStart, bounds.periodEnd)

  return {
    /** intervalo resolvido — é o que a UI mostra nos campos */
    range: effective,
    bounds,
    cause,
    causes,
    /** quantos dias o arquivo carregado cobre */
    loadedDays,
    /** algum recorte esconde alguma coisa? */
    active,
    /** só o recorte de data, para o estado do botão "Tudo" */
    dateActive,
    /** o intervalo não intersecta o período carregado? */
    empty,
    activeQuickRange,
    rows: filteredRows,
    meta: filteredMeta,
    setFrom,
    setTo,
    selectLastDays,
    selectCause,
    resetRange,
  }
}
