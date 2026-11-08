# phone-open-qr · 폰에서 바로 여는 QR

Claude Code로 코딩하다가 "이 주소를 폰에서 열어 보세요"라는 말을 들으면, 주소를 이메일로 보내고 폰에서 다시 열어야 했습니다.
이 플러그인은 **대화창 안, 주소 바로 아래에 QR 코드를 그려 줍니다.** 폰 카메라를 대고 탭하면 끝입니다.

Coding with Claude Code and need to check a page on your phone? A QR code appears right in the conversation.
Point your camera, tap, done. No more emailing links to yourself.

## 무엇이 되나

- `/phone-open-qr <주소>` 를 치면 "이동하려면 휴대전화 카메라로 아래 QR을 찍으세요." 안내와 함께 QR 코드가 뜹니다.
  데스크톱 앱에서는 오른쪽 창에, 대화창 안 그리기를 지원하는 화면에서는 주소 바로 아래에 그려집니다.
- Claude가 "폰에서 확인해 보세요"라고 말할 때 **스스로** QR을 띄웁니다. 플러그인이 Claude에게 그렇게 하라고 알려 줍니다.
- `localhost` 주소는 폰에서 열 수 없으므로, 이 컴퓨터의 Wi-Fi 주소(예: `192.168.0.12`)로 바꿔서 QR을 만듭니다.
  폰이 같은 Wi-Fi에 있어야 합니다.
- 터미널에서도 동작합니다. 글자 블록으로 QR을 그립니다.

## 설치

터미널 세션의 프롬프트에서:

```
/plugin install phone-open-qr --marketplace nitibrush/phone-open-qr
```

셸에서:

```
claude plugin install phone-open-qr --marketplace nitibrush/phone-open-qr
```

데스크톱 앱에서 `/plugin` 이 안 될 때: 프롬프트 상자 옆 **+** 를 누르고 **Plugins** → **Add marketplace** 에
`nitibrush/phone-open-qr` 를 넣은 뒤 **Add plugin** 을 누릅니다.

## 사용

```
/phone-open-qr https://example.com/ko/
/phone-open-qr localhost:3000
/phone-open-qr            ← 마지막 QR을 다시 띄웁니다
```

Claude에게 "폰에서 열어 볼게" 라고만 해도 됩니다. Claude가 `show_qr` 도구를 불러 QR을 띄웁니다.

## 폰에서 안 열릴 때

- 아이폰: 기본 **카메라** 앱(제어 센터의 코드 스캐너가 아님)으로 비추세요. 설정 › 앱 › 카메라 › **QR 코드 스캔** 이 켜져 있어야 합니다.
- QR이 작게 보이면 창을 넓히거나 폰을 조금 더 가까이 대세요.
- `192.168…` 주소가 안 열리면 폰과 컴퓨터가 같은 Wi-Fi인지, 개발 서버가 외부 접속을 허용하는지(`--host 0.0.0.0` 등) 확인하세요.

## 무엇을 실행하고, 무엇을 보내나 (What it runs and sends)

- 이 플러그인은 **아무 데이터도 외부로 보내지 않습니다.** 네트워크 요청이 없고, 주소를 기록하거나 수집하지 않습니다.
- QR 코드는 이 저장소 안의 코드(`hooks/qr.ts`)로 컴퓨터 안에서 만듭니다. 외부 QR 서비스를 쓰지 않습니다.
- `localhost` 주소를 받았을 때만, 이 컴퓨터의 Wi-Fi 주소를 알아내려고 `ipconfig`(Windows), `ipconfig getifaddr en0`(macOS), `hostname -I`(Linux) 를 이 순서로 실행하고, 첫 번째로 나온 사설 IP 하나만 읽습니다. 다른 프로그램은 실행하지 않습니다.
- 보관하는 것은 마지막 QR 20개의 주소뿐이며, Claude Code 세션 상태 안에만 있습니다.

This plugin sends nothing anywhere: no network requests, no logging of URLs. QR codes are generated locally by the code in this repository (`hooks/qr.ts`). Only for a `localhost` URL it runs, in this order, `ipconfig` (Windows), `ipconfig getifaddr en0` (macOS) and `hostname -I` (Linux), and reads one private IP address from the output. It runs no other programs. The last 20 URLs are kept in Claude Code session state only.

## 코드가 하는 일, 항목별로 (What the code does, hook by hook)

The mod is one hooks module, `hooks/register.tsx`, plus the QR encoder `hooks/qr.ts` it imports (a plain TypeScript helper with no side effects). Every call it makes is on the Claude Code engine interface `$`; nothing comes from another plugin.

- **session.start** — registers the slash command `/phone-open-qr` and the tool `show_qr`. Nothing else.
- **prompt.compose** — appends one short paragraph to the system prompt (session scope). It tells Claude: when you ask the user to open a URL on their phone, call `show_qr` with that URL and do not describe the QR yourself. It removes or changes nothing else, and reads the other sections only to pass them through unchanged.
- **command.run** (`/phone-open-qr`) — answers the command itself: normalizes the URL, finds the Wi-Fi address for a `localhost` URL (see above), stores the row and draws it. With no argument it repeats the last QR.
- **tool.call** (`mcp__phone-open-qr__show_qr`) — answers **the mod's own tool** with text describing what was drawn. It does not stand in for any other tool and matches only its own tool name.
- **ui.render** (Pane, Placed) — draws the QR row: caption, QR image (SVG on desktop, half-block text in a terminal), the link, and an optional note.
- **Engine calls used:** `$.command.register`, `$.tool.register`, `$.process.run` (the three commands above only), `$.clock.now`, `$.state` (via the atoms `rows`, `last`), `$.ui.place`, `$.ui.open`, `$.ui.resolve`. No `$.fs`, no `$.model`, no `$.agent`, no network.

## 라이선스

MIT. QR 인코더는 외부 라이브러리 없이 이 저장소 안에 들어 있습니다.
