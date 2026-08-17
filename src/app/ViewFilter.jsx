import { useEffect, useRef } from 'react'

import { causeLabel } from '../aggregate/overview.js'
import { rangeLengthDays } from '../data/dateRange.js'
import { fmtInt } from '../ui/kpis.js'
import { useNativeListener } from './hooks.js'
import { QUICK_RANGES } from './useViewFilter.js'

/**
 * Um campo de data do recorte.
 *
 * NÃO controlado, sincronizado à mão — mesmo motivo dos campos do painel de
 * observação: o `onChange` do React dispara no evento `input`, e num
 * `<input type="date">` isso significa recalcular todos os agregados e remontar
 * todo gráfico enquanto a pessoa ainda está escolhendo o dia. O `change` nativo
 * comita quando o valor é confirmado.
 */
function DateField({ id, label, value, min, max, onCommit }) {
  const ref = useRef(null)
  const attach = useNativeListener(ref, 'change', () => onCommit(ref.current.value || null))

  // os atalhos e o "Tudo" mudam o intervalo por fora; o input precisa acompanhar
  useEffect(() => {
    const el = ref.current
    if (el && el.value !== (value || '')) el.value = value || ''
  }, [value])

  return (
    <label className="field">
      <span className="field__k">{label}</span>
      <input
        className="field__input field__input--sm mono"
        type="date"
        id={id}
        defaultValue={value || ''}
        min={min || undefined}
        max={max || undefined}
        ref={attach}
      />
    </label>
  )
}

/**
 * Recorte da leitura na tela: período e causa raiz.
 *
 * Afeta a faixa de metadados e a visão geral da frota. No painel de observação
 * alcança só o DESENHO da série de cada card (ver `chartWindow`); o veredito de
 * reincidência continua contado sobre a série acumulada inteira, e o card diz
 * quantos dias ficaram fora.
 */
export function ViewFilter({ filter, fullMeta }) {
  const { range, bounds, active, dateActive, empty, activeQuickRange, causes, cause, meta } = filter
  const { loadedDays } = filter
  const days = rangeLengthDays(range.from, range.to)

  return (
    <section className="panel viewfilter" aria-label="Recorte do que é exibido">
      <div className="viewfilter__row">
        <DateField
          id="filter-from"
          label="De"
          value={range.from}
          min={bounds.periodStart}
          max={bounds.periodEnd}
          onCommit={filter.setFrom}
        />
        <DateField
          id="filter-to"
          label="Até"
          value={range.to}
          min={bounds.periodStart}
          max={bounds.periodEnd}
          onCommit={filter.setTo}
        />

        <div className="viewfilter__quick" role="group" aria-label="Atalhos de período">
          {QUICK_RANGES.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn btn--sm${activeQuickRange === n ? ' btn--on' : ''}${
                loadedDays && n >= loadedDays ? ' btn--inert' : ''
              }`}
              id={`filter-last-${n}`}
              aria-pressed={activeQuickRange === n}
              title={
                loadedDays && n >= loadedDays
                  ? `O período carregado tem ${loadedDays} dia(s): este atalho cobre o arquivo inteiro e não estreita nada.`
                  : `Últimos ${n} dias a partir de ${bounds.periodEnd}`
              }
              onClick={() => filter.selectLastDays(n)}
            >
              {n} dias
            </button>
          ))}
          <button
            type="button"
            className={`btn btn--sm${dateActive ? '' : ' btn--on'}`}
            id="filter-all"
            aria-pressed={!dateActive}
            onClick={filter.resetRange}
          >
            Tudo
          </button>
        </div>

        <label className="field">
          <span className="field__k">Causa raiz</span>
          <select
            className={`field__input field__input--sm${cause ? ' field__input--on' : ''}`}
            id="filter-cause"
            value={cause || ''}
            onChange={(e) => filter.selectCause(e.target.value)}
          >
            <option value="">Todas as causas</option>
            {causes.map((c) => (
              <option value={c.cause} key={c.cause}>
                {causeLabel(c.cause)} ({fmtInt(c.count)})
              </option>
            ))}
          </select>
        </label>

        <p className="viewfilter__note" id="filter-note" role="status" aria-live="polite">
          {empty ? (
            <>
              Nenhum dia selecionado — a data inicial é posterior à final, ou o intervalo está fora
              do período carregado (
              <span className="mono">
                {bounds.periodStart} → {bounds.periodEnd}
              </span>
              ).
            </>
          ) : active ? (
            <>
              Exibindo{' '}
              <span className="mono">
                {range.from} → {range.to}
              </span>{' '}
              ({days}d)
              {cause ? (
                <>
                  , só <strong>{causeLabel(cause)}</strong>
                </>
              ) : null}{' '}
              · <span className="mono">{fmtInt(meta ? meta.rowCount : 0)}</span> de{' '}
              <span className="mono">{fmtInt(fullMeta.rowCount)}</span> registros
              {cause ? ' (isolar uma causa descarta os eventos que não são de FOV)' : ''}
            </>
          ) : (
            <>
              Exibindo o período inteiro carregado — <span className="mono">{loadedDays}</span>{' '}
              dia(s), todas as causas. Os atalhos contam a partir do dia mais recente com dado (
              <span className="mono">{bounds.periodEnd}</span>), não de hoje
              {loadedDays && loadedDays <= QUICK_RANGES[0]
                ? `, então nenhum deles estreita um arquivo de ${loadedDays} dia(s)`
                : ''}
              .
            </>
          )}
        </p>
      </div>
    </section>
  )
}
