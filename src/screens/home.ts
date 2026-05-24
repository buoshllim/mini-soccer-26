import { joinRoom } from '../main'

export function mountHome(el: HTMLElement) {
  el.innerHTML = `
    <div style="text-align:center;padding:48px 32px;background:rgba(0,0,0,0.85);border-radius:16px;min-width:320px">
      <div style="font-size:56px;margin-bottom:8px">⚽</div>
      <h1 style="font-size:32px;font-weight:bold;margin-bottom:6px">Mini Soccer</h1>
      <p style="color:#888;margin-bottom:32px;font-size:14px">실시간 5v5 축구</p>
      <button id="btn-create" style="display:block;width:220px;margin:0 auto 12px;padding:14px;font-size:16px;
        border-radius:10px;background:#6366f1;color:#fff;border:none;cursor:pointer;font-weight:bold">
        방 만들기
      </button>
      <button id="btn-join" style="display:block;width:220px;margin:0 auto 12px;padding:14px;font-size:16px;
        border-radius:10px;background:#374151;color:#fff;border:none;cursor:pointer">
        방 참가
      </button>
      <input id="room-code" placeholder="6자리 코드 입력" maxlength="6"
        style="display:none;margin-top:8px;padding:12px;width:220px;text-align:center;font-size:20px;
        border-radius:8px;border:1px solid #555;background:#1a1a2e;color:#fff;letter-spacing:4px" />
    </div>`

  el.querySelector('#btn-create')!.addEventListener('click', () => {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase()
    joinRoom(code)
  })

  const joinBtn = el.querySelector('#btn-join')!
  const codeInput = el.querySelector<HTMLInputElement>('#room-code')!

  joinBtn.addEventListener('click', () => {
    codeInput.style.display = 'block'
    codeInput.focus()
  })

  codeInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && codeInput.value.length === 6) {
      joinRoom(codeInput.value.toUpperCase())
    }
  })

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase()
  })
}
