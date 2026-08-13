import Chart from 'chart.js/auto'
import zoomPlugin from 'chartjs-plugin-zoom'

// Empacotado pelo Vite como todo o resto — nenhuma requisição de rede em runtime.
Chart.register(zoomPlugin)

/**
 * Tokens do sistema visual — lidos do CSS (:root em styles/main.css) na
 * primeira montagem de gráfico, para que CSS seja a única fonte de verdade
 * das cores. Os valores abaixo são só fallback defensivo (SSR/testes sem
 * folha de estilo aplicada).
 */
export const C = {
  ink: '#14181D',
  slate: '#56616E',
  rule: '#DDE2E8',
  primary: '#17475F',
  amber: '#B26A00',
  red: '#9E2F27',
  teal: '#0D6B54',
  violet: '#6B4C9A',
  surface: '#FFFFFF',
  neutral: '#9AA7B2',
  compare: '#C3CCD3',
  dim: '#DCE2E7',
  shadeShift1: 'rgba(23,71,95,0.055)',
  shadeShift2: 'rgba(14,20,27,0.045)',
  tooltipBg: '#14181D',
}

const CSS_VAR_BY_KEY = {
  ink: '--color-text',
  slate: '--color-text-muted',
  rule: '--color-border',
  primary: '--color-primary',
  amber: '--color-warning',
  red: '--color-critical',
  teal: '--color-success',
  violet: '--color-series-2',
  surface: '--color-surface',
  neutral: '--color-chart-neutral',
  compare: '--color-chart-compare',
  dim: '--color-chart-dim',
  shadeShift1: '--color-shade-shift1',
  shadeShift2: '--color-shade-shift2',
  tooltipBg: '--color-tooltip-bg',
}

function readColorTokensFromCss() {
  if (typeof document === 'undefined') return
  const computed = getComputedStyle(document.documentElement)
  for (const [key, cssVar] of Object.entries(CSS_VAR_BY_KEY)) {
    const value = computed.getPropertyValue(cssVar).trim()
    if (value) C[key] = value
  }
}

export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace"
export const FONT_COND = "'IBM Plex Sans Condensed', 'IBM Plex Sans', sans-serif"

/**
 * A mesma cor com alfa aplicado — para área sob a linha sem inventar um segundo
 * token de cor por tema. Os tokens de `C` são hex (#rrggbb); qualquer outro
 * formato volta inalterado, o que rende um preenchimento sólido em vez de um
 * `undefined` que apagaria a área.
 */
export function withAlpha(color, alpha) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim())
  if (!m) return color
  const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  const n = parseInt(hex, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
}

/**
 * Faixa hachurada sobre trechos em que a linha não tem o que plotar.
 *
 * Compartilhada por todos os gráficos de série temporal do app, porque o
 * problema é o mesmo em todos: a linha quebra de propósito (`spanGaps: false`)
 * quando o dia não tem dado — plotar zero afirmaria que não houve exceção num
 * dia que ninguém mediu. Sem a faixa, porém, a quebra é indistinguível de um
 * defeito de renderização: é a diferença entre "o gráfico bugou" e "faltam
 * exports desses dias".
 *
 * O rótulo diz QUAL é o motivo, que nem sempre é o mesmo — daí ser parâmetro:
 *  · `SEM DADO`  — nenhum arquivo carregado cobre o dia;
 *  · `SEM TURNO` — o dia existe e conta nos vereditos, mas foi gravado sem a
 *                  divisão por turno.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{top: number, bottom: number, left: number, right: number}} chartArea
 * @param {object} scales escalas do Chart.js (usa a x)
 * @param {number[][]} runs pares [início, fim] de índices inclusivos
 * @param {{label: string, color: string}} opts
 */
export function drawGapBands(ctx, chartArea, scales, runs, { label, color }) {
  if (!Array.isArray(runs) || !runs.length) return
  const { top, bottom, left, right } = chartArea
  const height = bottom - top
  // largura de um passo no eixo; com um ponto só não há vão a marcar
  const step = Math.abs(scales.x.getPixelForValue(1) - scales.x.getPixelForValue(0))
  if (!Number.isFinite(step) || step <= 0) return

  for (const [from, to] of runs) {
    const x0 = Math.max(left, scales.x.getPixelForValue(from) - step / 2)
    const x1 = Math.min(right, scales.x.getPixelForValue(to) + step / 2)
    if (!(x1 > x0)) continue // trecho inteiro fora do enquadramento atual

    ctx.save()
    ctx.beginPath()
    ctx.rect(x0, top, x1 - x0, height)
    ctx.clip()
    ctx.fillStyle = withAlpha(color, 0.1)
    ctx.fillRect(x0, top, x1 - x0, height)

    // hachura diagonal: lê como "área sem medição" sem competir com as séries
    ctx.strokeStyle = withAlpha(color, 0.3)
    ctx.lineWidth = 1
    ctx.beginPath()
    for (let x = x0 - height; x < x1; x += 7) {
      ctx.moveTo(x, bottom)
      ctx.lineTo(x + height, top)
    }
    ctx.stroke()
    ctx.restore()

    if (x1 - x0 >= 46) {
      ctx.save()
      ctx.fillStyle = color
      ctx.font = `9px ${FONT_COND}`
      ctx.textAlign = 'center'
      ctx.fillText(label, (x0 + x1) / 2, top + 10)
      ctx.restore()
    }
  }
}

/** Trechos contínuos de `null` numa série — os vãos que a faixa marca. */
export function nullRuns(values) {
  const runs = []
  let start = -1
  for (let i = 0; i < values.length; i++) {
    const empty = values[i] === null || values[i] === undefined
    if (empty && start === -1) start = i
    else if (!empty && start !== -1) {
      runs.push([start, i - 1])
      start = -1
    }
  }
  if (start !== -1) runs.push([start, values.length - 1])
  return runs
}

let defaultsApplied = false

/**
 * Chamado ao alternar o tema: força reler os tokens de cor do CSS na próxima
 * montagem e reaplica os defaults do Chart.js já ajustados ao tema atual. Os
 * gráficos precisam ser remontados (ver `main.js`) para os datasets já
 * desenhados pegarem as novas cores — `C` é lido por valor a cada render.
 */
export function refreshColorTokens() {
  defaultsApplied = false
  applyChartDefaults()
}

export function applyChartDefaults() {
  if (defaultsApplied) return
  defaultsApplied = true
  readColorTokensFromCss()
  Chart.defaults.font.family = FONT_MONO
  Chart.defaults.font.size = 11
  Chart.defaults.color = C.slate
  // SEM animação, de propósito. A animação desenha o primeiro quadro dentro de
  // um requestAnimationFrame, que o navegador congela em aba/janela em segundo
  // plano: um gráfico montado nesse estado (recarregamento do dev server, ou a
  // página aberta atrás do editor) ficava EM BRANCO até um resize. Sem
  // animação, o desenho acontece de forma síncrona na criação.
  Chart.defaults.animation = false
  Chart.defaults.animations = { colors: false, x: false, y: false }
  Chart.defaults.transitions = { active: { animation: { duration: 0 } } }
  Chart.defaults.maintainAspectRatio = false
  Chart.defaults.plugins.legend.labels.font = { family: FONT_COND, size: 11 }
  Chart.defaults.plugins.legend.labels.boxWidth = 12
  Chart.defaults.plugins.legend.labels.boxHeight = 12
  Chart.defaults.plugins.tooltip.backgroundColor = C.tooltipBg
  Chart.defaults.plugins.tooltip.titleFont = { family: FONT_COND, size: 12 }
  Chart.defaults.plugins.tooltip.bodyFont = { family: FONT_MONO, size: 11 }
  Chart.defaults.plugins.tooltip.cornerRadius = 0
  Chart.defaults.plugins.tooltip.padding = 9
  Chart.defaults.plugins.tooltip.displayColors = true
  Chart.defaults.plugins.tooltip.boxPadding = 4
}

/** Eixos com hairline, sem grade vertical — leitura de documento, não dashboard. */
export const axisStyle = {
  grid: { color: C.rule, drawTicks: false, drawBorder: false },
  border: { color: C.rule },
  ticks: { padding: 6, font: { family: FONT_MONO, size: 10 } },
}

export const categoryAxisStyle = {
  grid: { display: false, drawBorder: false },
  border: { color: C.ink },
  ticks: { padding: 5, font: { family: FONT_MONO, size: 10 }, autoSkip: false },
}

const instances = new Map()

// Superfície de introspecção para QA (scripts/smoke.mjs) — a aplicação não lê.
if (typeof window !== 'undefined') window.__gfmCharts = instances

/**
 * Cria (ou substitui) o gráfico do canvas informado.
 *
 * Falha de um gráfico não pode derrubar os outros: sem o try/catch, uma exceção
 * aqui interrompia o laço que monta os cards e TODOS os canvas seguintes
 * ficavam em branco, sem nada na tela indicando o motivo.
 */
export function mount(canvasId, config) {
  applyChartDefaults()
  const canvas = document.getElementById(canvasId)
  if (!canvas) return null
  const existing = instances.get(canvasId)
  if (existing) existing.destroy()
  try {
    const chart = new Chart(canvas.getContext('2d'), config)
    instances.set(canvasId, chart)
    return chart
  } catch (err) {
    instances.delete(canvasId)
    console.error(`Falha ao desenhar o gráfico "${canvasId}":`, err)
    return null
  }
}

/**
 * Redesenha tudo que está montado. Rede de segurança para o caso de um gráfico
 * ter sido criado com a página oculta (ver applyChartDefaults): ao voltar para
 * a aba, o canvas é reconstruído com o tamanho real do container.
 */
/** Volta o gráfico ao enquadramento original (botão "Ver tudo"). */
export function resetZoom(canvasId) {
  const chart = instances.get(canvasId)
  if (chart && typeof chart.resetZoom === 'function') chart.resetZoom()
}

export function redrawAll() {
  for (const chart of instances.values()) {
    try {
      chart.resize()
      chart.update('none')
    } catch {
      /* gráfico já destruído — ignorar */
    }
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) redrawAll()
  })
}

export function destroy(canvasId) {
  const existing = instances.get(canvasId)
  if (existing) {
    existing.destroy()
    instances.delete(canvasId)
  }
}

export { Chart }
