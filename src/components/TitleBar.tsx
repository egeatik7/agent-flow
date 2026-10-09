import appIcon from '../assets/app-icon-32.png'

export default function TitleBar(p: { onClose?: () => void }) {
  const api = typeof window !== 'undefined' ? window.xpAgent : undefined
  const profile = String(api?.profile ?? '')
  return (
    <div className="titlebar" onDoubleClick={() => void api?.maximize()}>
      <div className="titlebar-left">
        <img className="titlebar-icon" src={appIcon} alt="" aria-hidden draggable={false} />
        <h1>Nubbo Agent Studio</h1>
        {/* A test instance has its own empty profile. Without saying so, it looks exactly like the
            person's own window with the flows and the key missing - which is how it was read once. */}
        {profile ? <span className="titlebar-test">TEST profili · “{profile}” · kendi boş akışları</span> : null}
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
          onClick={() => p.onClose ? p.onClose() : void api?.close()}
        >
          ✕
        </button>
      </div>
    </div>
  )
}
