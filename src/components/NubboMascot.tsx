import { useEffect, useState } from 'react'
import { version } from '../../package.json'
import nubbo from '../assets/nubbo.png'
import still from '../assets/nubbo-still.png'

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
        className="nubbo-mascot"
        src={src}
        alt=""
        width={176}
        height={176}
        draggable={false}
        onError={() => setBroken(true)}
      />
      <p className="nubbo-name">Nubbo Agent Studio</p>
      <p className="nubbo-ver">{version}</p>
    </div>
  )
}
