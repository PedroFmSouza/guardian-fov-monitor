import { useCallback, useRef, useState } from 'react'

import { useNativeListener } from './hooks.js'

const ACCEPT = [
  '.xlsx',
  '.xlsm',
  '.csv',
  '.txt',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
].join(',')

/**
 * Área de ingestão: drag-and-drop + click-to-browse, status e lista de arquivos.
 * Erros de contrato aparecem aqui, na hora — nunca deixamos o pipeline seguir
 * com dados inválidos para quebrar três painéis adiante.
 */
export function Ingest({ ingest, files, onFiles, onRemove, onClear }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const depth = useRef(0)

  // `change` nativo: o input de arquivo é preenchido por gesto do usuário ou
  // pelo automação de teste, e nos dois casos o evento nativo é o que chega
  const attachInput = useNativeListener(
    inputRef,
    'change',
    useCallback(
      (event) => {
        const picked = [...(event.target.files || [])]
        if (picked.length) onFiles(picked)
        event.target.value = '' // permite re-selecionar os mesmos arquivos
      },
      [onFiles],
    ),
  )

  const open = () => inputRef.current && inputRef.current.click()

  return (
    <>
      <div
        className={`dropzone${over ? ' is-over' : ''}`}
        id="dropzone"
        tabIndex={0}
        role="button"
        aria-label="Selecionar arquivos de eventos do Guardian (.xlsx ou .csv)"
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            open()
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault()
          depth.current += 1
          setOver(true)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1)
          if (!depth.current) setOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          depth.current = 0
          setOver(false)
          const dropped = [...((e.dataTransfer && e.dataTransfer.files) || [])]
          if (dropped.length) onFiles(dropped)
        }}
      >
        <p className="dropzone__title">Arraste os exports .xlsx ou .csv aqui</p>
        <p className="dropzone__hint">
          um ou vários de uma vez, misturando os dois formatos · cada arquivo novo soma ao período
          já carregado · a origem é detectada pela presença da coluna{' '}
          <span className="mono">event_type</span>
        </p>
        <input type="file" id="file-input" accept={ACCEPT} multiple hidden ref={attachInput} />
      </div>

      <div
        className={`ingest-status${ingest.status === 'idle' ? '' : ` ingest-status--${ingest.status}`}`}
        id="ingest-status"
        role="status"
        aria-live="polite"
      >
        {ingest.message}
        {ingest.detail ? <span className="ingest-status__detail mono">{ingest.detail}</span> : null}
      </div>

      <FileList files={files} onRemove={onRemove} onClear={onClear} />
    </>
  )
}

/**
 * Lista dos arquivos que compõem o relatório atual, com remoção individual.
 * Sem isso, "carreguei 4 planilhas" vira um número solto no status e não dá
 * para saber o que está dentro do período nem tirar um arquivo errado.
 */
function FileList({ files, onRemove, onClear }) {
  return (
    <div className="filelist" id="filelist" hidden={files.length === 0}>
      {files.length ? (
        <>
          <div className="filelist__head">
            <span className="filelist__k">{files.length} arquivo(s) no relatório</span>
            <button
              className="btn btn--ghost btn--sm"
              type="button"
              id="filelist-clear"
              onClick={onClear}
            >
              Limpar tudo
            </button>
          </div>
          {files.map((f) => (
            <div className="fileitem" key={f.name}>
              <span className="fileitem__name mono">{f.name}</span>
              <span className="fileitem__meta mono">
                {f.periodStart} → {f.periodEnd} · {f.rows} linhas · {f.fov} FOV
              </span>
              <button
                className="chip__x"
                type="button"
                data-file={f.name}
                title="Remover este arquivo do relatório"
                aria-label={`Remover ${f.name}`}
                onClick={() => onRemove(f.name)}
              >
                ×
              </button>
            </div>
          ))}
        </>
      ) : null}
    </div>
  )
}
