# DayBrief frontend design contract

This project-specific baseline supports the existing DayBrief API and email briefing workflow. It does not claim an external brand affiliation. The user authorized autonomous implementation; no separate design approval is pending.

## 1. Visual direction

Clean, product-grade Korean news reader. Neutral gray canvas, white cards, one green accent, Pretendard type, small line icons only where they label an action (upload, file, search, external link, like/dislike). No gradients, illustrations, slogans, English eyebrows, or decorative statistics.

## 2. Color

| Token | Value | Use |
|---|---|---|
| `--bg` | `#F4F5F7` | Page canvas |
| `--surface` | `#FFFFFF` | Cards, inputs |
| `--surface-sunken` | `#F8F9FA` | Dropzone, file row, tags, reason panel |
| `--ink` / `--ink-2` | `#191F28` / `#333D4B` | Headings / body text |
| `--muted` | `#636E7B` | Metadata, hints (≥4.5:1 on canvas) |
| `--line-input` | `#8B95A1` | Input borders (≥3:1 on white) |
| `--line` / `--line-strong` | `#E5E8EB` / `#D1D6DB` | Card borders / input borders |
| `--accent` | `#0F7A55` | Primary action, focus, positive state |
| `--accent-soft` / `--accent-ink` | `#E9F6F0` / `#0A5C40` | Keyword tags, high-importance badge, success |
| `--error` / `--error-soft` | `#C0362C` / `#FEF3F2` | Errors, negative preference |
| `--warn` / `--warn-soft` | `#9A5B06` / `#FFF8E8` | Example-mode banner |
| `--disabled-bg` / `--disabled-ink` | `#ECEEF1` / `#7D8794` | Disabled controls (no opacity fades) |

Selected filter uses ink background with white text. Never use color as the only state signal.

## 3. Typography

`Pretendard Variable` from jsDelivr (the dev server CSP allows only that host for styles/fonts), falling back to the system stack. Page title 28px/700 (mobile 23px); story title 19px/700 (mobile 17px); card heading 17px; body 15px/1.75; metadata 13px; badges 12px minimum. Tabular numerals for counts and scores. `word-break: keep-all` for Korean.

## 4. Spacing and layout

4/8/12/16/20/24/32/48px steps. Single reading column: 760px content (settings and memory 640px), 24px gutter (mobile 16px). Sticky 60px app bar with max 1080px inner width.

## 5. Shape

Radius: controls 8px, alerts/file rows 12px, cards 16px (mobile story cards 12px), pills 999px.

## 6. Depth

Cards: 1px `--line` border plus a very light shadow (`--shadow`). No other elevation except the translucent sticky app bar.

## 7. Interaction states

Default, hover, focus-visible, pending, disabled, and pressed (sent feedback uses `aria-pressed`). Focus: 3px `--focus` outline; text fields use accent border plus a 3px soft ring. Targets at least 36px on desktop and 44px for primary/mobile actions. Motion 150ms color/border transitions; progress bar width 400ms; all disabled under `prefers-reduced-motion`.

## 8. Components

- App bar: logo mark + DayBrief wordmark, underline tabs, API status pill (checking/ok/error) with retry.
- Composer card (briefing start): date overline, title, keyword tag input (Enter/comma adds, Backspace removes, saves to this browser), file dropzone with drag-and-drop → file row with change action, optional JSON paste, full-width primary `브리핑 만들기 · 기사 N건` with a reason hint when disabled, example link.
- Progress card: batch progress bar, explanatory hint, cancel.
- Results: date overline, `선별한 기사 N건` title, source/keyword meta, `새 브리핑 만들기`; filter pills with counts, search, sort.
- Story card: rank, source · time, importance badge (≥80 accent, 60–79 neutral, below outline), title, summary, keyword tags, footer with original link, selection-reason disclosure, like/dislike (topic select only when several keywords match).
- Excluded-articles disclosure card, AI caution note.
- Settings form card, quiet email-subscription card, destructive clear action.
- Memory: diverging preference bars (−5…+5, centre line) and feedback history with like/dislike icons.
- When an action hides or disables the focused control, focus moves to its result (results title, cancel, feedback status, generate button after failure).

## 9. Screens and responsive layout

Routes `#dashboard` (default), `#briefing`, `#settings`, `#memory`. The dashboard shows today's briefing stats and top 3 articles (real results only, never the example), keyword distribution bars (single accent hue, counts as text), a server preference summary, and the fixed email schedule from the workflow; its two middle cards stack below 760px. Briefing shows exactly one of composer, progress, or results. At 760px or narrower tabs move to a full-width second row, toolbars stack, story footers stack, and vote buttons become full-width 44px targets. No horizontal scrolling at 360px.

Example mode keeps the warn banner visible while sample content is shown and never offers links or feedback.

## 10. Voice

Use concise Korean `해요`/`하세요` sentences and specific action labels: `뉴스 파일 불러오기`, `브리핑 만들기`, `관심사 저장`, `다시 시도`. Say what happened and what the user can do next. Avoid invented metrics, praise, urgency, and claims of successful server storage before an API response confirms it.

Copy examples:

- Empty: `아직 브리핑이 없어요. 수집한 뉴스 파일을 불러와 시작하세요.`
- Demo: `예시 브리핑 · 실제 수집 뉴스가 아니며 피드백은 저장되지 않아요.`
- Pending: `뉴스를 요약하고 있어요. 기사 수에 따라 시간이 걸릴 수 있어요.`
- API failure: `브리핑을 만들지 못했어요. 서버 연결을 확인한 뒤 다시 시도하세요.`
- Local settings: `이 브라우저에 저장했어요. 이메일 구독 설정에는 반영되지 않아요.`

## 11. Product context

Verified from the repository: DayBrief selects and summarizes news by user keywords, delivers email briefings, and supports topic-preference feedback. No founding history, customer count, or official marketing tagline is asserted.

## 12. Principles

Show source and evidence before decorative presentation. Distinguish local preferences, API data, and examples. Keep the main reading flow usable without a server; reserve mutations for explicit user actions. Do not fabricate signup, subscriptions, authentication, or news-collection endpoints.

## 13. Audience

Design assumption: Korean readers reviewing news matched to their interests. A secondary implementation context is project teammates validating the existing APIs. This is a task-derived assumption, not a user-research finding.

## 14. Empty, loading, error, success

Every data surface includes empty and error states. Loading preserves context with visible text and `aria-busy`; a success announcement uses `role="status"` or a polite live region. Validation errors associate with their fields. Do not display a blank page or silently substitute examples after an API failure. Feedback examples never write to the backend.

## 15. Motion and accessibility

Use short color/border transitions (150ms); motion beyond that is limited to the progress bar width and the disclosure chevron, both of which show a state change; honor `prefers-reduced-motion`. No automatic carousels or looping decoration. Provide a skip link, semantic headings, landmarks, form labels, native buttons, keyboard-operable disclosures, and explicit external-link behaviour. Render all server/user text safely and allow only HTTP(S) article destinations.
