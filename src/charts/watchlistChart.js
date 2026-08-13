import { mount, C, FONT_COND, drawGapBands, applyChartDefaults } from './base.js'
import { OBS_STATUS } from '../aggregate/byDailyVehicle.js'

/**
 * Marcações da observação, desenhadas em um plugin local — evita depender de
 * chartjs-plugin-annotation só para um traço e uma faixa:
 *  · linha vertical tracejada no dia da manutenção;
 *  · faixa sombreada cobrindo a janela de observação (pós-manutenção);
 *  · faixa hachurada nos dias que nenhum arquivo cobre;
 *  · linha horizontal no limiar de reincidência.
 */
const observationMarks = {
  id: 'observationMarks',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return
    const idx = opts.index
    if (idx != null && idx >= 0) {
      const x = scales.x.getPixelForValue(idx)
      ctx.save()
      ctx.fillStyle = C.shadeShift2
      ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top)
      ctx.restore()
    }
    // depois do sombreado pós-manutenção: o vão precisa aparecer nos dois lados
    drawGapBands(ctx, chartArea, scales, opts.gaps, { label: 'SEM DADO', color: C.slate })
    // âmbar, não neutro: aqui existe dado — o que falta é só a divisão por turno
    drawGapBands(ctx, chartArea, scales, opts.unsplit, { label: 'SEM TURNO', color: C.amber })
  },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return

    if (opts.threshold != null && opts.threshold > 0) {
      const y = scales.y.getPixelForValue(opts.threshold)
      if (y >= chartArea.top && y <= chartArea.bottom) {
        ctx.save()
        ctx.strokeStyle = C.amber
        ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        ctx.beginPath()
        ctx.moveTo(chartArea.left, y)
        ctx.lineTo(chartArea.right, y)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.fillStyle = C.amber
        ctx.font = `9px ${FONT_COND}`
        ctx.textAlign = 'left'
        ctx.fillText('LIMIAR', chartArea.left + 3, y - 3)
        ctx.restore()
      }
    }

    const idx = opts.index
    if (idx == null || idx < 0) return
    const x = scales.x.getPixelForValue(idx)
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

/** Computado a cada render (não no import) para acompanhar os tokens CSS lidos por `C`. */
const statusColors = () => ({
  [OBS_STATUS.CLEARED]: C.teal,
  [OBS_STATUS.RECURRED]: C.red,
  [OBS_STATUS.MONITORING]: C.amber,
  [OBS_STATUS.NO_DATA]: C.slate,
  [OBS_STATUS.NO_DATE]: C.primary,
})

/**
 * 1º turno na cor do status; 2º turno sempre no mesmo tom, para comparar entre
 * cards. Precisa ser uma cor fora de STATUS_COLOR — do contrário, nos cards em
 * MONITORING (status âmbar) as duas linhas saíam idênticas.
 */

/**
 * Mini-timeline diária de um equipamento em observação, com uma linha por
 * turno. Ver os dois separados é o que mostra a falha concentrada (ou migrando)
 * num turno só — a linha do total escondia isso.
 *
 * @param {string} canvasId
 * @param {string[]} days janela de dias (já calculada, sem forçar futuro)
 * @param {{shift1: (number|null)[], shift2: (number|null)[], total: (number|null)[]}} values
 * @param {{maintenanceDate: string|null, status: string, threshold: number,
 *          recurrenceDays: string[], gaps: number[][], unsplit: number[][],
 *          zoom: boolean}} opts
 *        `gaps` = trechos [início, fim] sem dado nenhum;
 *        `unsplit` = trechos com total mas sem divisão por turno;
 *        zoom só no card aberto
 */
export function renderWatchlistChart(canvasId, days, values, opts) {
  applyChartDefaults()
  const { maintenanceDate, status, threshold, recurrenceDays, gaps, unsplit, zoom = false } = opts
  const color = statusColors()[status] || C.primary
  const SHIFT2_COLOR = C.violet
  const cutIndex = maintenanceDate ? days.indexOf(maintenanceDate) : -1
  const flagged = new Set(recurrenceDays || [])

  // Dias de reincidência ganham ponto maior: o limiar é do TOTAL do dia, então
  // a marcação vale para a leitura conjunta das duas linhas.
  const pointRadius = days.map((d) => (flagged.has(d) ? 3.4 : days.length > 40 ? 0 : 2))

  const line = (label, data, lineColor) => ({
    label,
    data,
    borderColor: lineColor,
    backgroundColor: lineColor,
    borderWidth: 1.6,
    pointRadius,
    pointBackgroundColor: lineColor,
    pointBorderColor: lineColor,
    pointHoverRadius: 4,
    fill: false,
    tension: 0.15,
    spanGaps: false,
  })

  return mount(canvasId, {
    type: 'line',
    data: {
      labels: days.map((d) => d.slice(5).replace('-', '/')),
      datasets: [
        line('1º turno · 06–18', values.shift1, color),
        line('2º turno · 18–06', values.shift2, SHIFT2_COLOR),
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { boxHeight: 8, boxWidth: 8, font: { size: 9 }, padding: 8 },
        },
        observationMarks: { index: cutIndex, threshold, gaps, unsplit },
        tooltip: {
          callbacks: {
            title: (items) => days[items[0].dataIndex],
            label: (item) => `${item.dataset.label}: ${item.parsed.y} exceç.`,
            footer: (items) => {
              const day = days[items[0].dataIndex]
              const total = items.reduce((s, i) => s + (i.parsed.y || 0), 0)
              return `total ${total}${flagged.has(day) ? ' · reincidência' : ''}`
            },
          },
        },
        // Zoom só no card aberto: no card fechado a roda do mouse precisa
        // continuar rolando a página, não ampliando um gráfico de 132px.
        zoom: zoom
          ? {
              limits: { x: { min: 'original', max: 'original', minRange: 3 } },
              pan: { enabled: true, mode: 'x', modifierKey: null },
              zoom: {
                wheel: { enabled: true, speed: 0.12 },
                pinch: { enabled: true },
                drag: { enabled: false },
                mode: 'x',
              },
            }
          : {
              pan: { enabled: false },
              zoom: { wheel: { enabled: false }, pinch: { enabled: false } },
            },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { color: C.ink },
          ticks: {
            font: { size: 9 },
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 7,
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
    plugins: [observationMarks],
  })
}
