type Props = {
  recording: boolean
  running: boolean
  canDelete: boolean
  onAddNode: () => void
  onToggleRecord: () => void
  onCapture: () => void
  onRun: () => void
  onRefreshTree: () => void
  onSaveGraph: () => void
  onDelete: () => void
}

export default function Toolbar(props: Props) {
  return (
    <div className="toolbar">
      <button type="button" className="xp-btn" onClick={props.onAddNode}>
        + Node Ekle
      </button>
      <button
        type="button"
        className={`xp-btn ${props.recording ? 'record-on' : 'danger'}`}
        onClick={props.onToggleRecord}
      >
        {props.recording ? '● Kayıt Açık' : '○ Kayıt'}
      </button>
      <button type="button" className="xp-btn" onClick={props.onCapture}>
        İmleçteki Öğeyi Yakala
      </button>
      <button
        type="button"
        className="xp-btn primary"
        disabled={props.running}
        onClick={props.onRun}
      >
        {props.running ? 'Çalışıyor…' : '▶ Ajanı Çalıştır'}
      </button>
      <button type="button" className="xp-btn" onClick={props.onRefreshTree}>
        Accessibility Tree
      </button>
      <button type="button" className="xp-btn save" onClick={props.onSaveGraph}>
        Grafiği Kaydet
      </button>
      <button
        type="button"
        className="xp-btn"
        disabled={!props.canDelete}
        onClick={props.onDelete}
      >
        Node Sil
      </button>
    </div>
  )
}
