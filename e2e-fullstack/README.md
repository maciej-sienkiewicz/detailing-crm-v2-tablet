# Pełny test: tablet + backend + endpointy CRM

`e2e/` testuje tablet na atrapach API. `e2e-fullstack/` puszcza prawdziwą aplikację
tabletu na prawdziwym backendzie (REST + WebSocket), a kroki pracownika wykonuje przez
te same endpointy, których używa CRM. Łapie błędy kontraktu między aplikacjami, których
atrapy z definicji nie widzą. Przy pierwszym uruchomieniu wyszły dwa:

- handshake WebSocketu tabletu dostawał 403, więc tablet nigdy nie dostawał
  `SIGNATURE_CANCELLED` i działał wyłącznie na pollingu,
- podpis dokumentu anulowanego przez pracownika kończył się 409 z komunikatem
  technicznym zamiast zdania dla klienta.

## Co jest potrzebne

Backend z repozytorium `automotive-crm-v2-backend` i do niego:

| Usługa | Lokalnie |
|---|---|
| Postgres 16 z `pgvector` | pusta baza; schemat zakłada Hibernate (`ddl-auto=update`) |
| Redis | `redis-server` na 6379 |
| S3 | dowolna usługa zgodna z API S3, np. `moto_server -p 5055` (pip `moto[server]`), z bucketem `detailboost-crm` |

Backend startuje z flagą `-PksefStub` (bez PAT-a do GitHub Packages) i adresem S3
z `S3_ENDPOINT`:

```sh
curl -X PUT http://localhost:5055/detailboost-crm   # bucket w moto

DB_ADDR=localhost DB_PORT=5432 DB_NAME=crm_e2e DB_PASSWORD=... \
S3_ENDPOINT=http://localhost:5055 S3_ACCESS_KEY=test S3_SECRET_KEY=test \
OPENAI_API_KEY=sk-dummy STORAGE_METRICS_ENABLED=false AUTO_LEAD_CLASSIFICATION_ENABLED=false \
./gradlew bootRun -PksefStub
```

`OPENAI_API_KEY` musi być niepusty, żeby wstał kontekst Springa; ten scenariusz AI nie woła.
Szablony protokołów studio dostaje samo przy rejestracji (zapisują się w S3).

## Uruchomienie

```sh
E2E_BACKEND_URL=http://localhost:8080 npm run test:e2e:fullstack
```

Test sam zakłada konto `e2e-tablet@example.com` (albo `E2E_EMAIL` / `E2E_PASSWORD`)
i kupuje plan FULL. Bez skonfigurowanego Przelewy24 zamówienie rozlicza się od razu.
Kolejne przebiegi tylko się logują.

Backend ma limity: rejestracja 5 na godzinę, logowanie 10 na 10 minut na adres. Gdy
lokalnie je przekroczysz (HTTP 429):

```sh
redis-cli --scan --pattern 'ratelimit:*' | xargs redis-cli del
```
