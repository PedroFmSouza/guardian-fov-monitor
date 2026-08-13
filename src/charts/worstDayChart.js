import { mount, C, FONT_COND, withAlpha, applyChartDefaults } from './base.js'
import { isFirstShiftHour } from '../aggregate/byHour.js'
import { SHIFT_FIRST_START, SHIFT_FIRST_END } from '../data/normalize.js'

/**
 * Sombreia o fundo por turno (1º 06–18, 2º 18–06).
 *
 * Duas faixas, não 24 colunas: em eixo linear as colunas adjacentes deixam
 * costura visível a cada hora, e o que se quer ler aqui é o bloco do turno.
 * A fronteira fica no meio da coluna da hora (05:30, 17:30), acompanhando a
 * largura que cada hora ocupa no eixo.
 */
const shiftShading = {
  id: 'worstDayShiftShading',
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !scales.x) return
    const height = chartArea.bottom - chartArea.top
    const clamp = (v) => Math.min(chartArea.right, Math.max(chartArea.left, scales.x.getPixelForValue(v)))
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
  id: 'worstDayPeak',
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
    // "pico", não só a hora: sozinho o número se confunde com os rótulos do eixo
    ctx.fillText(`pico ${String(hour).padStart(2, '0')}h`, toLeft ? x - 3 : x + 3, chartArea.top + 9)
    ctx.restore()
  },
}

/**
 * Perfil horário de UM dia — um dos piores dias do equipamento.
 *
 * Pensado para leitura em série (três lado a lado): o eixo y é imposto de fora,
 * igual nos três, senão cada gráfico se auto-escala e dias de volumes muito
 * diferentes saem com a mesma altura de pico — comparação falsa.
 *
 * @param {string} canvasId
 * @param {{hours: number[], peakHour: number|null, after: boolean, day: string}} profile
 * @param {{yMax: number}} opts teto comum do eixo y entre os gráficos irmãos
 */
export function renderWorstDayChart(canvasId, profile, { yMax } = {}) {
  applyChartDefaults()
  // depois da manutenção o dia é um alerta (a falha voltou); antes é referência
  const color = profile.after ? C.red : C.primary

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
          borderWidth: 1.6,
          pointRadius: 0,
          pointHoverRadius: 3.5,
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
        worstDayPeak: { hour: profile.peakHour },
        tooltip: {
          callbacks: {
            title: (items) => {
              const h = String(items[0].parsed.x).padStart(2, '0')
              return `${profile.day}, das ${h}:00 às ${h}:59`
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
            stepSize: 6,
            autoSkip: false,
            maxRotation: 0,
            font: { size: 9 },
            callback: (v) => `${String(v).padStart(2, '0')}h`,
          },
        },
        y: {
          beginAtZero: true,
          // teto comum; sem ele o Chart.js escala cada dia por conta própria
          suggestedMax: yMax || undefined,
          grid: { color: C.rule, drawTicks: false },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 3, font: { size: 9 } },
          title: {
            display: true,
            text: 'EXCEÇÕES',
            font: { family: FONT_COND, size: 9 },
            color: C.slate,
          },
        },
      },
    },
    plugins: [shiftShading, peakMark],
  })
}
