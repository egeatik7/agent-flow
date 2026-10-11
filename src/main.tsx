import React from 'react'
import ReactDOM from 'react-dom/client'
import './styles/xp.css'
import './styles/xp-luna.css'
import './styles/workspace.css'

const hud = new URLSearchParams(window.location.search).get('hud') === '1' || window.location.hash.replace('#', '') === 'hud'
const viewer=window.location.pathname==='/viewer'||new URLSearchParams(window.location.search).get('viewer')==='1'
const Viewer=React.lazy(()=>import('./viewer/ViewerApp'))
const Hud=React.lazy(()=>import('./components/Hud'))
const Desktop=React.lazy(async()=>{const [{default:App},{default:HelpManual}]=await Promise.all([import('./App'),import('./manual/HelpManual')]);return {default:()=> <><App/><HelpManual/></>}})
if (hud) document.documentElement.classList.add('hud-root')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><React.Suspense fallback={<p>Nubbo açılıyor…</p>}>{viewer?<Viewer/>:hud?<Hud/>:<Desktop/>}</React.Suspense></React.StrictMode>
)
