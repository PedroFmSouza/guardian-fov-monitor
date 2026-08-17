import { useCallback, useEffect, useMemo, useState } from 'react'


import { refreshColorTokens } from '../charts/base.js'
import { fmtInt } from '../ui/kpis.js'
import { Header, Metagrid, Footer } from './Chrome.jsx'
import { ViewFilter } from './ViewFilter.jsx'
import { ChartThemeContext } from './hooks.js'
import { Ingest } from './Ingest.jsx'
import { OverviewPanel } from './overview/OverviewPanel.jsx'
import { useViewFilter } from './useViewFilter.js'
import { useReport } from './useReport.js'
import { useWatchlist } from './useWatchlist.js'
import { today } from './watchlist/shared.js'
import { WatchlistPanel } from './watchlist/WatchlistPanel.jsx'

export function App() {
  const watchlist = useWatchlist()
  const report = useReport(watchlist.mergeSeries)

  /**
   * Recorte da LEITURA — período e causa raiz. Deriva das linhas já unidas,
   * depois da ingestão: o que o filtro esconde nunca deixou de ser gravado na
   * série diária do painel de observação.
   */
  const filter = useViewFilter(report.rows, report.meta)

  // Chart.js grava as cores no dataset na montagem e não referencia o CSS ao
  // vivo. Trocar o tema exige reler os tokens e REMONTAR os gráficos — o
  // contador força isso pela assinatura dos efeitos de gráfico.
  const [themeEpoch, setThemeEpoch] = useState(0)
  const onThemeChange = useCallback(() => {
    refreshColorTokens()
    setThemeEpoch((n) => n + 1)
  }, [])

  const generatedAt = useMemo(() => new Date().toLocaleString('pt-BR'), [])
  const { meta, historyCount } = report

  /**
   * A faixa de metadados descreve o que está NA TELA, não o que está em disco.
   * Com o filtro ativo ela segue o recorte — inclusive para zero, caso em que o
   * período exibido vem do intervalo pedido, já que não há dado de onde tirá-lo.
   */
  const shown = filter.meta

  /** Equipamentos já em observação: o botão do ranking não recoloca ninguém. */
  const observed = useMemo(
    () => new Set(watchlist.entries.map((e) => e.vehicle)),
    [watchlist.entries],
  )

  const observeDate = watchlist.defaultDate || today()
  const observeTop = useCallback(
    (vehicles) => watchlist.addMany(vehicles, observeDate, ''),
    [watchlist, observeDate],
  )

  const cells = [
    {
      key: 'period',
      label: 'Período exibido',
      value: !shown
        ? '—'
        : shown.periodStart
          ? `${shown.periodStart} → ${shown.periodEnd} (${shown.days.length}d)`
          : `${filter.range.from} → ${filter.range.to} (0d)`,
    },
    {
      key: 'vehicles',
      label: 'Equipamentos',
      value: shown ? fmtInt(shown.vehicles.length) : '—',
    },
    {
      key: 'shifts',
      label: 'Turnos',
      value: shown && shown.shifts.length ? shown.shifts.join(' · ') : '—',
    },
    {
      key: 'rows',
      label: 'Registros processados',
      value: shown ? fmtInt(shown.rowCount) : '—',
    },
    {
      key: 'sheet',
      label: 'Origem dos dados',
      value: meta ? report.sourceLabel || '—' : '—',
    },
    {
      key: 'revision',
      label: 'Revisão',
      value: `REV-${String(historyCount).padStart(2, '0')}`,
    },
  ]

  // Superfície de introspecção para QA (scripts/smoke.mjs): só expõe agregados
  // que já estão visíveis na tela — por isso segue o recorte, não o total em
  // disco. Sem filtro os dois coincidem, que é o estado em que o smoke roda.
  // A aplicação não lê.
  useEffect(() => {
    window.__gfmReport = shown
      ? {
          fileCount: report.files.length,
          rowCount: shown.rowCount,
          fovCount: shown.fovCount,
          filtered: filter.active,
        }
      : { fileCount: 0, rowCount: 0, fovCount: 0, filtered: false }
  }, [shown, report.files.length, filter.active])

  return (
    <ChartThemeContext.Provider value={themeEpoch}>
      <div className="app-shell">
        <Header onThemeChange={onThemeChange} />

        <div id="report-status" className="sr-only" role="status" aria-live="polite">
          {shown
            ? `Relatório atualizado: ${fmtInt(shown.rowCount)} registros, ${fmtInt(
                shown.fovCount,
              )} exceções de FOV, ${fmtInt(shown.vehicles.length)} equipamentos${
                filter.active ? ', no período filtrado' : ''
              }.`
            : 'Nenhum relatório carregado.'}
        </div>

        <main id="main-content" tabIndex={-1}>
          <Metagrid cells={cells} />

          {meta ? <ViewFilter filter={filter} fullMeta={meta} /> : null}

          <section className="panel" aria-label="Carga de dados">
            <div className="panel__head">
              <h2 className="panel__title">Carga do export semanal</h2>
              <p className="panel__sub">
                Arquivo .xlsx ou .csv exportado do Guardian, em inglês ou em português. A origem é
                detectada pelo cabeçalho.
              </p>
            </div>
            <div id="dropzone-host">
              <Ingest
                ingest={report.ingest}
                files={report.fileStats}
                onFiles={report.handleFiles}
                onRemove={report.removeFile}
                onClear={report.clearFiles}
              />
            </div>
          </section>

          <section className="panel panel--focus" aria-label="Equipamentos em observação">
            <div className="panel__head">
              <h2 className="panel__title">Equipamentos em observação</h2>
              <p className="panel__sub">
                Equipamentos indicados manualmente após manutenção, acompanhados dia a dia para
                detectar se a falha volta a ocorrer. Cada equipamento tem sua própria data de
                manutenção; a série diária é acumulada entre uploads e deduplicada por data. Use{' '}
                <strong>Detalhar</strong> para abrir hora do dia, causa raiz e duração do
                equipamento, comparando antes e depois da manutenção. Os cards seguem o recorte
                acima: o gráfico desenha apenas o <strong>período exibido</strong>, e com uma causa
                isolada o gráfico, as médias e o veredito passam a valer só para ela. Dias gravados
                antes de a série guardar a causa não sabem responder — ficam hachurados e fora das
                contas, contados no card como <span className="mono">sem causa</span>. Recarregar os
                exports daqueles dias preenche.
              </p>
            </div>
            <div id="watchlist-host">
              <WatchlistPanel
                watchlist={watchlist}
                rows={report.rows}
                meta={report.meta}
                range={filter.range}
                cause={filter.cause}
              />
            </div>
          </section>

          <section className="panel" aria-label="Visão geral da frota">
            <div className="panel__head">
              <h2 className="panel__title">Visão geral da frota</h2>
              <p className="panel__sub">
                Leitura do <strong>período exibido</strong>, com a frota inteira: para onde a
                tendência aponta, quais equipamentos estão piores, em que hora do dia acontece e por
                quê. Segue o recorte de período e causa acima. Nada aqui é persistido nem atravessa
                uploads — o acompanhamento entre semanas vive no painel de observação, acima.
              </p>
            </div>
            <div id="overview-host">
              <OverviewPanel
                rows={filter.rows}
                cause={filter.cause}
                observed={observed}
                onObserve={observeTop}
                defaultDate={observeDate}
                emptyReason={
                  !meta
                    ? 'Carregue um export para ver a visão geral da frota — tendência, ranking, hora do dia e causa raiz.'
                    : 'Nenhum registro no recorte atual. Amplie o intervalo, use "Tudo" ou volte para todas as causas.'
                }
              />
            </div>
          </section>
        </main>

        <Footer generatedAt={generatedAt} />
      </div>
    </ChartThemeContext.Provider>
  )
}
