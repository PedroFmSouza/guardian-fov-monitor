import {
  mount,
  C,
  FONT_COND,
  withAlpha,
  drawGapBands,
  nullRuns,
  applyChartDefaults,
} from './base.js'
import { isFirstShiftHour } from '../aggregate/byHour.js'
import { SHIFT_FIRST_START, SHIFT_FIRST_END } from '../data/normalize.js'

/**
 * Tendência diária da frota inteira — uma linha só.
 *
 * De propósito NÃO é partida por turno: a divisão 1º/2º já é a leitura do card
 * de cada equipamento, e aqui a pergunta é outra — a frota está melhorando ou
 * piorando? Uma série única também dispensa legenda e não depende de o leitor
 * distinguir duas cores.
 *
 * @param {string} canvasId
 * @param {string[]} days
 * @param {number[]} values
 */
const trendGaps = {
  id: 'fleetTrendGaps',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return
    drawGapBands(ctx, chartArea, scales, opts.runs, { label: 'SEM DADO', color: C.slate })
  },
}

export function renderFleetTrendChart(canvasId, days, values) {
  applyChartDefaults()
  const color = C.primary

  return mount(canvasId, {
    type: 'line',
    data: {
      labels: days.map((d) => d.slice(5).replace('-', '/')),
      datasets: [
        {
          label: 'Exceções de FOV',
          data: values,
          borderColor: color,
          backgroundColor: withAlpha(color, 0.14),
          borderWidth: 2,
          pointRadius: days.length > 45 ? 0 : 2,
          pointHoverRadius: 4,
          pointBackgroundColor: color,
          pointBorderColor: color,
          fill: 'origin',
          tension: 0.2,
          spanGaps: false,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        fleetTrendGaps: { runs: nullRuns(values) },
        tooltip: {
          callbacks: {
            title: (items) => days[items[0].dataIndex],
            label: (item) => {
              const n = item.parsed.y
              return `${n} ${n === 1 ? 'exceção de FOV' : 'exceções de FOV'} na frota`
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: C.ink },
          ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
        },
        y: {
          beginAtZero: true,
          grid: { color: C.rule, drawTicks: false },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 4, font: { size: 9 } },
        },
      },
    },
    plugins: [trendGaps],
  })
}

/**
 * Sombreia o fundo por turno (1º 06–18, 2º 18–06).
 *
 * Duas faixas, não 24 colunas: em eixo linear as colunas adjacentes deixam
 * costura visível a cada hora, e o que se quer ler é o bloco do turno. A
 * fronteira fica no meio da coluna da hora, acompanhando a largura de cada uma.
 */
const shiftShading = {
  id: 'fleetHourShiftShading',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !scales.x) return
    const height = chartArea.bottom - chartArea.top
    const clamp = (v) =>
      Math.min(chartArea.right, Math.max(chartArea.left, scales.x.getPixelForValue(v)))
    const start = clamp(SHIFT_FIRST_START - 0.5)
    const end = clamp(SHIFT_FIRST_END - 0.5)

    ctx.save()
    // faixas sem sobreposição: os tokens são translúcidos, empilhar dois
    // preenchimentos na mesma área daria uma terceira cor que não existe
    ctx.fillStyle = C.shadeShift2
    ctx.fillRect(chartArea.left, chartArea.top, start - chartArea.left, height)
    ctx.fillRect(end, chartArea.top, chartArea.right - end, height)
    ctx.fillStyle = C.shadeShift1
    ctx.fillRect(start, chartArea.top, end - start, height)
    ctx.restore()
  },
}

/** Marca a hora de pico com um traço vertical rotulado por extenso. */
const peakMark = {
  id: 'fleetHourPeak',
  afterDatasetsDraw(chart, _args, opts) {
    const hour = opts && opts.hour
    if (hour == null) return
    const { ctx, chartArea, scales } = chart
    if (!chartArea) return
    const x = scales.x.getPixelForValue(hour)
    ctx.save()
    ctx.strokeStyle = C.slate
    ctx.lineWidth = 1
    ctx.setLineDash([2, 3])
    ctx.beginPath()
    ctx.moveTo(x, chartArea.top)
    ctx.lineTo(x, chartArea.bottom)
    ctx.stroke()
    ctx.setLineDash([])
    ctx.fillStyle = C.slate
    ctx.font = `9px ${FONT_COND}`
    // perto da borda direita o rótulo sairia do quadro — vira para a esquerda
    const toLeft = x > (chartArea.left + chartArea.right) / 2
    ctx.textAlign = toLeft ? 'right' : 'left'
    ctx.fillText(
      `pico ${String(hour).padStart(2, '0')}h`,
      toLeft ? x - 3 : x + 3,
      chartArea.top + 9,
    )
    ctx.restore()
  },
}

/**
 * Perfil por hora do dia da frota inteira.
 *
 * Mesmo desenho dos piores dias de um equipamento (`renderWorstDayChart`), de
 * propósito: quem aprendeu a ler um lê o outro sem recomeçar. O que muda é o
 * recorte — aqui é a frota somada no período todo.
 *
 * @param {string} canvasId
 * @param {{hours: number[], peakHour: number|null}} profile
 */
export function renderFleetHourChart(canvasId, profile) {
  applyChartDefaults()
  const color = C.primary

  return mount(canvasId, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Exceções de FOV',
          // pontos {x,y} explícitos: em eixo linear, deixar o índice do array
          // virar x por coerção depende de `labels` e falha silenciosamente
          data: profile.hours.map((y, x) => ({ x, y })),
          borderColor: color,
          backgroundColor: withAlpha(color, 0.18),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: color,
          fill: 'origin',
          tension: 0.25,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        fleetHourPeak: { hour: profile.peakHour },
        tooltip: {
          callbacks: {
            title: (items) => {
              const h = String(items[0].parsed.x).padStart(2, '0')
              return `das ${h}:00 às ${h}:59`
            },
            label: (item) => {
              const n = item.parsed.y
              return `${n} ${n === 1 ? 'exceção de FOV' : 'exceções de FOV'}`
            },
            afterBody: (items) =>
              isFirstShiftHour(items[0].parsed.x) ? '1º turno (06h–18h)' : '2º turno (18h–06h)',
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 23,
          grid: { display: false },
          border: { color: C.ink },
          ticks: {
            stepSize: 3,
            autoSkip: false,
            maxRotation: 0,
            font: { size: 9 },
            callback: (v) => `${String(v).padStart(2, '0')}h`,
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
    plugins: [shiftShading, peakMark],
  })
}
