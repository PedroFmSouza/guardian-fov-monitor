import {
  mount,
  getChart,
  C,
  FONT_COND,
  withAlpha,
  drawGapBands,
  applyChartDefaults,
} from './base.js'
import { offsetToClock } from '../aggregate/byHourVehicle.js'

/**
 * Passos de rótulo, do mais grosso ao mais fino, em minutos.
 *
 * São múltiplos do relógio (2 dias, 1 dia, 12h, 3h, 1h, 30min…), não os
 * "números redondos" que um eixo linear escolheria sozinho: em minutos, o passo
 * bonito do Chart.js seria 100 ou 500 — que como tempo não significam nada.
 */
const TICK_STEPS = [2880, 1440, 720, 360, 180, 120, 60, 30, 15, 10, 5, 1]

/** Passo mais fino que ainda cabe sem amontoar rótulo. */
function pickTickStep(spanMinutes, maxTicks = 22) {
  let chosen = TICK_STEPS[0]
  for (const step of TICK_STEPS) {
    if (spanMinutes / step <= maxTicks) chosen = step
  }
  return chosen
}

const pad = (n) => String(n).padStart(2, '0')

function formatTick(windowStart, offset, step) {
  const t = offsetToClock(windowStart, offset)
  const asDay = `${t.day.slice(8, 10)}/${t.day.slice(5, 7)}`
  if (step >= 1440) return asDay
  // a virada do dia continua ganhando a data: sem isso, uma tira de horas some
  // do calendário e o leitor não sabe mais em que dia está
  if (t.hour === 0 && t.minute === 0) return asDay
  if (step >= 60) return `${pad(t.hour)}h`
  return `${pad(t.hour)}:${pad(t.minute)}`
}

/**
 * Marcações sobre a série:
 *  · faixa sombreada cobrindo tudo depois da manutenção;
 *  · linha vertical tracejada na primeira hora do dia da intervenção;
 *  · faixa hachurada nos dias que o export não cobre.
 *
 * NÃO há linha de limiar aqui, de propósito: o limiar de reincidência é um
 * valor por DIA e este eixo é sub-diário. Desenhá-lo compararia uma contagem de
 * minutos com um critério diário — o número certo na escala errada.
 */
const timelineMarks = {
  id: 'timelineMarks',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return
    if (opts.cutX != null) {
      const raw = scales.x.getPixelForValue(opts.cutX)
      const x = Math.max(chartArea.left, Math.min(chartArea.right, raw))
      ctx.save()
      ctx.fillStyle = C.shadeShift2
      ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top)
      ctx.restore()
    }
    drawGapBands(ctx, chartArea, scales, opts.gaps, {
      label: 'SEM DADO',
      color: C.slate,
      byValue: true,
    })
  },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts || opts.cutX == null) return
    const x = scales.x.getPixelForValue(opts.cutX)
    if (x < chartArea.left || x > chartArea.right) return
    ctx.save()
    ctx.strokeStyle = C.red
    ctx.lineWidth = 1.4
    ctx.setLineDash([5, 3])
    ctx.beginPath()
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.red
    ctx.font = `10px ${FONT_COND}`
    const toLeft = x > (chartArea.left + chartArea.right) / 2
    ctx.textAlign = toLeft ? 'right' : 'left'
    ctx.fillText('MANUTENÇÃO', toLeft ? x - 4 : x + 4, chartArea.top + 10)
    ctx.restore()
  },
}

/** Enquadramento atual: o que decide a resolução e o que está à vista. */
function viewport(chart) {
  const scale = chart.scales.x
  const area = chart.chartArea
  return {
    spanMinutes: scale.max - scale.min,
    widthPx: area ? area.right - area.left : 0,
    from: scale.min,
    to: scale.max,
  }
}

/**
 * Exceções de FOV de UMA causa ao longo do tempo, em resolução variável.
 *
 * O eixo x é o MINUTO decorrido desde o início da janela, não o índice do ponto.
 * É isso que permite trocar a resolução (hora → 15min → 5min → minuto) sem
 * perder o enquadramento: mudar o bin muda quantos pontos existem, e não onde
 * cada instante cai no eixo. A troca é feita por `updateBinnedChart`, que
 * substitui os dados no lugar — recriar o gráfico zeraria o zoom bem no meio do
 * gesto que pediu mais detalhe.
 *
 * @param {string} canvasId
 * @param {object} series saída de `binnedCauseSeries`
 * @param {{causeLabel?: string, zoom?: boolean,
 *          onViewportChange?: (view: {spanMinutes: number, widthPx: number,
 *                                     from: number, to: number}) => void}} opts
 */
export function renderBinnedChart(canvasId, series, opts) {
  applyChartDefaults()
  const { causeLabel = 'Exceções', zoom = false, onViewportChange } = opts
  const color = C.primary
  const { windowStart, spanMinutes } = series

  const report = (chart) => {
    if (!onViewportChange) return
    onViewportChange(viewport(chart))
  }

  const chart = mount(canvasId, {
    type: 'line',
    data: {
      datasets: [
        {
          label: causeLabel,
          data: series.points,
          borderColor: color,
          backgroundColor: withAlpha(color, 0.18),
          borderWidth: 1.4,
          // marcador só quando há pixel para ele; com a janela inteira aberta
          // são centenas de pontos e eles viram uma faixa sólida
          pointRadius: (ctx) => {
            const scale = ctx.chart.scales.x
            const bin = ctx.chart.$binMinutes || 60
            return (scale.max - scale.min) / bin <= 150 ? 2 : 0
          },
          pointHoverRadius: 4,
          pointBackgroundColor: color,
          pointBorderColor: color,
          fill: 'origin',
          tension: 0,
          spanGaps: false,
        },
      ],
    },
    options: {
      // pontos já vêm como {x, y} ordenados: dispensa o parse do Chart.js e
      // deixa ele achar a faixa visível por busca binária, o que importa no bin
      // de um minuto (dezenas de milhares de pontos)
      parsing: false,
      normalized: true,
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      plugins: {
        legend: { display: false },
        timelineMarks: { cutX: series.cutX, gaps: series.gaps },
        tooltip: {
          callbacks: {
            title: (items) => {
              const bin = items[0].chart.$binMinutes || 60
              const from = offsetToClock(windowStart, items[0].parsed.x)
              const to = offsetToClock(windowStart, items[0].parsed.x + bin - 1)
              return `${from.day}, ${pad(from.hour)}:${pad(from.minute)} → ${pad(to.hour)}:${pad(to.minute)}`
            },
            label: (item) => {
              const n = item.parsed.y
              return `${n} ${n === 1 ? 'exceção' : 'exceções'} · ${causeLabel}`
            },
          },
        },
        zoom: zoom
          ? {
              limits: { x: { min: 'original', max: 'original', minRange: 15 } },
              pan: {
                enabled: true,
                mode: 'x',
                modifierKey: null,
                onPanComplete: ({ chart: c }) => report(c),
              },
              zoom: {
                wheel: { enabled: true, speed: 0.12 },
                pinch: { enabled: true },
                drag: { enabled: false },
                mode: 'x',
                onZoomComplete: ({ chart: c }) => report(c),
              },
            }
          : {
              pan: { enabled: false },
              zoom: { wheel: { enabled: false }, pinch: { enabled: false } },
            },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: spanMinutes,
          grid: { display: false },
          border: { color: C.ink },
          // os ticks são gerados na mão, alinhados ao relógio
          afterBuildTicks(scale) {
            const step = pickTickStep(scale.max - scale.min)
            const ticks = []
            for (let v = Math.ceil(scale.min / step) * step; v <= scale.max; v += step) {
              ticks.push({ value: v })
            }
            scale.ticks = ticks
          },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            font: { size: 9 },
            callback(value) {
              return formatTick(windowStart, value, pickTickStep(this.max - this.min))
            },
          },
        },
        y: {
          beginAtZero: true,
          grid: { color: C.rule, drawTicks: false },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 4, font: { size: 9 } },
        },
      },
    },
    plugins: [timelineMarks],
  })

  if (chart) chart.$binMinutes = series.binMinutes
  return chart
}

/**
 * Troca só os dados, mantendo o enquadramento.
 *
 * É o caminho da mudança de resolução: recriar o gráfico devolveria o eixo ao
 * início e o zoom se perderia exatamente no gesto que pediu mais detalhe.
 */
export function updateBinnedChart(canvasId, series) {
  const chart = getChart(canvasId)
  if (!chart) return null
  chart.$binMinutes = series.binMinutes
  chart.data.datasets[0].data = series.points
  chart.update('none')
  return chart
}
