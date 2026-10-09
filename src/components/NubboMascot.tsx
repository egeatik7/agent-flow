import { useEffect, useState } from 'react'
import { version } from '../../package.json'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'
import logo from '../assets/nubbo-logo.png'
import aeroMascot from '../assets/nubbo-aero.png'
import aeroLogo from '../assets/nubbo-logo-aero.png'

/** Plays the transparent Nubbo loop. Hidden windows show the still frame so the animation stops. */
export default function NubboMascot() {
  const [playing, setPlaying] = useState(() => !document.hidden)
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    const onVis = () => setPlaying(!document.hidden)
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const src = broken || !playing ? still : nubbo
  return (
    <div className="nubbo-brand">
      <img
        key={src}
        className="nubbo-mascot brand-xp"
        src={src}
        alt=""
        width={186}
        height={186}
        draggable={false}
        onError={() => setBroken(true)}
      />
      <img className="nubbo-mascot brand-aero" src={aeroMascot} alt="" width={186} height={186} draggable={false} />
      <div className="nubbo-logo-slot">
        <img className="nubbo-logo brand-xp" src={logo} alt="Nubbo Agent Studio" draggable={false} />
        <img className="nubbo-logo brand-aero" src={aeroLogo} alt="Nubbo Agent Studio" draggable={false} />
      </div>
      <p className="nubbo-ver">version: {version}</p>
    </div>
  )
}
