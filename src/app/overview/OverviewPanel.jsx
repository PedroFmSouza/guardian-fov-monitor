import { useMemo } from 'react'

import { aggregateByVehicle } from '../../aggregate/byVehicle.js'
import { fleetByCause, fleetByHour, fleetDaily } from '../../aggregate/overview.js'
import { renderFleetHourChart, renderFleetTrendChart } from '../../charts/fleetChart.js'
import { renderRankChart } from '../../charts/rankChart.js'
import { fmtInt } from '../../ui/kpis.js'
import { useChart } from '../hooks.js'

/** Quantos equipamentos entram no ranking. */
const RANK_SIZE = 12

/**
 * Um bloco do painel: título, uma frase de leitura e o gráfico.
 *
 * A frase não é enfeite — é o que o gráfico diz em palavras, para quem não vai
 * interpretar a forma (e para leitor de tela, que não enxerga o canvas).
 */
function Block({ title, reading, children, wide = false }) {
  return (
    <section className={`ov-block${wide ? ' ov-block--wide' : ''}`}>
      <h3 className="ov-block__title">{title}</h3>
      <p className="ov-block__reading">{reading}</p>
      {children}
    </section>
  )
}

function TrendBlock({ rows }) {
  const daily = useMemo(() => fleetDaily(rows), [rows])
  const id = 'ov-trend'

  useChart(
    daily.days.length ? id : null,
    () => renderFleetTrendChart(id, daily.days, daily.total),
    `${daily.days.join()}|${daily.total.join()}`,
  )

  // médias só sobre dias COM dado: incluir o vão como zero afundaria a média e
  // faria o período parecer melhor do que foi
  const measured = daily.total.filter((v) => v !== null)
  const total = measured.reduce((a, b) => a + b, 0)
  const perDay = measured.length ? total / measured.length : 0
  // primeira metade × segunda metade: leitura honesta de direção sem inventar
  // regressão em cima de um punhado de dias
  const half = Math.floor(measured.length / 2)
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const early = mean(measured.slice(0, half))
  const late = mean(measured.slice(half))
  const delta = early > 0 ? (late - early) / early : null

  return (
    <Block
      title="Tendência da frota"
      wide
      reading={
        measured.length < 4
          ? `${fmtInt(total)} exceções em ${measured.length} dia(s) — período curto demais para falar de tendência.`
          : `${fmtInt(total)} exceções em ${measured.length} dias · média ${perDay.toFixed(1)}/dia. ` +
            (delta === null
              ? 'Sem baseline para comparar as metades do período.'
              : `A segunda metade ficou ${Math.abs(delta * 100).toFixed(0)}% ${
                  delta < 0 ? 'abaixo' : 'acima'
                } da primeira.`) +
            (daily.missing
              ? ` ${daily.missing} dia(s) da faixa sem arquivo que os cubra — a linha quebra ali, em vez de emendar dias não vizinhos.`
              : '')
      }
    >
      <div className="chartbox chartbox--detail">
        <canvas
          id={id}
          role="img"
          aria-label={`Exceções de FOV por dia na frota: ${fmtInt(total)} no total em ${daily.days.length} dias, média ${perDay.toFixed(1)} por dia.`}
        />
      </div>
    </Block>
  )
}

function RankBlock({ rows }) {
  const items = useMemo(() => {
    const stats = aggregateByVehicle(rows).filter((v) => v.fov > 0)
    return stats.slice(0, RANK_SIZE).map((v) => ({
      label: String(v.vehicle),
      value: v.fov,
      perDay: v.fovPerDay,
      days: v.dayCount,
    }))
  }, [rows])
  const id = 'ov-rank'

  useChart(
    items.length ? id : null,
    () =>
      renderRankChart(id, items, {
        unit: 'exceções',
        tooltip: (i) => [
          `${fmtInt(i.value)} exceções de FOV`,
          `${i.perDay.toFixed(1)} por dia em ${i.days} dia(s) com registro`,
        ],
      }),
    items.map((i) => `${i.label}:${i.value}`).join(),
  )

  if (!items.length) {
    return (
      <Block title="Equipamentos com mais exceções" reading="Nenhuma exceção de FOV no período.">
        <div className="empty">Sem dados para ranquear.</div>
      </Block>
    )
  }

  return (
    <Block
      title={`Equipamentos com mais exceções — top ${Math.min(RANK_SIZE, items.length)}`}
      reading={
        `${items[0].label} lidera com ${fmtInt(items[0].value)} exceções ` +
        `(${items[0].perDay.toFixed(1)}/dia). Entrar em observação é decisão de quem opera — ` +
        `o ranking não adiciona ninguém à lista.`
      }
    >
      <div className="chartbox chartbox--rank">
        <canvas
          id={id}
          role="img"
          aria-label={`Ranking de equipamentos por exceções de FOV: ${items
            .map((i) => `${i.label} com ${i.value}`)
            .join(', ')}.`}
        />
      </div>
    </Block>
  )
}

function HourBlock({ rows }) {
  const profile = useMemo(() => fleetByHour(rows), [rows])
  const id = 'ov-hour'

  useChart(profile.total ? id : null, () => renderFleetHourChart(id, profile), profile.hours.join())

  const peak = profile.peakHour
  return (
    <Block
      title="Hora do dia"
      reading={
        peak === null
          ? 'Sem exceção de FOV no período.'
          : `O pico é às ${String(peak).padStart(2, '0')}h, com ${fmtInt(profile.hours[peak])} exceções. ` +
            `O fundo claro é o 1º turno (06h–18h); o escuro, o 2º.`
      }
    >
      <div className="chartbox chartbox--detail">
        <canvas
          id={id}
          role="img"
          aria-label={`Exceções de FOV por hora do dia na frota${
            peak === null ? '' : `, com pico às ${peak}h somando ${profile.hours[peak]}`
          }.`}
        />
      </div>
    </Block>
  )
}

function CauseBlock({ rows }) {
  const causes = useMemo(() => fleetByCause(rows), [rows])
  const id = 'ov-cause'
  const items = causes.map((c) => ({ label: c.label, value: c.count, share: c.share }))
  const hasAny = causes.some((c) => c.count > 0)

  useChart(
    hasAny ? id : null,
    () =>
      renderRankChart(id, items, {
        unit: 'exceções',
        tooltip: (i) => `${fmtInt(i.value)} exceções · ${(i.share * 100).toFixed(0)}% do total`,
      }),
    items.map((i) => `${i.label}:${i.value}`).join(),
  )

  const top = causes[0]
  return (
    <Block
      title="Causa raiz"
      reading={
        !hasAny
          ? 'Sem exceção de FOV classificada no período.'
          : `${top.label} responde por ${(top.share * 100).toFixed(0)}% das exceções. ` +
            `As causas conhecidas aparecem mesmo com zero — a barra vazia é a afirmação de que aquela causa foi verificada e não ocorreu.`
      }
    >
      {hasAny ? (
        <div className="chartbox chartbox--cause">
          <canvas
            id={id}
            role="img"
            aria-label={`Exceções de FOV por causa raiz: ${causes
              .map((c) => `${c.label} com ${c.count}`)
              .join(', ')}.`}
          />
        </div>
      ) : (
        <div className="empty">Sem causa registrada.</div>
      )}
    </Block>
  )
}

/**
 * Visão geral da frota — o export carregado agora, inteiro.
 *
 * Complementa o painel de observação, que é por equipamento e atravessa
 * uploads. Aqui nada é persistido: é a leitura do período que está na tela.
 */
export function OverviewPanel({ rows }) {
  if (!rows.length) {
    return (
      <div className="empty">
        Carregue um export para ver a visão geral da frota — tendência, ranking, hora do dia e causa
        raiz.
      </div>
    )
  }

  // O ranking é alto (uma barra por equipamento) e os outros dois são baixos.
  // Empilhar hora + causa numa coluna ao lado casa as alturas — em auto-fit de
  // três colunas o ranking mandava na altura da linha e sobrava um rasgo de
  // espaço morto embaixo dos outros dois.
  return (
    <div className="ov-grid">
      <TrendBlock rows={rows} />
      <RankBlock rows={rows} />
      <div className="ov-stack">
        <HourBlock rows={rows} />
        <CauseBlock rows={rows} />
      </div>
    </div>
  )
}
