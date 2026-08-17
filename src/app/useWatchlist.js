import { useCallback, useState } from 'react'

import {
  loadWatchlist,
  saveWatchlist,
  loadDaily,
  saveDaily,
  mergeDaily,
  addEntry,
  addEntries,
  removeEntry,
  patchEntry,
} from '../persistence/watchlist.js'

/**
 * Lista de observação + série diária acumulada.
 *
 * A lista é 100% manual: nenhum upload adiciona ou remove equipamentos. Só a
 * SÉRIE cresce com os uploads — e cresce para todos os equipamentos, não só
 * para os observados, que é o que faz recolocar um equipamento em observação
 * trazer o histórico dele de volta. Encerrar a observação some com o card,
 * nunca com a série.
 *
 * Lista e data sugerida vivem no MESMO estado porque vivem na mesma chave do
 * localStorage: separá-las abriria a porta para gravar uma com a versão velha
 * da outra.
 */
export function useWatchlist() {
  const [list, setList] = useState(() => {
    const stored = loadWatchlist()
    return { entries: stored.entries, defaultDate: stored.defaultDate }
  })
  const [daily, setDaily] = useState(() => loadDaily())

  /** Aplica uma transformação na lista e persiste o resultado. */
  const update = useCallback((fn) => {
    setList((current) => {
      const next = fn(current)
      if (next === current) return current
      saveWatchlist(next)
      return next
    })
  }, [])

  const add = useCallback(
    (vehicle, maintenanceDate, note) => {
      update((current) => {
        const entries = addEntry(current.entries, vehicle, maintenanceDate, note)
        if (entries === current.entries) return current
        return { entries, defaultDate: maintenanceDate || current.defaultDate }
      })
    },
    [update],
  )

  /**
   * Entrada em lote — o botão que coloca os piores do ranking em observação.
   *
   * Uma única transação: um `setList`, uma gravação no localStorage. Chamar
   * `add` em laço funcionaria (o `update` é funcional), mas gravaria a lista
   * inteira uma vez por equipamento.
   *
   * @returns {string[]} quem de fato entrou — quem já estava é ignorado
   */
  const addMany = useCallback(
    (vehicles, maintenanceDate, note) => {
      const { added } = addEntries(list.entries, vehicles, maintenanceDate, note)
      update((current) => {
        const next = addEntries(current.entries, vehicles, maintenanceDate, note)
        if (next.entries === current.entries) return current
        return { entries: next.entries, defaultDate: maintenanceDate || current.defaultDate }
      })
      return added
    },
    [list.entries, update],
  )

  const remove = useCallback(
    (vehicle) => update((c) => ({ ...c, entries: removeEntry(c.entries, vehicle) })),
    [update],
  )

  const patch = useCallback(
    (vehicle, changes) =>
      update((c) => ({
        ...c,
        entries: patchEntry(c.entries, vehicle, changes),
      })),
    [update],
  )

  /** Data sugerida no formulário; não altera quem já está em observação. */
  const setDefaultDate = useCallback(
    (date) => update((c) => ({ ...c, defaultDate: date })),
    [update],
  )

  /**
   * Funde a série do upload na persistida. A contagem do dia é ATRIBUÍDA, nunca
   * somada — é o que torna subir a mesma planilha duas vezes idempotente.
   */
  const mergeSeries = useCallback((series) => {
    setDaily((current) => {
      const next = mergeDaily(current, series)
      saveDaily(next)
      return next
    })
  }, [])

  return {
    entries: list.entries,
    defaultDate: list.defaultDate,
    daily,
    add,
    addMany,
    remove,
    patch,
    setDefaultDate,
    mergeSeries,
  }
}
