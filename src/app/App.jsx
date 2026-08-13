import { useCallback, useEffect, useMemo, useState } from 'react'

import { refreshColorTokens } from '../charts/base.js'
import { fmtInt } from '../ui/kpis.js'
import { Header, Metagrid, Footer } from './Chrome.jsx'
import { ChartThemeContext } from './hooks.js'
import { Ingest } from './Ingest.jsx'
import { useReport } from './useReport.js'
import { useWatchlist } from './useWatchlist.js'
import { WatchlistPanel } from './watchlist/WatchlistPanel.jsx'

export function App() {
  const watchlist = useWatchlist()
  const report = useReport(watchlist.mergeSeries)

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

  const cells = [
    {
      key: 'period',
      label: 'Período coberto',
      value: meta ? `${meta.periodStart} → ${meta.periodEnd} (${meta.days.length}d)` : '—',
    },
    {
      key: 'vehicles',
      label: 'Equipamentos',
      value: meta ? fmtInt(meta.vehicles.length) : '—',
    },
    {
      key: 'shifts',
      label: 'Turnos',
      value: meta && meta.shifts.length ? meta.shifts.join(' · ') : '—',
    },
    {
      key: 'rows',
      label: 'Registros processados',
      value: meta ? fmtInt(meta.rowCount) : '—',
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
  // que já estão visíveis na tela. A aplicação não lê.
  useEffect(() => {
    window.__gfmReport = meta
      ? {
          fileCount: report.files.length,
          rowCount: meta.rowCount,
          fovCount: meta.fovCount,
        }
      : { fileCount: 0, rowCount: 0, fovCount: 0 }
  }, [meta, report.files.length])

  return (
    <ChartThemeContext.Provider value={themeEpoch}>
      <div className="app-shell">
        <Header onThemeChange={onThemeChange} />

        <div id="report-status" className="sr-only" role="status" aria-live="polite">
          {meta
            ? `Relatório atualizado: ${fmtInt(meta.rowCount)} registros, ${fmtInt(
                meta.fovCount,
              )} exceções de FOV, ${fmtInt(meta.vehicles.length)} equipamentos.`
            : 'Nenhum relatório carregado.'}
        </div>

        <main id="main-content" tabIndex={-1}>
          <Metagrid cells={cells} />

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
                equipamento, comparando antes e depois da manutenção.
              </p>
            </div>
            <div id="watchlist-host">
              <WatchlistPanel watchlist={watchlist} rows={report.rows} meta={report.meta} />
            </div>
          </section>
        </main>

        <Footer generatedAt={generatedAt} />
      </div>
    </ChartThemeContext.Provider>
  )
}
