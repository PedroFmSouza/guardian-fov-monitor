/* Fontes empacotadas localmente — nenhuma requisição a CDN em runtime. */
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '../styles/main.css'

import { createRoot } from 'react-dom/client'

import { App } from './app/App.jsx'

/**
 * Sem <StrictMode> de propósito.
 *
 * Em desenvolvimento ele monta cada efeito duas vezes, o que faria todo gráfico
 * ser criado, destruído e recriado — com Chart.js, que é imperativo e dono do
 * canvas, isso troca o comportamento de dev pelo de produção justamente na
 * camada mais frágil. O ganho (detectar efeitos sem limpeza) não paga: os
 * efeitos de gráfico têm limpeza, e é o teste de fumaça que os verifica de
 * verdade, contra o build.
 */
createRoot(document.getElementById('root')).render(<App />)
