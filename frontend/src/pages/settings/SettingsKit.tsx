import { Control } from '../../components/ui'
import { flatKit } from '../../kit/flat'
import type { FieldProps, PageKit, PanelProps } from '../../kit/types'

function Panel({ title, meta, className = '', children }: PanelProps) {
  return (
    <div className={`sl-settings-section${className ? ` ${className}` : ''}`}>
      <header className="sl-settings-section__header">
        <h2 tabIndex={-1}>{title}</h2>
        {meta}
      </header>
      <div className="sl-settings-section__body">{children}</div>
    </div>
  )
}

function Field({ label, hint, children, wrap = true, className = '' }: FieldProps) {
  return (
    <label className={`sl-settings-field${className ? ` ${className}` : ''}`}>
      <span className="sl-settings-field__label">{label}</span>
      {wrap ? <Control>{children}</Control> : children}
      {hint && <span className="sl-settings-field__hint">{hint}</span>}
    </label>
  )
}

export const settingsKit: PageKit = {
  ...flatKit,
  Panel,
  Field,
}
