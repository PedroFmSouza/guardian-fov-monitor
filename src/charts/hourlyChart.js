import {
  mount,
  C,
  FONT_COND,
  withAlpha,
  drawGapBands,
  nullRuns,
  applyChartDefaults,
} from './base.js'

/** 2026-07-12 → 12/07. Ano fica implícito no período do documento. */
const dm = (day) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const hh = (h) => `${String(h).padStart(2, '0')}h`

/**
 * Marcações sobre a série horária:
 *  · faixa sombreada cobrindo tudo depois da manutenção;
 *  · linha vertical tracejada na primeira hora do dia da intervenção;
 *  · faixa hachurada nos dias que o export não cobre.
 *
 * NÃO há linha de limiar aqui, de propósito: o limiar de reincidência é um
 * valor por DIA (exceções/dia) e este eixo é por hora. Desenhá-lo compararia
 * uma contagem horária com um critério diário — o número certo na escala errada.
 */
const hourlyMarks = {
  id: 'hourlyMarks',
  beforeDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return
    const idx = opts.index
    if (idx != null && idx >= 0) {
      const x = Math.max(chartArea.left, Math.min(chartArea.right, scales.x.getPixelForValue(idx)))
      ctx.save()
      ctx.fillStyle = C.shadeShift2
      ctx.fillRect(x, chartArea.top, chartArea.right - x, chartArea.bottom - chartArea.top)
      ctx.restore()
    }
    drawGapBands(ctx, chartArea, scales, opts.gaps, { label: 'SEM DADO', color: C.slate })
  },
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea, scales } = chart
    if (!chartArea || !opts) return
    const idx = opts.index
    if (idx == null || idx < 0) return
    const x = scales.x.getPixelForValue(idx)
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

/**
 * Exceções de FOV de UMA causa, hora a hora, ao longo do período do export.
 *
 * O eixo tem 24 pontos por dia — um período de três semanas passa de 500
 * pontos —, por isso o card ocupa a largura inteira e a roda do mouse amplia.
 * Os rótulos do eixo mostram o DIA na virada da meia-noite; com zoom fechado o
 * suficiente para o dia não caber, passam a mostrar a hora.
 *
 * @param {string} canvasId
 * @param {{day: string, hour: number}[]} hours eixo já montado
 * @param {(number|null)[]} values `null` = dia sem arquivo que o cubra
 * @param {{cutIndex: number, causeLabel: string, zoom: boolean}} opts
 */
export function renderHourlyChart(canvasId, hours, values, opts) {
  applyChartDefaults()
  const { cutIndex = -1, causeLabel = 'Exceções', zoom = false } = opts
  const color = C.primary

  return mount(canvasId, {
    type: 'line',
    data: {
      labels: hours.map((h) => (h.hour === 0 ? dm(h.day) : '')),
      datasets: [
        {
          label: causeLabel,
          data: values,
          borderColor: color,
          backgroundColor: withAlpha(color, 0.18),
          borderWidth: 1.4,
          // 500+ pontos: um marcador por hora vira uma faixa sólida de pontos
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: color,
          pointHoverBorderColor: color,
          fill: 'origin',
          tension: 0,
          spanGaps: false,
        },
      ],
    },
    options: {
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        hourlyMarks: { index: cutIndex, gaps: nullRuns(values) },
        tooltip: {
          callbacks: {
            title: (items) => {
              const p = hours[items[0].dataIndex]
              if (!p) return ''
              const h = String(p.hour).padStart(2, '0')
              return `${p.day}, das ${h}:00 às ${h}:59`
            },
            label: (item) => {
              const n = item.parsed.y
              return `${n} ${n === 1 ? 'exceção' : 'exceções'} · ${causeLabel}`
            },
          },
        },
        zoom: zoom
          ? {
              limits: { x: { min: 'original', max: 'original', minRange: 12 } },
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
            // sem autoSkip: quem decide o que aparece é o callback, senão o
            // Chart.js escolhe horas arbitrárias e o eixo perde a âncora do dia
            autoSkip: false,
            maxRotation: 0,
            font: { size: 9 },
            callback(value) {
              const point = hours[typeof value === 'number' ? value : 0]
              if (!point) return ''
              const span = (this.max ?? 0) - (this.min ?? 0)
              // zoom fechado: o dia inteiro não cabe, então a hora é a âncora útil
              if (span <= 72) return point.hour % 6 === 0 ? hh(point.hour) : ''
              return point.hour === 0 ? dm(point.day) : ''
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
    plugins: [hourlyMarks],
  })
}
