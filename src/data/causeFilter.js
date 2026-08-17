/**
 * Recorte por causa raiz do que é EXIBIDO.
 *
 * Mesma natureza do recorte por data (ver `dateRange.js`): mexe na leitura da
 * tela e não na ingestão. Nada aqui alcança a série diária do painel de
 * observação, que é gravada no upload a partir do arquivo inteiro.
 *
 * A causa vive só em linha de FOV — `normalizeRows` grava `cause: null` em
 * qualquer outro tipo de evento. Então isolar uma causa necessariamente descarta
 * os eventos que não são FOV, e é isso que se quer: "mostre só quem está com a
 * câmera desalinhada" é uma pergunta sobre exceções de FOV, não sobre fadiga ou
 * distração, que não têm causa de FOV nenhuma.
 */

import { OTHER_CAUSE } from './normalize.js'

/** Causa de uma linha, com o mesmo fallback que os agregados usam. */
const causeOf = (row) => row.cause || OTHER_CAUSE

/**
 * Linhas da causa pedida. `null` desliga o recorte.
 *
 * Devolve o MESMO array quando não recorta — a identidade de `rows` é o que
 * segura os `useMemo` dos painéis e evita remontar todo gráfico do Chart.js.
 *
 * @param {object[]} rows
 * @param {string|null} cause chave canônica, ex. 'camera misaligned'
 */
export function filterRowsByCause(rows, cause) {
  if (!cause) return rows
  return rows.filter((r) => r.isFov && causeOf(r) === cause)
}

/**
 * Causas presentes nas linhas, da mais frequente para a menos.
 *
 * Só as que existem no dado carregado. Diferente do gráfico de causa raiz, que
 * plota as causas conhecidas mesmo zeradas de propósito (a barra vazia afirma
 * que aquela causa foi verificada e não ocorreu): num seletor, oferecer uma
 * opção que leva a uma tela vazia não afirma nada, só desperdiça um clique.
 *
 * @returns {{cause: string, count: number}[]}
 */
export function availableCauses(rows) {
  const counts = new Map()
  for (const r of rows || []) {
    if (!r.isFov) continue
    const c = causeOf(r)
    counts.set(c, (counts.get(c) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([cause, count]) => ({ cause, count }))
    .sort((a, b) => b.count - a.count || a.cause.localeCompare(b.cause, 'pt-BR'))
}
