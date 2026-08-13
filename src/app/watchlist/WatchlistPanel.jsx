import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import {
  OBSERVATION_DAYS,
  PRE_WINDOW_DAYS,
  RECURRENCE_FLOOR,
  RECURRENCE_RATIO,
  summarizeObservation,
  sortObservation,
} from '../../aggregate/byDailyVehicle.js'
import { useNativeListener } from '../hooks.js'
import { Card } from './Card.jsx'
import { fmtInt, today } from './shared.js'

/**
 * Formulário de entrada na observação.
 *
 * Os três campos são NÃO controlados de propósito: o valor só interessa no
 * momento do envio, e mantê-los fora do estado do React evita que cada tecla
 * digitada remonte os gráficos de todos os cards abaixo.
 */
function Controls({ defaultDate, knownVehicles, onAdd, onDefaultDateChange }) {
  const vehicleRef = useRef(null)
  const dateRef = useRef(null)
  const noteRef = useRef(null)

  // a data sugerida é estado do app (persistida), mas o input é não controlado:
  // sincronizamos na mão quando ela muda por fora
  useEffect(() => {
    const el = dateRef.current
    if (!el) return
    const wanted = defaultDate || today()
    if (el.value !== wanted) el.value = wanted
  }, [defaultDate])

  const attachDate = useNativeListener(dateRef, 'change', () =>
    onDefaultDateChange(dateRef.current.value || null),
  )

  const submit = useCallback(() => {
    const vehicle = vehicleRef.current.value.trim()
    if (!vehicle) return
    onAdd(vehicle, dateRef.current.value || null, noteRef.current.value.trim())
    vehicleRef.current.value = ''
    noteRef.current.value = ''
    vehicleRef.current.focus()
  }, [onAdd])

  const onEnter = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="wl-controls">
      <label className="field">
        <span className="field__k">Equipamento</span>
        <input
          className="field__input mono"
          type="text"
          id="wl-add"
          list="wl-options"
          placeholder="ex. 707"
          autoComplete="off"
          ref={vehicleRef}
          onKeyDown={onEnter}
        />
      </label>
      <datalist id="wl-options">
        {knownVehicles.map((v) => (
          <option value={v} key={v} />
        ))}
      </datalist>
      <label className="field">
        <span className="field__k">Data da manutenção</span>
        <input
          className="field__input mono"
          type="date"
          id="wl-date"
          defaultValue={defaultDate || today()}
          ref={attachDate}
        />
      </label>
      <label className="field field--grow">
        <span className="field__k">Observação (opcional)</span>
        <input
          className="field__input"
          type="text"
          id="wl-note"
          maxLength={90}
          placeholder="ex. troca de câmera dianteira"
          autoComplete="off"
          ref={noteRef}
          onKeyDown={onEnter}
        />
      </label>
      <button className="btn btn--primary" id="wl-add-btn" type="button" onClick={submit}>
        Colocar em observação
      </button>
    </div>
  )
}

function Summary({ sum }) {
  const tiles = [
    { k: 'Em observação', v: sum.total, mod: '' },
    {
      k: 'Reincidentes',
      v: sum.recurred,
      mod: sum.recurred ? ' wl-tile--alert' : '',
    },
    { k: 'Sem reincidência', v: sum.monitoring, mod: '' },
    {
      k: `Liberados (${OBSERVATION_DAYS}d)`,
      v: sum.cleared,
      mod: sum.cleared ? ' wl-tile--ok' : '',
    },
    { k: 'Aguardando dado', v: sum.pending, mod: '' },
  ]
  return (
    <div className="wl-summary" id="wl-summary">
      {tiles.map((t) => (
        <div className={`wl-tile${t.mod}`} key={t.k}>
          <span className="wl-tile__k">{t.k}</span>
          <span className="wl-tile__v mono">{fmtInt(t.v)}</span>
        </div>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <p className="footnote" id="wl-legend">
      <strong>Critério.</strong> Baseline = {PRE_WINDOW_DAYS} dias anteriores à manutenção; janela
      pós = do dia seguinte à manutenção até o dado mais recente (o dia da intervenção é excluído
      dos dois lados). <b>Reincidência</b> é avaliada por dia, não por média: qualquer dia
      pós-manutenção com pelo menos{' '}
      <span className="mono">{(RECURRENCE_RATIO * 100).toFixed(0)}%</span> da média diária do
      baseline — no mínimo <span className="mono">{RECURRENCE_FLOOR}</span> exceções — marca o
      equipamento como reincidente. Sem reincidência por{' '}
      <span className="mono">{OBSERVATION_DAYS}</span> dias, o equipamento é liberado. A série
      diária é acumulada entre uploads e deduplicada por data; encerrar a observação não apaga o
      histórico.
    </p>
  )
}

/**
 * Painel de observação: equipamentos que passaram por manutenção, indicados
 * manualmente, acompanhados dia a dia para responder uma pergunta só — o
 * problema voltou?
 */
export function WatchlistPanel({ watchlist, rows, meta }) {
  const { entries, defaultDate, daily, add, remove, patch, setDefaultDate } = watchlist
  /** Cards com o detalhe aberto. Estado só de tela: não persiste. */
  const [expanded, setExpanded] = useState(() => new Set())

  const toggle = useCallback((vehicle) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(vehicle)) next.delete(vehicle)
      else next.add(vehicle)
      return next
    })
  }, [])

  const knownVehicles = useMemo(() => {
    const known = new Set([...Object.keys(daily), ...(meta ? meta.vehicles : [])])
    return [...known].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR', { numeric: true }))
  }, [daily, meta])

  const ordered = useMemo(() => sortObservation(entries, daily), [entries, daily])
  const sum = useMemo(() => summarizeObservation(entries, daily), [entries, daily])

  return (
    <>
      <Controls
        defaultDate={defaultDate}
        knownVehicles={knownVehicles}
        onAdd={add}
        onDefaultDateChange={setDefaultDate}
      />
      <Summary sum={sum} />
      <div className="wl-grid" id="wl-grid">
        {ordered.length ? (
          ordered.map(({ entry, res }) => (
            <Card
              key={entry.vehicle}
              entry={entry}
              res={res}
              byDay={daily[entry.vehicle] || EMPTY}
              rows={rows}
              isOpen={expanded.has(entry.vehicle)}
              onToggle={toggle}
              onRemove={remove}
              onPatch={patch}
            />
          ))
        ) : (
          <div className="empty">
            Nenhum equipamento em observação. Informe acima o número do equipamento e a data da
            manutenção realizada.
          </div>
        )}
      </div>
      <Legend />
    </>
  )
}

/** Identidade estável: um `{}` novo a cada render invalidaria os memos do card. */
const EMPTY = {}
