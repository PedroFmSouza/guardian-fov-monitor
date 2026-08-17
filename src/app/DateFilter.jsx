import { useEffect, useRef } from 'react'

import { rangeLengthDays } from '../data/dateRange.js'
import { fmtInt } from '../ui/kpis.js'
import { useNativeListener } from './hooks.js'
import { QUICK_RANGES } from './useDateFilter.js'

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
 * Recorte por data da leitura na tela.
 *
 * Afeta a faixa de metadados e a visão geral da frota. NÃO afeta o painel de
 * observação: o veredito de reincidência de cada card vem da série diária
 * acumulada entre uploads, e recortá-la aqui produziria um card que diz
 * "reincidente" acima de um gráfico sem os dias que geraram o veredito.
 */
export function DateFilter({ filter, fullMeta }) {
  const { range, bounds, active, empty, activeQuickRange, meta } = filter
  const days = rangeLengthDays(range.from, range.to)

  return (
    <section className="panel datefilter" aria-label="Período exibido">
      <div className="datefilter__row">
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

        <div className="datefilter__quick" role="group" aria-label="Atalhos de período">
          {QUICK_RANGES.map((n) => (
            <button
              key={n}
              type="button"
              className={`btn btn--sm${activeQuickRange === n ? ' btn--on' : ''}`}
              id={`filter-last-${n}`}
              aria-pressed={activeQuickRange === n}
              onClick={() => filter.selectLastDays(n)}
            >
              {n} dias
            </button>
          ))}
          <button
            type="button"
            className={`btn btn--sm${active ? '' : ' btn--on'}`}
            id="filter-all"
            aria-pressed={!active}
            onClick={filter.reset}
          >
            Tudo
          </button>
        </div>

        <p className="datefilter__note" id="filter-note" role="status" aria-live="polite">
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
              ({days}d) · <span className="mono">{fmtInt(meta ? meta.rowCount : 0)}</span> de{' '}
              <span className="mono">{fmtInt(fullMeta.rowCount)}</span> registros
            </>
          ) : (
            <>
              Exibindo o período inteiro carregado. Os atalhos contam a partir do dia mais recente
              com dado (<span className="mono">{bounds.periodEnd}</span>), não de hoje.
            </>
          )}
        </p>
      </div>
    </section>
  )
}
