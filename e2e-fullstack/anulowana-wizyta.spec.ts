import { expect, request, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Zgłoszenie z 29.09, ok. 13:40 - na PRAWDZIWYM backendzie, prawdziwym tablecie
 * i endpointach CRM, bez jednej atrapy.
 *
 * Przebieg z produkcji: przyjęcie bez rezerwacji (szkic A) wysłało protokoły na
 * tablet. Pracownik w oknie dokumentów wybrał „Anuluj wizytę" i przyjął auto od
 * nowa z rezerwacji, którą przyjęcie A założyło samo (wizyta B). Tablet podawał
 * dalej protokoły A - wizyty, której już nie było - i każdy podpis kończył się
 * „Wizyta nie została znaleziona", aż żądania wygasły po 15 minutach.
 *
 * Studio testowe przygotowuje się samo (konto → plan w trybie bez płatności → kolor
 * rezerwacji), a każdy test ma własnego klienta, auto i tablet, więc plik można
 * puszczać wielokrotnie na tej samej bazie.
 */

/** Unikalne w obrębie przebiegu: klient i auto z tym samym numerem już by istnieli. */
const RUN = String(Date.now()).slice(-7);

const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:8080';
const SIGNER = 'Jan Czekaj';

interface Protocol {
  id: string;
  templateName: string;
}

interface Studio {
  api: APIRequestContext;
  colorId: string;
}

async function ok<T>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string): Promise<T> {
  const body = await res.text();
  expect(res.ok(), `${what}: HTTP ${res.status()} ${body}`).toBeTruthy();
  return (body ? JSON.parse(body) : undefined) as T;
}

/**
 * Studio testowe z pełnym planem. Konto zakłada się raz i potem tylko loguje:
 * rejestracja ma limit 5 na godzinę na adres (RateLimitFilter), a testy puszcza się
 * częściej. Bez skonfigurowanego Przelewy24 zamówienie planu rozlicza się od razu.
 */
async function testStudio(): Promise<Studio> {
  const api = await request.newContext({ baseURL: BACKEND_URL });
  const email = process.env.E2E_EMAIL ?? 'e2e-tablet@example.com';
  const password = process.env.E2E_PASSWORD ?? 'Haslo123!e2e';
  const login = () => api.post('/api/v1/auth/login', { data: { email, password } });
  const first = await login();
  // 429: limit logowań (10 na 10 minut na adres) - lokalnie zdejmuje go
  // `redis-cli --scan --pattern 'ratelimit:*' | xargs redis-cli del`.
  expect(first.status(), `logowanie: HTTP ${first.status()} ${await first.text()}`).not.toBe(429);
  if (!first.ok()) {
    await ok(
      await api.post('/api/v1/auth/signup', {
        data: { firstName: 'Martyna', lastName: 'Recepcja', email, password, confirmPassword: password, acceptTerms: true },
      }),
      'rejestracja',
    );
    await ok(await login(), 'logowanie');
  }
  const subscription = await ok<{ status: string }>(await api.get('/api/v1/subscription/status'), 'status planu');
  if (subscription.status !== 'ACTIVE') {
    const order = await ok<{ status: string }>(
      await api.post('/api/v1/subscription/checkout', { data: { type: 'INITIAL_PURCHASE', planKey: 'FULL' } }),
      'plan FULL',
    );
    expect(order.status, 'plan musi być opłacony bez bramki - backend ma skonfigurowane Przelewy24?').toBe('PAID');
  }
  const { colors } = await ok<{ colors: { id: string; name: string }[] }>(
    await api.get('/api/v1/appointment-colors'),
    'kolory rezerwacji',
  );
  const color =
    colors.find((c) => c.name === 'Detailing') ??
    (await ok<{ id: string }>(
      await api.post('/api/v1/appointment-colors', { data: { name: 'Detailing', hexColor: '#3B82F6' } }),
      'kolor rezerwacji',
    ));
  return { api, colorId: color.id };
}

const technicalState = { mileage: 120_000, deposit: { keys: true, registrationDocument: true }, inspectionNotes: '' };
// 1900,00 zł brutto wpisane od strony brutto - kwota z CLAUDE.md §1.
const services = [
  {
    id: 'line-1',
    serviceId: null,
    serviceName: 'Mycie detailingowe',
    basePriceNet: 154_472,
    basePriceGross: 190_000,
    vatRate: 23,
    adjustment: { type: 'PERCENT', value: 0 },
    note: null,
  },
];

/** Krok 1 przyjęcia bez rezerwacji: szkic wizyty A z protokołami. */
async function walkInCheckIn(studio: Studio, phone: string, licensePlate: string): Promise<{ visitId: string; protocols: Protocol[] }> {
  const now = Date.now();
  return ok(
    await studio.api.post('/api/checkin/walk-in', {
      data: {
        startDateTime: new Date(now).toISOString(),
        endDateTime: new Date(now + 3 * 3_600_000).toISOString(),
        customer: {
          mode: 'NEW',
          id: null,
          newData: { firstName: 'Jan', lastName: 'Czekaj', phone, email: null, homeAddress: null, company: null },
          updateData: null,
        },
        vehicle: {
          mode: 'NEW',
          id: null,
          newData: { brand: 'Audi', model: 'A6 Avant', yearOfProduction: 2019, licensePlate, color: null, paintType: null },
          updateData: null,
        },
        technicalState,
        photoIds: [],
        damagePoints: [],
        services,
        appointmentColorId: studio.colorId,
      },
    }),
    'przyjęcie bez rezerwacji',
  );
}

interface Draft {
  visitId: string;
  appointmentId: string;
  customerId: string;
  vehicleId: string;
}

async function openDraft(studio: Studio, visitId: string): Promise<Draft> {
  const { drafts } = await ok<{ drafts: Draft[] }>(await studio.api.get('/api/visits/drafts'), 'lista szkiców');
  const draft = drafts.find((d) => d.visitId === visitId);
  if (!draft) throw new Error(`Szkic ${visitId} nie wisi na liście nieukończonych przyjęć`);
  return draft;
}

/** Ponowne przyjęcie z rezerwacji, którą przyjęcie A założyło samo. */
async function checkInFromReservation(studio: Studio, draft: Draft): Promise<{ visitId: string; protocols: Protocol[] }> {
  return ok(
    await studio.api.post('/api/checkin/reservation-to-visit', {
      data: {
        reservationId: draft.appointmentId,
        title: null,
        customer: { mode: 'EXISTING', id: draft.customerId, newData: null, updateData: null },
        customerAlias: null,
        vehicle: { mode: 'EXISTING', id: draft.vehicleId, newData: null, updateData: null },
        technicalState,
        vehicleHandoff: null,
        photoIds: [],
        damagePoints: [],
        services,
        appointmentColorId: studio.colorId,
      },
    }),
    'przyjęcie z rezerwacji',
  );
}

/** „Wyślij na tablet" dla każdego protokołu przyjęcia - jak okno dokumentów w CRM. */
async function sendToTablet(studio: Studio, visitId: string, protocols: Protocol[], tabletId: string): Promise<string[]> {
  expect(protocols.length, 'przyjęcie nie wygenerowało żadnego protokołu').toBeGreaterThan(0);
  const ids: string[] = [];
  for (const protocol of protocols) {
    const created = await ok<{ id: string }>(
      await studio.api.post(`/api/v1/visits/${visitId}/protocols/${protocol.id}/signature-requests`, {
        data: { tabletId, signerName: SIGNER },
      }),
      `żądanie podpisu ${protocol.templateName}`,
    );
    ids.push(created.id);
  }
  return ids;
}

async function requestStatus(studio: Studio, requestId: string): Promise<string> {
  const dto = await ok<{ status: string }>(
    await studio.api.get(`/api/v1/signature-requests/${requestId}`),
    `status żądania ${requestId}`,
  );
  return dto.status;
}

/** Parowanie kodem z CRM, dokładnie jak na recepcji. Zwraca id tabletu z listy CRM. */
async function pairTablet(page: Page, studio: Studio, deviceName: string): Promise<string> {
  const { code } = await ok<{ code: string }>(await studio.api.post('/api/v1/tablets/pairing-codes'), 'kod parowania');
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toBeVisible();
  for (const digit of code) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByPlaceholder('np. Recepcja 1').fill(deviceName);
  await page.getByRole('button', { name: 'Połącz' }).click();
  await expect(page.locator('.standby-clock')).toBeVisible();

  const tablets = await ok<{ tabletId: string; deviceName: string }[]>(await studio.api.get('/api/v1/tablets'), 'lista tabletów');
  const tablet = tablets.find((t) => t.deviceName === deviceName);
  if (!tablet) throw new Error('Sparowany tablet nie pojawił się w CRM');
  return tablet.tabletId;
}

/** Id żądań, których dokument tablet pobrał - w kolejności pobrania. */
function trackShownDocuments(page: Page): string[] {
  const shown: string[] = [];
  page.on('request', (req) => {
    const match = /\/api\/tablet\/signature-requests\/([0-9a-f-]{36})\/document/.exec(req.url());
    if (match && shown.at(-1) !== match[1]) shown.push(match[1]);
  });
  return shown;
}

async function acceptAndSign(page: Page) {
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Przejdź do podpisu' }).click();
  const canvas = page.locator('canvas.signature-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Brak pola podpisu');
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + 60 + i * 12, box.y + box.height / 2 + Math.sin(i / 2) * 40, { steps: 2 });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Gotowe' }).click();
}

/** Tablet podpisuje po kolei wszystko, co poda mu serwer, aż wróci do czuwania. */
async function signEverything(page: Page, expected: string[], shown: string[]) {
  for (const requestId of expected) {
    await expect.poll(() => shown.at(-1), { message: 'tablet powinien pokazać dokument nowej wizyty' }).toBe(requestId);
    await acceptAndSign(page);
    await expect(page.getByText('Dziękujemy!')).toBeVisible();
  }
  await expect(page.locator('.standby-clock')).toBeVisible();
}

let studio: Studio;
test.beforeAll(async () => {
  studio = await testStudio();
});

test('„Anuluj wizytę" zdejmuje jej dokument z tabletu od razu, a klient podpisuje dokumenty nowej wizyty', async ({
  page,
}) => {
  const shown = trackShownDocuments(page);
  const tabletId = await pairTablet(page, studio, `Recepcja ${RUN} WS`);

  // ── Szkic A: przyjęcie bez rezerwacji, protokoły idą na tablet ──
  const visitA = await walkInCheckIn(studio, `+4861${RUN}`, `WZ ${RUN}A`);
  const draftA = await openDraft(studio, visitA.visitId);
  const requestsA = await sendToTablet(studio, visitA.visitId, visitA.protocols, tabletId);
  await expect.poll(() => shown.at(-1)).toBe(requestsA[0]);
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible();

  // ── Pracownik: „Przerwać przyjęcie pojazdu?" → „Anuluj wizytę" ──
  await ok(await studio.api.delete(`/api/visits/${visitA.visitId}/cancel`), 'anulowanie szkicu A');

  // Tablet dostaje SIGNATURE_CANCELLED przez WebSocket i schodzi z dokumentu, którego już nie ma.
  await expect(page.getByText('Pracownik anulował żądanie podpisu.')).toBeVisible();
  await expect(page.locator('.pdf-page canvas')).toHaveCount(0);
  for (const id of requestsA) expect(await requestStatus(studio, id)).toBe('CANCELLED');

  // ── Wizyta B z rezerwacji założonej przez przyjęcie A ──
  const visitB = await checkInFromReservation(studio, draftA);
  const requestsB = await sendToTablet(studio, visitB.visitId, visitB.protocols, tabletId);

  await signEverything(page, requestsB, shown);
  for (const id of requestsB) expect(await requestStatus(studio, id)).toBe('COMPLETED');
  expect(shown.filter((id) => requestsA.includes(id)), 'po anulowaniu żaden dokument A nie wrócił').toEqual([requestsA[0]]);
});

test('bez WebSocketu: podpis dokumentu anulowanej wizyty mówi klientowi, co zrobić, a potem tablet podaje wizytę B', async ({
  page,
}) => {
  // Najgorszy przypadek z produkcji: tablet nie dostał zdarzenia o anulowaniu
  // (zerwane połączenie) i klient podpisuje dokument, którego już nie ma.
  await page.route('**/ws-registry**', (route) => route.abort());
  const shown = trackShownDocuments(page);
  const tabletId = await pairTablet(page, studio, `Recepcja ${RUN} polling`);

  const visitA = await walkInCheckIn(studio, `+4862${RUN}`, `WZ ${RUN}B`);
  const draftA = await openDraft(studio, visitA.visitId);
  const requestsA = await sendToTablet(studio, visitA.visitId, visitA.protocols, tabletId);
  // Bez WS tablet znajduje żądanie przez polling kolejki.
  await expect.poll(() => shown.at(-1), { timeout: 60_000 }).toBe(requestsA[0]);

  await ok(await studio.api.delete(`/api/visits/${visitA.visitId}/cancel`), 'anulowanie szkicu A');
  const visitB = await checkInFromReservation(studio, draftA);
  const requestsB = await sendToTablet(studio, visitB.visitId, visitB.protocols, tabletId);

  // Klient kończy podpis dokumentu A - serwer odrzuca go, bo żądanie jest anulowane.
  await acceptAndSign(page);
  await expect(page.getByRole('heading', { name: 'Wystąpił problem' })).toBeVisible();
  await expect(
    page.getByText('Ten dokument nie jest już aktualny. Poproś pracownika o ponowne wysłanie dokumentu.'),
  ).toBeVisible();
  // Surowy komunikat serwera nie trafia do klienta.
  await expect(page.getByText(/status: CANCELLED/)).toHaveCount(0);
  await page.getByRole('button', { name: 'OK' }).click();

  // Kolejka nie podaje już A: od razu dokumenty B, bez czekania 15 minut na wygaśnięcie.
  await signEverything(page, requestsB, shown);
  for (const id of requestsB) expect(await requestStatus(studio, id)).toBe('COMPLETED');
  for (const id of requestsA) expect(await requestStatus(studio, id)).toBe('CANCELLED');
});
