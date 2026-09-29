import appIcon from '../assets/app-icon-32.png'

export default function TitleBar() {
  const api = typeof window !== 'undefined' ? window.xpAgent : undefined
  return (
    <div className="titlebar" onDoubleClick={() => void api?.maximize()}>
      <div className="titlebar-left">
        <img className="titlebar-icon" src={appIcon} alt="" aria-hidden draggable={false} />
        <h1>Nubbo Agent Studio</h1>
      </div>
      <div className="titlebar-controls">
        <button
          type="button"
          className="title-btn"
          title="Küçült"
          onClick={() => void api?.minimize()}
        >
          _
        </button>
        <button
          type="button"
          className="title-btn"
          title="Büyüt"
          onClick={() => void api?.maximize()}
        >
          ▢
        </button>
        <button
          type="button"
          className="title-btn close"
          title="Kapat"
          onClick={() => void api?.close()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
