import { useRef, useState } from 'react'
import { supabase, DEMO } from '../lib/supabase'
import { useApp } from '../lib/store'
import { Avatar, Field, Modal } from './ui'
import { ROLES } from '../lib/utils'

/** Reduz a foto para 256×256 (recorte central) em JPEG — fotos de celular chegam com vários MB. */
function toSquareJpeg(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const s = Math.min(img.width, img.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
      URL.revokeObjectURL(img.src)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Não foi possível processar a imagem'))), 'image/jpeg', 0.88)
    }
    img.onerror = () => reject(new Error('Arquivo de imagem inválido'))
    img.src = URL.createObjectURL(file)
  })
}

const blobToDataUrl = (b) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b) })

export default function ProfileModal({ onClose }) {
  const { profile, reload, toast } = useApp()
  const [name, setName] = useState(profile.full_name || '')
  const [avatar, setAvatar] = useState(profile.avatar_url || null)
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  const pick = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) return toast('Escolha um arquivo de imagem (JPG, PNG ou WebP).', 'err')
    setBusy(true)
    try {
      const blob = await toSquareJpeg(file)
      let url
      if (DEMO) url = await blobToDataUrl(blob)
      else {
        const path = `${profile.id}/avatar-${Date.now()}.jpg`
        const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', upsert: true })
        if (error) throw error
        url = supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
      }
      setAvatar(url)
    } catch (err) {
      toast(err.message || 'Falha ao enviar a foto', 'err')
    } finally { setBusy(false) }
  }

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.from('profiles').update({ full_name: name.trim(), avatar_url: avatar }).eq('id', profile.id)
    setBusy(false)
    if (error) return toast(error.message, 'err')
    toast('Perfil atualizado'); await reload(); onClose()
  }

  return (
    <Modal title="Meu perfil" onClose={onClose}
      footer={<><button className="btn" type="button" onClick={onClose}>Cancelar</button><button className="btn primary" form="pform" disabled={busy}>Salvar</button></>}>
      <form id="pform" onSubmit={save} className="stack" style={{ gap: 16 }}>
        <div className="row" style={{ gap: 16 }}>
          <Avatar name={name || profile.email} src={avatar} lg />
          <div className="stack" style={{ gap: 6 }}>
            <div className="row wrap">
              <button type="button" className="btn sm" onClick={() => input.current?.click()} disabled={busy}>{busy ? 'Enviando…' : avatar ? 'Trocar foto' : 'Escolher foto'}</button>
              {avatar && <button type="button" className="btn ghost sm" onClick={() => setAvatar(null)} disabled={busy}>Remover foto</button>}
            </div>
            <span className="small muted">JPG, PNG ou WebP. A foto é recortada em formato quadrado.</span>
            <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
          </div>
        </div>
        <Field label="Nome"><input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></Field>
        <div className="grid2">
          <Field label="E-mail"><input className="input" value={profile.email} disabled /></Field>
          <Field label="Perfil"><input className="input" value={ROLES[profile.role] || profile.role} disabled /></Field>
        </div>
      </form>
    </Modal>
  )
}
