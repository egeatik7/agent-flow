export default function TitleBar() {
  const api = typeof window !== 'undefined' ? window.xpAgent : undefined
  return (
    <div className="titlebar">
      <div className="titlebar-left">
        <div className="titlebar-icon" aria-hidden />
        <h1>XP Agent Studio — Node Promptlatıcı</h1>
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
