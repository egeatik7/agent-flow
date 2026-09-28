import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import HelpManual from './manual/HelpManual'
import './styles/xp.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <HelpManual />
  </React.StrictMode>
)
