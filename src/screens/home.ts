import { joinRoom } from '../main'

export function mountHome(el: HTMLElement) {
  el.innerHTML = `
    <div style="text-align:center;padding:clamp(24px,6vw,48px) clamp(16px,5vw,32px);background:rgba(0,0,0,0.85);border-radius:16px;width:min(360px,90vw);box-sizing:border-box">
      <div style="font-size:56px;margin-bottom:8px">⚽</div>
      <h1 style="font-size:32px;font-weight:bold;margin-bottom:6px">Mini Soccer</h1>
      <p style="color:#888;margin-bottom:32px;font-size:14px">실시간 5 vs 5 카오스 축구</p>
      <button id="btn-solo" style="display:block;width:220px;margin:0 auto 12px;padding:14px;font-size:16px;
        border-radius:10px;background:#0ea5e9;color:#fff;border:none;cursor:pointer;font-weight:bold">
        혼자 하기
      </button>
      <button id="btn-create" style="display:block;width:220px;margin:0 auto 12px;padding:14px;font-size:16px;
        border-radius:10px;background:#6366f1;color:#fff;border:none;cursor:pointer;font-weight:bold">
        방 만들기
      </button>
      <button id="btn-join" style="display:block;width:220px;margin:0 auto 12px;padding:14px;font-size:16px;
        border-radius:10px;background:#374151;color:#fff;border:none;cursor:pointer">
        방 참가
      </button>
      <input id="room-code" placeholder="4자리 숫자 입력" maxlength="4" inputmode="numeric" pattern="[0-9]*"
        style="display:none;width:220px;margin:0 auto 8px;padding:13px;text-align:center;font-size:22px;
        border-radius:10px;border:2px solid #555;background:#1a1a2e;color:#fff;letter-spacing:6px;
        box-sizing:border-box;" />
      <button id="btn-enter" style="display:none;width:220px;margin:0 auto;padding:14px;font-size:16px;
        border-radius:10px;background:#16a34a;color:#fff;border:none;cursor:pointer;font-weight:bold">
        입장
      </button>
      <p style="width:220px;margin:20px auto 0;padding:6px 8px;border-radius:8px;background:rgba(255,200,0,0.12);
        border:1px solid rgba(255,200,0,0.35);color:#facc15;font-size:12px;font-weight:bold;box-sizing:border-box;white-space:nowrap">
        📱 모바일은 가로 모드로 플레이하세요
      </p>
    </div>`

  el.querySelector('#btn-solo')!.addEventListener('click', () => {
    const code = String(Math.floor(Math.random() * 9000) + 1000)
    joinRoom(code, true)
  })

  el.querySelector('#btn-create')!.addEventListener('click', () => {
    const code = String(Math.floor(Math.random() * 9000) + 1000)
    joinRoom(code)
  })

  const joinBtn = el.querySelector<HTMLButtonElement>('#btn-join')!
  const codeInput = el.querySelector<HTMLInputElement>('#room-code')!
  const enterBtn = el.querySelector<HTMLButtonElement>('#btn-enter')!

  joinBtn.addEventListener('click', () => {
    joinBtn.style.display = 'none'
    codeInput.style.display = 'block'
    enterBtn.style.display = 'block'
    codeInput.focus()
  })

  const tryJoin = () => {
    if (codeInput.value.length === 4) joinRoom(codeInput.value)
  }

  codeInput.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') tryJoin()
  })

  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.replace(/\D/g, '').slice(0, 4)
    enterBtn.style.opacity = codeInput.value.length === 4 ? '1' : '0.4'
  })

  enterBtn.addEventListener('click', tryJoin)
}
