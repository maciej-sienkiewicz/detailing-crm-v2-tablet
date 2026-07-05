# DetailBoost Tablet

Kiosk webowy do składania podpisu elektronicznego przez klientów salonu
detailingowego. Uruchamiany na tabletach (Android/iPad, przeglądarka w trybie
pełnoekranowym) zamontowanych na recepcji, ekranem w stronę klienta.
Produkcja: `https://www.tablet.detailboost.pl`.

## Uruchomienie

```bash
npm install
npm run dev        # dev server (Vite)
npm run build      # typecheck + build produkcyjny do dist/
npm test           # testy jednostkowe (Vitest): maszyna stanów, SHA-256
npm run test:e2e   # testy e2e (Playwright): parowanie → standby → podpis (mock API)
```

Konfiguracja: `VITE_API_BASE_URL` (patrz `.env.example`). Domyślnie
`https://detailboost.pl`.

## Architektura (`src/tablet`)

| Katalog | Zawartość |
| --- | --- |
| `api/` | klient REST (`X-Tablet-Token`), typy kontraktu, storage parowania |
| `ws/` | klient STOMP przez SockJS z backoffem 1s → 2s → 5s → 10s |
| `state/` | maszyna stanów aplikacji (czysty reducer, testowany jednostkowo) |
| `crypto/` | SHA-256 (WebCrypto) nad dokładnymi bajtami PDF — zasada WYSIWYS |
| `pdf/` | loader pdf.js + `DocumentStore` (deterministyczne niszczenie bufora) |
| `screens/` | Pairing, Standby, DocumentReview, SignaturePad, Submitting, ThankYou, DeclinedInfo, Error |
| `components/` | `SignatureCanvas` (przezroczyste tło, PNG z alfa), `PdfViewer` (pinch-zoom), `Countdown` |
| `hooks/` | wake lock, tryb kiosku (fullscreen), zegar minutowy, status online |

Maszyna stanów:

```
UNPAIRED ─pair→ CONNECTING ─ok→ STANDBY ─WS/polling→ DOCUMENT_REVIEW
   ↑403             │403            ↑                     │checkbox
   └────────────────┘               │                     ▼
                                    ├── THANK_YOU ← SUBMITTING ← SIGNATURE_PAD
                                    ├── DECLINED_INFO ←┘(odmowa)      │
                                    └── ERROR_SCREEN ←────────────────┘(błąd)
```

## Gwarancje bezpieczeństwa (eIDAS / WYSIWYS)

- **Integralność**: tablet liczy SHA-256 nad pobranymi bajtami PDF i porównuje
  z nagłówkiem `X-Document-Sha256` **oraz** `documentSha256` z `pending`.
  Rozbieżność = twardy błąd, dokument nie jest renderowany. Ten sam hash
  wraca w submit.
- **Podpis bez tła**: canvas nigdy nie maluje tła — eksport to PNG z pełnym
  kanałem alfa (jasne jest tylko otoczenie pola w CSS).
- **Anty-replay**: jednorazowy `challenge` z `pending` wraca przy submit;
  submit nie jest nigdy ponawiany automatycznie.
- **Niszczenie danych**: po sukcesie i po błędzie bufor PDF jest zerowany /
  zwalniany (`DocumentStore.wipe()`), dokument pdf.js niszczony, canvas
  czyszczony przy odmontowaniu. W `localStorage` żyje wyłącznie token
  urządzenia i metadane parowania.
- **Cache**: service worker obsługuje tylko powłokę aplikacji; `/api/**`
  i `/ws-registry/**` nigdy nie przechodzą przez cache (`Cache-Control:
  no-store` jest honorowane, `fetch` z `cache: 'no-store'`).

## Odporność na utratę łączności

WebSocket jest wyłącznie sygnałem wybudzającym — źródłem prawdy jest
`GET /api/tablet/signature-requests/pending`, wołany po każdym zdarzeniu WS,
po każdym reconnect i przy wejściu w tryb czuwania. Gdy WS jest rozłączony,
aplikacja polluje `pending` co 10 s, więc żądanie utworzone podczas przerwy
w łączności nie przepada (weryfikowane testem e2e, który blokuje WS).
