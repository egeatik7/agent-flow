import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import Hud from './components/Hud'
import HelpManual from './manual/HelpManual'
import './styles/xp.css'
import './styles/xp-luna.css'
import './styles/workspace.css'

const hud = new URLSearchParams(window.location.search).get('hud') === '1' || window.location.hash.replace('#', '') === 'hud'
if (hud) document.documentElement.classList.add('hud-root')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{hud ? <Hud /> : (<><App /><HelpManual /></>)}</React.StrictMode>
)
