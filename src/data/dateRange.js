/**
 * Recorte por data do que é EXIBIDO — nunca do que é ingerido.
 *
 * A distinção decide o desenho todo: filtrar aqui muda a leitura na tela e mais
 * nada. A série diária que alimenta o painel de observação continua sendo
 * gravada a partir do arquivo inteiro, no momento do upload (ver
 * `useReport.apply`), porque ela é acumulada entre uploads e deduplicada por
 * data — se o filtro chegasse até lá, esconder uma semana na tela apagaria
 * aquela semana do acompanhamento de forma permanente, sem aviso.
 *
 * Tudo aqui é puro e opera sobre chaves `YYYY-MM-DD`, o mesmo `dayKey` que
 * `normalize.js` grava em cada linha. Comparar essas chaves como STRING é
 * correto e proposital: o formato é lexicograficamente ordenável, então o
 * recorte não materializa `Date` nenhum e não tem como escorregar de fuso.
 */

import { dayKeyOf } from './normalize.js'

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86400000

/** É uma chave de dia bem formada? Entrada de `<input type="date">` vazia vira ''. */
export function isDayKey(value) {
  return typeof value === 'string' && DAY_KEY.test(value)
}

/** Soma `n` dias a uma chave de dia, em UTC. Devolve null se a chave for inválida. */
export function addDays(dayKey, n) {
  if (!isDayKey(dayKey) || !Number.isFinite(n)) return null
  const [y, m, d] = dayKey.split('-').map(Number)
  return dayKeyOf(new Date(Date.UTC(y, m - 1, d) + n * MS_PER_DAY))
}

/** Quantos dias o intervalo fechado [from, to] cobre. 0 quando não há interseção. */
export function rangeLengthDays(from, to) {
  if (!isDayKey(from) || !isDayKey(to)) return 0
  const [ya, ma, da] = from.split('-').map(Number)
  const [yb, mb, db] = to.split('-').map(Number)
  const diff = (Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / MS_PER_DAY
  return diff < 0 ? 0 : diff + 1
}

/**
 * Resolve o intervalo pedido contra o período que existe em disco.
 *
 * `null` em qualquer ponta significa "sem limite" e vira a borda do dataset, de
 * modo que o estado inicial `{from: null, to: null}` já é o período inteiro —
 * não existe um segundo caminho de código para "sem filtro".
 *
 * Cada ponta é apenas GRAMPEADA à borda correspondente. `from` posterior a `to`
 * sai daqui como está e é reportado por `isEmptyRange` — de propósito, e essa
 * foi a decisão menos óbvia deste módulo.
 *
 * A tentação é tratar `from > to` como dedo trocado e inverter as duas pontas.
 * Não dá: uma vez que as duas estão preenchidas, "digitei ao contrário" e "pedi
 * um intervalo que não existe no arquivo" são exatamente a mesma entrada. Com a
 * inversão, pedir 2030 num arquivo que termina em julho/2026 não dava erro
 * nenhum — virava, silenciosamente, o último dia do arquivo repetido nas duas
 * pontas, e a tela mostrava um dia qualquer como se fosse o que foi pedido.
 * Preferimos uma regra só, sem adivinhação: intervalo invertido não seleciona
 * nada e a barra diz isso em palavras.
 *
 * @param {{from: string|null, to: string|null}} range
 * @param {{periodStart: string|null, periodEnd: string|null}} bounds
 * @returns {{from: string|null, to: string|null}}
 */
export function clampRange(range, bounds) {
  const lo = isDayKey(bounds && bounds.periodStart) ? bounds.periodStart : null
  const hi = isDayKey(bounds && bounds.periodEnd) ? bounds.periodEnd : null

  let from = isDayKey(range && range.from) ? range.from : null
  let to = isDayKey(range && range.to) ? range.to : null

  if (lo && (!from || from < lo)) from = lo
  if (hi && (!to || to > hi)) to = hi

  return { from, to }
}

/**
 * O intervalo resolvido não alcança nenhum dia do dataset?
 *
 * Cobre os dois jeitos de chegar lá: data inicial depois da final, e intervalo
 * inteiramente fora do período carregado (que, depois do grampeamento, vira o
 * primeiro caso).
 */
export function isEmptyRange({ from, to } = {}) {
  return Boolean(from && to && from > to)
}

/** O intervalo resolvido é o período inteiro — ou seja, não recorta nada? */
export function isFullRange(range, bounds) {
  const lo = isDayKey(bounds && bounds.periodStart) ? bounds.periodStart : null
  const hi = isDayKey(bounds && bounds.periodEnd) ? bounds.periodEnd : null
  if (!lo || !hi) return true
  const { from, to } = clampRange(range, bounds)
  return from === lo && to === hi
}

/**
 * Linhas cujo dia cai no intervalo fechado [from, to].
 *
 * Devolve o MESMO array quando não há recorte. Não é microotimização: `rows`
 * atravessa vários `useMemo` e cada agregado do painel depende da identidade
 * dele para não remontar todo gráfico do Chart.js a cada render.
 *
 * @param {object[]} rows
 * @param {{from: string|null, to: string|null}} range
 */
export function filterRowsByRange(rows, range = {}) {
  const { from, to } = range
  if (!from && !to) return rows
  if (isEmptyRange(range)) return []
  return rows.filter((r) => {
    const k = r.dayKey
    if (!k) return false
    if (from && k < from) return false
    if (to && k > to) return false
    return true
  })
}

/**
 * Os últimos `n` dias do intervalo, ancorados no dia mais recente COM DADO —
 * não em hoje.
 *
 * O export do Guardian é semanal e chega com atraso: ancorar em `new Date()`
 * faria "últimos 7 dias" devolver zero linhas na segunda-feira seguinte, que é
 * exatamente quando alguém abre o relatório. A âncora é `periodEnd`.
 *
 * @param {string|null} periodEnd
 * @param {number} n
 */
export function lastNDays(periodEnd, n) {
  if (!isDayKey(periodEnd) || !Number.isFinite(n) || n < 1) return { from: null, to: null }
  return { from: addDays(periodEnd, -(n - 1)), to: periodEnd }
}
