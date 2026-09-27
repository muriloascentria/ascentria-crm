import { useEffect } from 'react'
import { useApp } from '../lib/store'
import { initials } from '../lib/utils'

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose?.()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Fechar">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, children, hint }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <span className="small muted">{hint}</span>}
    </div>
  )
}

export function Avatar({ name, sm, lg, src }) {
  const cls = 'avatar' + (sm ? ' sm' : '') + (lg ? ' lg' : '')
  if (src) return <img className={cls} src={src} alt={name || ''} title={name} />
  return <span className={cls} title={name}>{initials(name)}</span>
}

export function Empty({ title, text, action }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  )
}

export function Toasts() {
  const { toasts } = useApp()
  return (
    <div className="toasts">
      {toasts.map((t) => <div key={t.id} className={'toast' + (t.kind === 'err' ? ' err' : '')}>{t.message}</div>)}
    </div>
  )
}

export function UserSelect({ value, onChange, allowEmpty }) {
  const { users } = useApp()
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowEmpty && <option value="">— Sem responsável —</option>}
      {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.full_name || u.email}</option>)}
    </select>
  )
}

/** Renderiza os campos personalizados de uma entidade (contact | company | deal). */
export function CustomFieldsForm({ entity, values, onChange }) {
  const { customFields } = useApp()
  const fields = customFields.filter((f) => f.entity === entity)
  if (!fields.length) return null
  const set = (k, v) => onChange({ ...(values || {}), [k]: v })
  return (
    <div className="grid2">
      {fields.map((f) => {
        const v = values?.[f.key] ?? ''
        return (
          <Field key={f.id} label={f.label + (f.required ? ' *' : '')}>
            {f.type === 'select' ? (
              <select className="select" value={v} onChange={(e) => set(f.key, e.target.value)} required={f.required}>
                <option value="">—</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.type === 'checkbox' ? (
              <label className="check"><input type="checkbox" checked={!!v} onChange={(e) => set(f.key, e.target.checked)} /> Sim</label>
            ) : f.type === 'textarea' ? (
              <textarea className="textarea" value={v} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
            ) : (
              <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'url' ? 'url' : 'text'}
                value={v} onChange={(e) => set(f.key, e.target.value)} required={f.required} />
            )}
          </Field>
        )
      })}
    </div>
  )
}

export function CustomFieldsView({ entity, values }) {
  const { customFields } = useApp()
  const fields = customFields.filter((f) => f.entity === entity && values?.[f.key] !== undefined && values?.[f.key] !== '')
  if (!fields.length) return null
  return (
    <div className="grid2">
      {fields.map((f) => (
        <div key={f.id}><div className="small muted">{f.label}</div><div>{f.type === 'checkbox' ? (values[f.key] ? 'Sim' : 'Não') : String(values[f.key])}</div></div>
      ))}
    </div>
  )
}

export function ConfirmButton({ onConfirm, children, className = 'btn danger sm', message = 'Tem certeza? Esta ação não pode ser desfeita.' }) {
  return <button type="button" className={className} onClick={() => window.confirm(message) && onConfirm()}>{children}</button>
}
