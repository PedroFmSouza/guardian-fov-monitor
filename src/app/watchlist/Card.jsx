import { useMemo, useRef } from 'react'

import { renderWatchlistChart } from '../../charts/watchlistChart.js'
import { resetZoom } from '../../charts/base.js'
import { buildVehicleDetail } from '../../aggregate/vehicleDetail.js'
import {
  OBS_STATUS,
  OBSERVATION_DAYS,
  chartWindow,
  dayCount,
  dayShifts,
  missingDayRuns,
  missingDayCount,
  unsplitDayRuns,
  unsplitDayCount,
} from '../../aggregate/byDailyVehicle.js'
import { useChart, useNativeListener } from '../hooks.js'
import { Detail } from './Detail.jsx'
import { STATUS_LABEL, canvasIdFor, fmtInt } from './shared.js'

/** Veredito em uma frase, no vocabulário do status. */
function Verdict({ res }) {
  if (res.status === OBS_STATUS.RECURRED) {
    return (
      <>
        Voltou a ocorrer em <b className="mono">{res.firstRecurrence}</b> ·{' '}
        <b className="mono">{res.recurrenceDays.length}</b> dia(s) acima do limiar de{' '}
        <b className="mono">{res.threshold.toFixed(1)}</b>/dia
      </>
    )
  }
  if (res.status === OBS_STATUS.CLEARED) {
    return (
      <>
        <b className="mono">{res.daysObserved}</b> dias sem reincidência — pode sair da observação
      </>
    )
  }
  if (res.status === OBS_STATUS.MONITORING) {
    return res.postDays ? (
      <>
        Sem reincidência há <b className="mono">{res.cleanStreak}</b> dia(s) · faltam{' '}
        <b className="mono">{res.daysRemaining}</b> de {OBSERVATION_DAYS}
      </>
    ) : (
      <>Manutenção registrada — aguardando o primeiro export posterior à data</>
    )
  }
  if (res.status === OBS_STATUS.NO_DATA) {
    return <>Sem série diária para este equipamento. Carregue um export que cubra o período.</>
  }
  return <>Defina a data da manutenção para iniciar a observação.</>
}

/** Série diária por turno, com as faixas de vão desenhadas por cima. */
function DailySeries({ vehicle, byDay, days, res, maintenanceDate, isOpen }) {
  const id = canvasIdFor(vehicle)

  const values = useMemo(
    () => ({
      // dias fora da série viram null (buraco na linha), não zero
      shift1: days.map((d) => (d in byDay ? dayShifts(byDay[d])[0] : null)),
      shift2: days.map((d) => (d in byDay ? dayShifts(byDay[d])[1] : null)),
    }),
    [days, byDay],
  )

  useChart(
    id,
    () =>
      renderWatchlistChart(id, days, values, {
        maintenanceDate,
        status: res.status,
        // Sem data de manutenção não há baseline, e `evaluateObservation`
        // devolve o piso (RECURRENCE_FLOOR) só como valor de partida. Passá-lo
        // adiante desenhava uma linha LIMIAR sobre a série sem que critério
        // nenhum estivesse sendo aplicado.
        threshold: maintenanceDate ? res.threshold : null,
        recurrenceDays: res.recurrenceDays,
        // os mesmos buracos, marcados na área do gráfico — separados por motivo
        gaps: missingDayRuns(days, byDay),
        unsplit: unsplitDayRuns(days, byDay),
        // Zoom só no card aberto: fechado, a roda do mouse precisa continuar
        // rolando a página em vez de ampliar uma miniatura de 132px.
        zoom: isOpen,
      }),
    `${days.join()}|${values.shift1.join()}|${values.shift2.join()}|${res.status}|${maintenanceDate || ''}|${res.threshold}|${isOpen}`,
  )

  return (
    <div className={`chartbox chartbox--mini${isOpen ? ' chartbox--zoom' : ''}`}>
      <canvas
        id={id}
        role="img"
        aria-label={`Série diária de exceções do equipamento ${vehicle}, por turno`}
      />
    </div>
  )
}

export function Card({ entry, res, byDay, rows, isOpen, onToggle, onRemove, onPatch }) {
  const { vehicle, maintenanceDate, note } = entry
  const dateRef = useRef(null)
  const noteRef = useRef(null)

  const total = useMemo(() => Object.values(byDay).reduce((a, v) => a + dayCount(v), 0), [byDay])
  const days = useMemo(() => chartWindow(byDay, maintenanceDate), [byDay, maintenanceDate])
  const gapDays = missingDayCount(days, byDay)
  const unsplitDays = unsplitDayCount(days, byDay)
  const hasSeries = Object.keys(byDay).length > 0

  // O detalhe varre as linhas do export inteiro; só vale a pena para o card
  // aberto — calcular para todos a cada render seria desperdício.
  const detail = useMemo(
    () => (isOpen ? buildVehicleDetail(rows || [], vehicle, maintenanceDate, byDay) : null),
    [isOpen, rows, vehicle, maintenanceDate, byDay],
  )

  // `change` nativo, não `onChange` do React: comita quando o valor é
  // confirmado, e não a cada tecla — ver `useNativeListener`
  const attachDate = useNativeListener(dateRef, 'change', () =>
    onPatch(vehicle, { maintenanceDate: dateRef.current.value || null }),
  )
  const attachNote = useNativeListener(noteRef, 'change', () =>
    onPatch(vehicle, { note: noteRef.current.value.trim() }),
  )

  const delta =
    res.delta === null || !Number.isFinite(res.delta)
      ? '—'
      : `${res.delta > 0 ? '+' : ''}${(res.delta * 100).toFixed(1)}%`
  const progress = Math.min(100, Math.round((res.daysObserved / OBSERVATION_DAYS) * 100))

  return (
    <article className={`wl-card wl-card--${res.status}${isOpen ? ' wl-card--open' : ''}`}>
      <div className="wl-card__head">
        <span className="wl-card__id">{vehicle}</span>
        <span className={`badge badge--${res.status}`}>
          {STATUS_LABEL[res.status]}
          <span className="badge__delta">{delta}</span>
        </span>
      </div>

      <div className="wl-card__ctrl">
        <label className="wl-card__date">
          <span className="field__k">Manutenção</span>
          <input
            className="field__input field__input--sm mono"
            type="date"
            defaultValue={maintenanceDate || ''}
            data-date={vehicle}
            ref={attachDate}
          />
        </label>
        <input
          className="field__input field__input--sm wl-card__note"
          type="text"
          maxLength={90}
          defaultValue={note || ''}
          placeholder="observação da manutenção"
          data-note={vehicle}
          ref={attachNote}
        />
        <button
          className="btn btn--sm"
          type="button"
          data-detail={vehicle}
          aria-expanded={isOpen}
          title="Hora, causa raiz e duração deste equipamento"
          onClick={() => onToggle(vehicle)}
        >
          {isOpen ? 'Ocultar detalhe' : 'Detalhar'}
        </button>
        <button
          className="btn btn--ghost btn--danger btn--sm"
          type="button"
          data-remove={vehicle}
          title="Encerrar a observação (o histórico diário é preservado)"
          onClick={() => onRemove(vehicle)}
        >
          Encerrar
        </button>
      </div>

      <div
        className="wl-progress"
        title={`${res.daysObserved} de ${OBSERVATION_DAYS} dias de observação`}
      >
        <span className="wl-progress__fill" style={{ width: `${progress}%` }}></span>
      </div>

      <p className="wl-card__verdict">
        <Verdict res={res} />
      </p>

      <div className="wl-card__stats">
        <span>
          pré <b>{res.preMean.toFixed(2)}</b>/dia <span className="mono">({res.preDays}d)</span>
        </span>
        <span>
          pós <b>{res.postMean.toFixed(2)}</b>/dia <span className="mono">({res.postDays}d)</span>
        </span>
        <span>
          total <b>{fmtInt(total)}</b>
        </span>
        {/* As médias contam só os dias COM dado. Sem dizer quantos faltam,
            "pós 17.14/dia (7d)" parece cobrir os 12 dias de calendário desde a
            manutenção — e o vão na linha parece bug de renderização. */}
        {gapDays ? (
          <span
            className="wl-card__gap"
            title="Dias da janela que nenhum arquivo carregado cobre. Não entram nas médias e aparecem hachurados no gráfico."
          >
            sem dado <b>{gapDays}</b> dia(s)
          </span>
        ) : null}
        {/* Dia gravado antes da quebra por turno: o total é real e conta em
            tudo, só as duas linhas é que não têm o que plotar. */}
        {unsplitDays ? (
          <span
            className="wl-card__gap"
            title="Dias gravados antes da divisão por turno: o total conta nas médias e nos vereditos, mas não há como separar 1º e 2º turno. Recarregue um export que cubra esses dias para recuperar a divisão."
          >
            sem turno <b>{unsplitDays}</b> dia(s)
          </span>
        ) : null}
      </div>

      {hasSeries && days.length ? (
        <>
          <DailySeries
            vehicle={vehicle}
            byDay={byDay}
            days={days}
            res={res}
            maintenanceDate={maintenanceDate}
            isOpen={isOpen}
          />
          {isOpen ? (
            <p className="wl-zoomhint">
              Roda do mouse amplia · arraste para deslocar ·{' '}
              {gapDays
                ? `${days.length} dias na janela, ${days.length - gapDays} com dado`
                : `${days.length} dias na série`}
              {unsplitDays ? ` · ${unsplitDays} sem divisão por turno` : ''}
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                data-zoomreset={vehicle}
                onClick={() => resetZoom(canvasIdFor(vehicle))}
              >
                Ver tudo
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <div className="empty">Sem série diária registrada para este equipamento.</div>
      )}

      {isOpen && detail ? (
        <Detail vehicle={vehicle} detail={detail} res={res} maintenanceDate={maintenanceDate} />
      ) : null}
    </article>
  )
}
