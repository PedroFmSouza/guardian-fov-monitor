import { useState } from 'react'

import { currentTheme, toggleTheme } from '../ui/theme.js'

/** Cabeçalho do relatório, com a alternância de tema. */
export function Header({ onThemeChange }) {
  const [theme, setTheme] = useState(() => currentTheme())

  return (
    <header className="app-header">
      <div className="app-header__left">
        <div className="app-header__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28">
            <rect
              x="1"
              y="1"
              width="30"
              height="30"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            />
            <path d="M6 22 L16 8 L26 22" fill="none" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="16" cy="18" r="2.5" fill="currentColor" />
          </svg>
        </div>
        <div className="app-header__titles">
          <p className="app-header__op">Operação de Mina — Frota de Equipamentos Móveis</p>
          <h1 className="app-header__title">Guardian&nbsp;·&nbsp;Monitor de Exceções de FOV</h1>
        </div>
      </div>
      <div className="app-header__right">
        <button
          type="button"
          className="theme-toggle"
          id="theme-toggle"
          aria-pressed={theme === 'dark'}
          aria-label="Alternar tema claro/escuro"
          onClick={() => {
            setTheme(toggleTheme())
            onThemeChange()
          }}
        >
          <svg
            className="theme-toggle__sun"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg
            className="theme-toggle__moon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
          </svg>
        </button>
        <span className="dot" aria-hidden="true"></span>
        Processamento local
      </div>
    </header>
  )
}

/** Faixa de metadados do período coberto. */
export function Metagrid({ cells }) {
  return (
    <section className="panel panel--flush" aria-label="Metadados do período">
      <div className="metagrid" id="metagrid">
        {cells.map(({ key, label, value }) => (
          <div className="metacell" key={key}>
            <span className="metacell__k">{label}</span>
            <span className="metacell__v mono" data-meta={key}>
              {value}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

export function Footer({ generatedAt }) {
  return (
    <footer className="app-footer">
      <div className="app-footer__col">
        <span className="app-footer__k">Aplicação</span>
        <span className="mono">Guardian FOV Monitor v2.0.0</span>
      </div>
      <div className="app-footer__col">
        <span className="app-footer__k">Gerado em</span>
        <span className="mono" id="generated-at">
          {generatedAt}
        </span>
      </div>
      <div className="app-footer__col app-footer__col--wide">
        <span className="app-footer__k">Privacidade</span>
        <span>
          Processamento integralmente local. Nenhum dado da planilha sai desta máquina — não há
          backend, API ou envio de telemetria. Histórico e lista de observação ficam no{' '}
          <span className="mono">localStorage</span> deste navegador.
        </span>
      </div>
    </footer>
  )
}
