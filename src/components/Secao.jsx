import { useEffect, useState } from 'react'

/**
 * Seção do card que abre e fecha com um toque.
 * aberta: estado inicial; abrir: quando muda para true, a seção abre (ex.: um botão do "próximo passo" pediu).
 */
export default function Secao({ icone, titulo, resumo, aberta = false, abrir, children, id }) {
  const [open, setOpen] = useState(aberta)
  useEffect(() => { if (abrir) setOpen(true) }, [abrir])
  return (
    <section className={'secao' + (open ? ' on' : '')} id={id}>
      <button type="button" className="secao-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="secao-ico" aria-hidden="true">{icone}</span>
        <span className="secao-tit">{titulo}</span>
        {resumo && <span className="secao-res">{resumo}</span>}
        <span className="secao-seta" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && <div className="secao-body">{children}</div>}
    </section>
  )
}
