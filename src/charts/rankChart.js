import { mount, C, FONT_COND, applyChartDefaults } from './base.js'

/**
 * Barra horizontal para ranqueamento — uma cor só, para todas as barras.
 *
 * Uma cor por barra seria um degradê sobre categorias nominais: gastaria o
 * canal de cor repetindo o que o comprimento da barra já diz, e ainda sugeriria
 * uma ordem de categoria que não existe. O comprimento ordena; a cor não
 * significa nada além de "isto é a série".
 *
 * Horizontal, não vertical: os rótulos são números de equipamento e nomes de
 * causa, que na vertical viriam rotacionados ou truncados.
 *
 * @param {string} canvasId
 * @param {{label: string, value: number}[]} items já ordenados (maior primeiro)
 * @param {{unit?: string, tooltip?: (item: object) => string[]|string,
 *          color?: string}} [opts]
 */
export function renderRankChart(canvasId, items, opts = {}) {
  applyChartDefaults()
  const { unit = 'exceções', tooltip, color = C.primary } = opts

  return mount(canvasId, {
    type: 'bar',
    data: {
      labels: items.map((i) => i.label),
      datasets: [
        {
          label: unit,
          data: items.map((i) => i.value),
          backgroundColor: color,
          hoverBackgroundColor: color,
          // cantos arredondados só na ponta do dado; a base fica ancorada no eixo
          borderRadius: { topLeft: 0, bottomLeft: 0, topRight: 4, bottomRight: 4 },
          borderSkipped: false,
          // marca fina com respiro: barra gorda vira bloco e perde a leitura
          barPercentage: 0.72,
          categoryPercentage: 0.86,
        },
      ],
    },
    options: {
      indexAxis: 'y',
      interaction: { mode: 'index', intersect: false },
      plugins: {
        // série única: o título do bloco já nomeia o que está plotado
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => {
              const custom = tooltip && tooltip(items[item.dataIndex])
              if (custom) return custom
              const n = item.parsed.x
              return `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`
            },
          },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          grid: { color: C.rule, drawTicks: false },
          border: { display: false },
          ticks: { precision: 0, maxTicksLimit: 5, font: { size: 9 } },
        },
        y: {
          grid: { display: false },
          border: { color: C.ink },
          ticks: { font: { family: FONT_COND, size: 10 }, autoSkip: false },
        },
      },
    },
  })
}
