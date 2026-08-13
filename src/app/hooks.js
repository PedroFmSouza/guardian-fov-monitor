import { createContext, useCallback, useContext, useEffect, useRef } from 'react'
import { destroy } from '../charts/base.js'

/**
 * Contador de trocas de tema.
 *
 * O Chart.js copia as cores para dentro do dataset no momento da criação e não
 * volta a olhar o CSS. Trocar o tema exige RECRIAR cada gráfico — e o caminho
 * barato para isso é entrar na assinatura de todo `useChart`. Um contexto em
 * vez de uma prop porque o valor não interessa a nenhum componente no meio do
 * caminho, só às folhas que desenham.
 */
export const ChartThemeContext = createContext(0)

/**
 * Ponte entre o React e os wrappers de Chart.js.
 *
 * Chart.js é imperativo e dono do canvas: o React renderiza o `<canvas id=...>`
 * e o gráfico é montado depois, no efeito, quando o nó já existe no DOM. A
 * limpeza destrói a instância — é o que o `renderWatchlist` antigo fazia à mão
 * com uma lista `mountedCanvasIds`, e que agora acompanha o ciclo de vida do
 * componente sem ninguém precisar lembrar.
 *
 * `signature` é a identidade dos dados: mudou, o gráfico é refeito. Como a
 * animação é desligada (ver `applyChartDefaults`), recriar é barato e evita
 * toda a classe de bug de atualização parcial de dataset.
 *
 * @param {string|null} canvasId nulo desliga o efeito (canvas não renderizado)
 * @param {() => void} draw monta o gráfico; lido por ref, não precisa ser estável
 * @param {string} signature identidade dos dados desenhados
 */
export function useChart(canvasId, draw, signature) {
  const drawRef = useRef(draw)
  drawRef.current = draw
  const themeEpoch = useContext(ChartThemeContext)

  useEffect(() => {
    if (!canvasId) return undefined
    drawRef.current()
    return () => destroy(canvasId)
  }, [canvasId, signature, themeEpoch])
}

/**
 * Listener nativo num nó controlado por ref.
 *
 * Usado de propósito nos campos de data/observação e no input de arquivo, em vez
 * do `onChange` do React. Motivos, nessa ordem:
 *
 *  1. a semântica desejada é a do evento `change` nativo — comitar quando o
 *     valor é confirmado, não a cada tecla. Com `onChange` do React (que dispara
 *     no `input`) cada tecla viraria um setState, e cada setState remontaria os
 *     gráficos do card;
 *  2. o React rastreia o valor do input para deduplicar eventos, então um
 *     `change` disparado por script depois de atribuir `.value` é engolido. O
 *     listener nativo não passa por esse rastreador.
 *
 * Devolve uma **ref de callback**, não um efeito. A diferença não é estilística:
 * um efeito com `[ref]` nas dependências não roda de novo quando o React troca
 * o nó do DOM (a identidade do objeto de ref não muda), e o listener fica preso
 * ao nó antigo, já removido da árvore. A ref de callback é chamada com `null` na
 * saída e com o nó novo na entrada — é o único ponto que enxerga a troca.
 *
 * @param {{current: HTMLElement|null}} ref também preenchida, para ler `.value`
 * @returns {(node: HTMLElement|null) => void} passar em `ref={...}` no JSX
 */
export function useNativeListener(ref, type, handler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler
  const detach = useRef(null)

  return useCallback(
    (node) => {
      if (detach.current) {
        detach.current()
        detach.current = null
      }
      ref.current = node
      if (!node) return
      const fn = (event) => handlerRef.current(event)
      node.addEventListener(type, fn)
      detach.current = () => node.removeEventListener(type, fn)
    },
    [ref, type],
  )
}
