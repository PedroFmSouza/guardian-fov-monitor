import { mount, C, FONT_COND, applyChartDefaults } from './base.js'

/** Linha vertical tracejada no dia da manutenção. */
const maintenanceLine = {
  id: 'shiftMaintenanceLine',
  afterDatasetsDraw(chart, _args, opts) {
    const idx = opts && opts.index
    if (idx == null || idx < 0) return
    const { ctx, chartArea, scales } = chart
    if (!chartArea) return
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

/**
 * Exceções de FOV por dia, empilhadas por turno, com o PIOR turno destacado.
 *
 * Responde o que a contagem total do dia esconde: se depois da manutenção o
 * problema mudou de turno em vez de sumir.
 *
 * @param {string} canvasId
 * @param {{day: string, shift1: number, shift2: number}[]} series
 * @param {{maintenanceDate: string|null, worstShift: 1|2}} opts
 */
export function renderShiftChart(canvasId, series, { maintenanceDate, worstShift = 1 } = {}) {
  applyChartDefaults()
  const days = series.map((d) => d.day)
  const cutIndex = maintenanceDate ? days.indexOf(maintenanceDate) : -1

  const shiftDataset = (n) => ({
    label: `${n}º turno · ${n === 1 ? '06–18' : '18–06'}${n === worstShift ? ' (pior)' : ''}`,
    data: series.map((d) => (n === 1 ? d.shift1 : d.shift2)),
    backgroundColor: n === worstShift ? C.red : C.compare,
    barPercentage: 0.82,
    categoryPercentage: 0.94,
  })

  return mount(canvasId, {
    type: 'bar',
    data: {
      labels: days.map((d) => d.slice(5).replace('-', '/')),
      // o pior turno vai na base da pilha: fica ancorado no eixo e legível
      datasets: worstShift === 1 ? [shiftDataset(1), shiftDataset(2)] : [shiftDataset(2), shiftDataset(1)],
    },
    options: {
      plugins: {
        legend: {
          position: 'top',
          align: 'end',
          labels: { boxHeight: 9, boxWidth: 9, font: { size: 10 } },
        },
        shiftMaintenanceLine: { index: cutIndex },
        tooltip: {
          callbacks: {
            title: (items) => days[items[0].dataIndex],
            footer: (items) => {
              const d = series[items[0].dataIndex]
              const total = d.shift1 + d.shift2
              if (!total) return ''
              const dominant = d.shift1 >= d.shift2 ? '1º' : '2º'
              const share = Math.max(d.shift1, d.shift2) / total
              return `total ${total} · ${dominant} turno ${(share * 100).toFixed(0)}%`
            },
          },
        },
      },
      scales: {
        x: {
          stacked: true,
          grid: { display: false },
          border: { color: C.ink },
          ticks: { autoSkip: true, maxTicksLimit: 10, maxRotation: 0, font: { size: 9 } },
        },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: C.rule, drawTicks: false },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 4, font: { size: 9 } },
        },
      },
    },
    plugins: [maintenanceLine],
  })
}
