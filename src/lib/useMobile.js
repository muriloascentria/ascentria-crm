import { useEffect, useState } from 'react'

const Q = '(max-width: 860px)'
/** true em tela de celular (até 860px de largura); acompanha a rotação da tela. */
export function useMobile() {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(Q).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(Q)
    if (!mq) return
    const on = () => setM(mq.matches)
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return !!m
}
