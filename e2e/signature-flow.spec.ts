import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { buildTestPdf } from './fixtures/pdf';

/**
 * E2E ścieżki krytycznej: parowanie → standby → podpis (mock API przez
 * page.route). Endpoint /ws-registry jest blokowany, więc test weryfikuje
 * jednocześnie fallback pollingu `pending` (DoD pkt 6).
 *
 * Mock CELOWO nie serwuje /signature-requests/queue w testach jednodokumentowych
 * (odpowiada na nie proxy deva błędem) — dzięki temu przechodzą one przez
 * fallback queue → pending, czyli ścieżkę tabletu ze starszym backendem.
 * Kolejkę wielodokumentową pokrywa osobny test niżej.
 */

const PDF_BYTES = buildTestPdf();
const PDF_SHA256 = createHash('sha256').update(PDF_BYTES).digest('hex');

const PAIRING = {
  tabletId: '0d9f0000-0000-0000-0000-000000000001',
  token: 'test-token-abc',
  studioId: '8c1b0000-0000-0000-0000-000000000002',
};

function pendingRequest() {
  return {
    requestId: 'b7e20000-0000-0000-0000-000000000003',
    documentName: 'Protokół przyjęcia pojazdu',
    signerName: 'Jan Kowalski',
    declarationText:
      'Oświadczam, że zapoznałem/zapoznałam się z treścią niniejszego dokumentu, rozumiem jego treść i akceptuję zawarte w nim ustalenia.',
    documentSha256: PDF_SHA256,
    challenge: 'kJ8n-jednorazowy-nonce',
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    documentUrl: `/api/tablet/signature-requests/b7e20000-0000-0000-0000-000000000003/document`,
  };
}

interface MockState {
  pendingAvailable: boolean;
  submitBody: Record<string, unknown> | null;
  documentFetches: number;
}

async function installApiMocks(page: Page, mock: MockState) {
  const pending = pendingRequest();

  // Brak WS w testach → aplikacja musi przejść na polling.
  await page.route('**/ws-registry**', (route) => route.abort());

  await page.route('**/api/tablet/pair', (route) =>
    route.fulfill({ status: 201, json: PAIRING }),
  );

  await page.route('**/api/tablet/context', (route) =>
    route.fulfill({
      status: 200,
      json: { tabletId: PAIRING.tabletId, studioId: PAIRING.studioId, deviceName: 'Recepcja 1' },
    }),
  );

  await page.route('**/api/tablet/signature-requests/pending', (route) => {
    if (mock.pendingAvailable) {
      return route.fulfill({ status: 200, json: pending });
    }
    return route.fulfill({ status: 204, body: '' });
  });

  await page.route(`**/api/tablet/signature-requests/${pending.requestId}/document`, (route) => {
    mock.documentFetches += 1;
    return route.fulfill({
      status: 200,
      body: PDF_BYTES,
      headers: {
        'Content-Type': 'application/pdf',
        'X-Document-Sha256': PDF_SHA256,
        'Cache-Control': 'no-store',
      },
    });
  });

  await page.route(`**/api/tablet/signature-requests/${pending.requestId}/submit`, (route) => {
    mock.submitBody = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      status: 200,
      json: {
        requestId: pending.requestId,
        status: 'COMPLETED',
      },
    });
  });

  return pending;
}

test('parowanie → standby → przegląd dokumentu → podpis → podziękowanie → standby', async ({
  page,
}) => {
  const mock: MockState = { pendingAvailable: false, submitBody: null, documentFetches: 0 };
  const pending = await installApiMocks(page, mock);

  await page.goto('/');

  // ── Parowanie kodem 6-cyfrowym (klawiatura ekranowa, auto-advance) ──
  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toBeVisible();
  for (const digit of '483920') {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByPlaceholder('np. Recepcja 1').fill('Recepcja 1');
  await page.getByRole('button', { name: 'Połącz' }).click();

  // ── Tryb czuwania: ciemny zegar ──
  await expect(page.locator('.standby-clock')).toBeVisible();
  await expect(page.locator('.standby-clock')).toHaveText(/^\d{2}:\d{2}$/);

  // ── Żądanie podpisu pojawia się na serwerze; WS nie działa → polling ──
  mock.pendingAvailable = true;
  await expect(page.getByText(pending.documentName)).toBeVisible({ timeout: 20_000 });
  mock.pendingAvailable = false;

  // Dokument wyrenderowany przez pdf.js z tych samych bajtów, które zahashowano.
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(pending.signerName, { exact: false })).toBeVisible();

  // ── Oświadczenie: przycisk nieaktywny do zaznaczenia checkboxa ──
  const proceed = page.getByRole('button', { name: 'Przejdź do podpisu' });
  await expect(proceed).toBeDisabled();
  await page.getByRole('checkbox').check();
  await expect(proceed).toBeEnabled();
  await proceed.click();

  // ── Pole podpisu: rysowanie ──
  const done = page.getByRole('button', { name: 'Gotowe' });
  await expect(done).toBeDisabled();

  const canvas = page.locator('canvas.signature-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Brak pola podpisu');
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(
      box.x + 60 + i * 12,
      box.y + box.height / 2 + Math.sin(i / 2) * 40,
      { steps: 2 },
    );
  }
  await page.mouse.up();

  // ── Weryfikacja przezroczystości (DoD pkt 4): brak białych pikseli tła ──
  const pixels = await canvas.evaluate((element) => {
    const c = element as HTMLCanvasElement;
    const ctx = c.getContext('2d')!;
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let inkedPixels = 0;
    let whitePixels = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        inkedPixels += 1;
        if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) whitePixels += 1;
      }
    }
    const corner = ctx.getImageData(0, 0, 1, 1).data;
    return { inkedPixels, whitePixels, cornerAlpha: corner[3] };
  });
  expect(pixels.cornerAlpha).toBe(0); // tło w pełni przezroczyste
  expect(pixels.whitePixels).toBe(0); // zero białych pikseli
  expect(pixels.inkedPixels).toBeGreaterThan(200); // faktycznie narysowano podpis

  await expect(done).toBeEnabled();
  await done.click();

  // ── Podziękowanie ──
  await expect(page.getByText('Dziękujemy!')).toBeVisible({ timeout: 15_000 });

  // ── Kontrakt submitu: WYSIWYS + anty-replay ──
  expect(mock.documentFetches).toBe(1);
  const body = mock.submitBody;
  if (!body) throw new Error('Submit nie został wysłany');
  expect(body.documentSha256).toBe(PDF_SHA256); // hash policzony na tablecie
  expect(body.challenge).toBe(pending.challenge); // jednorazowy challenge wraca
  expect(body.declarationAccepted).toBe(true);
  expect(typeof body.declarationAcceptedAt).toBe('string');
  expect(Number.isNaN(Date.parse(body.declarationAcceptedAt as string))).toBe(false);

  const signature = body.signatureImageBase64 as string;
  expect(signature).not.toContain('data:'); // bez prefiksu data:image/png;base64,
  const png = Buffer.from(signature, 'base64');
  expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // sygnatura PNG
  // IHDR color type (bajt 25) = 6 → truecolor z kanałem alfa
  expect(png[25]).toBe(6);

  // ── Automatyczny powrót do czuwania po ~4 s ──
  await expect(page.locator('.standby-clock')).toBeVisible({ timeout: 10_000 });
});

test('auto-reconnect: zapisany token łączy bez interakcji (dzień 2)', async ({ page }) => {
  const mock: MockState = { pendingAvailable: false, submitBody: null, documentFetches: 0 };
  await installApiMocks(page, mock);

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: PAIRING.token,
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );

  await page.goto('/');

  // Bez ekranu parowania — od razu tryb czuwania.
  await expect(page.locator('.standby-clock')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toHaveCount(0);
  await expect(page.getByText('Recepcja 1')).toBeVisible();
});

test('zapętlony błąd: reset pracownika czyści dane i wraca do parowania', async ({ page }) => {
  const mock: MockState = { pendingAvailable: true, submitBody: null, documentFetches: 0 };
  const pending = await installApiMocks(page, mock);

  // Serwer zwraca inne bajty niż zapowiedziany hash → twardy błąd integralności.
  // Żądanie na serwerze pozostaje aktywne, więc tablet zapętla się na błędzie.
  await page.route(`**/api/tablet/signature-requests/${pending.requestId}/document`, (route) =>
    route.fulfill({
      status: 200,
      body: Buffer.from('to-nie-jest-oczekiwany-pdf'),
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
    }),
  );

  // Parowanie ustawiamy jednorazowo (nie przez addInitScript, który wstrzykiwałby
  // token ponownie po przeładowaniu wykonywanym przez reset).
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: PAIRING.token,
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );
  await page.reload();

  // ── Ekran błędu ──
  await expect(page.getByRole('heading', { name: 'Wystąpił problem' })).toBeVisible({
    timeout: 20_000,
  });

  // ── OK nie uwalnia z pętli: pending wciąż aktywny → błąd wraca ──
  await page.getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('heading', { name: 'Wystąpił problem' })).toBeVisible({
    timeout: 20_000,
  });

  // ── Reset pracownika: potwierdzenie → czyszczenie → ekran parowania ──
  await page.getByRole('button', { name: 'Dla pracownika: wyczyść dane tabletu' }).click();
  await expect(page.getByRole('heading', { name: 'Wyczyścić dane tabletu?' })).toBeVisible();
  await page.getByRole('button', { name: 'Tak, wyczyść i rozłącz' }).click();

  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toBeVisible({
    timeout: 20_000,
  });
  const stored = await page.evaluate(() => localStorage.getItem('detailboost.tablet.pairing'));
  expect(stored).toBeNull();
});

/** Parowanie zapisywane przy każdej nawigacji — pomocnicze dla testów samo-aktualizacji. */
async function presetPairing(page: Page) {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: PAIRING.token,
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );
}

test('samo-aktualizacja: nieaktualna powłoka przeładowuje się w STANDBY, dokładnie raz', async ({
  page,
}) => {
  const mock: MockState = { pendingAvailable: false, submitBody: null, documentFetches: 0 };
  await installApiMocks(page, mock);

  // Serwer ogłasza inną wersję powłoki niż załadowana (symulacja świeżego deployu).
  await page.route('**/version.json', (route) =>
    route.fulfill({
      status: 200,
      json: { buildId: 'nowa-wersja-e2e' },
      headers: { 'Cache-Control': 'no-store' },
    }),
  );

  await presetPairing(page);
  await page.goto('/');
  await expect(page.locator('.standby-clock')).toBeVisible();

  // Marker w window ginie wyłącznie przy pełnym przeładowaniu strony.
  await page.evaluate(() => {
    (window as { __e2eShellMarker?: boolean }).__e2eShellMarker = true;
  });

  // W STANDBY, po okresie karencji, tablet przeładowuje się sam.
  await page.waitForFunction(
    () => (window as { __e2eShellMarker?: boolean }).__e2eShellMarker === undefined,
    undefined,
    { timeout: 20_000 },
  );
  await expect(page.locator('.standby-clock')).toBeVisible();

  // Guard przed pętlą: wersja docelowa się nie zmieniła, więc drugiej próby nie ma.
  await page.evaluate(() => {
    (window as { __e2eShellMarker?: boolean }).__e2eShellMarker = true;
  });
  await page.waitForTimeout(8_000);
  const markerStillThere = await page.evaluate(
    () => (window as { __e2eShellMarker?: boolean }).__e2eShellMarker === true,
  );
  expect(markerStillThere).toBe(true);
  await expect(page.locator('.standby-clock')).toBeVisible();
});

test('samo-aktualizacja nie przerywa sesji podpisu — reload dopiero po powrocie do STANDBY', async ({
  page,
}) => {
  const mock: MockState = { pendingAvailable: true, submitBody: null, documentFetches: 0 };
  const pending = await installApiMocks(page, mock);

  await page.route(`**/api/tablet/signature-requests/${pending.requestId}/decline`, (route) =>
    route.fulfill({
      status: 200,
      json: {
        requestId: pending.requestId,
        status: 'DECLINED',
      },
    }),
  );

  await page.route('**/version.json', (route) =>
    route.fulfill({
      status: 200,
      json: { buildId: 'nowa-wersja-e2e' },
      headers: { 'Cache-Control': 'no-store' },
    }),
  );

  await presetPairing(page);
  await page.goto('/');

  // Klient przegląda dokument — aktualizacja jest już wykryta, ale czeka.
  await expect(page.getByText(pending.documentName)).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    (window as { __e2eShellMarker?: boolean }).__e2eShellMarker = true;
  });

  // Dłużej niż karencja przeładowania — w trakcie sesji podpisu nic się nie dzieje.
  await page.waitForTimeout(8_000);
  const markerDuringFlow = await page.evaluate(
    () => (window as { __e2eShellMarker?: boolean }).__e2eShellMarker === true,
  );
  expect(markerDuringFlow).toBe(true);
  await expect(page.getByText(pending.documentName)).toBeVisible();

  // Klient odmawia → ekran odmowy → auto-powrót do STANDBY → dopiero teraz reload.
  mock.pendingAvailable = false;
  await page.getByRole('button', { name: 'Odmawiam podpisu' }).click();

  await page.waitForFunction(
    () => (window as { __e2eShellMarker?: boolean }).__e2eShellMarker === undefined,
    undefined,
    { timeout: 30_000 },
  );
  await expect(page.locator('.standby-clock')).toBeVisible();
});

test('odwołany token czyści parowanie i wraca do ekranu parowania', async ({ page }) => {
  await page.route('**/ws-registry**', (route) => route.abort());
  await page.route('**/api/tablet/context', (route) =>
    route.fulfill({
      status: 403,
      json: { error: 'FORBIDDEN', message: 'Token odwołany', timestamp: new Date().toISOString() },
    }),
  );

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: 'revoked-token',
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toBeVisible();
  const stored = await page.evaluate(() => localStorage.getItem('detailboost.tablet.pairing'));
  expect(stored).toBeNull();
});

test('5 tapnięć w logo na ekranie czuwania rozparowuje tablet po potwierdzeniu', async ({
  page,
}) => {
  const mock: MockState = { pendingAvailable: false, submitBody: null, documentFetches: 0 };
  await installApiMocks(page, mock);

  // Parowanie zasiane JEDNORAZOWO (nie przez addInitScript — ten wykonuje
  // się po każdej nawigacji i cofnąłby czyszczenie zrobione przez reset).
  await page.goto('/');
  await page.evaluate(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: PAIRING.token,
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );
  await page.reload();
  await expect(page.locator('.standby-clock')).toBeVisible();

  const logo = page.locator('.standby-logo');

  // Za mało tapnięć — dialog się nie pojawia.
  for (let i = 0; i < 4; i++) await logo.click();
  await expect(page.locator('.reset-dialog')).toHaveCount(0);
  // Odczekaj wygaśnięcie okna zliczania, żeby licznik ruszał od zera.
  await page.waitForTimeout(3_200);

  // Komplet tapnięć → dialog; „Anuluj" zamyka bez czyszczenia.
  for (let i = 0; i < 5; i++) await logo.click();
  await expect(page.getByRole('heading', { name: 'Rozparować tablet?' })).toBeVisible();
  await page.getByRole('button', { name: 'Anuluj' }).click();
  await expect(page.locator('.reset-dialog')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('detailboost.tablet.pairing'))).not.toBeNull();

  // Potwierdzenie czyści parowanie i wraca do ekranu parowania.
  for (let i = 0; i < 5; i++) await logo.click();
  await page.getByRole('button', { name: 'Wyczyść i rozparuj' }).click();
  await expect(page.getByRole('heading', { name: 'Sparuj tablet' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('detailboost.tablet.pairing'))).toBeNull();
});

/* ─── Kolejka wielodokumentowa: prefetch + auto-przejście po podpisie ───────── */

/** Rysuje podpis i klika „Gotowe" — wspólne dla obu dokumentów w kolejce. */
async function signCurrentDocument(page: Page) {
  await expect(page.locator('.pdf-page canvas').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Przejdź do podpisu' }).click();

  const canvas = page.locator('canvas.signature-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('Brak pola podpisu');
  await page.mouse.move(box.x + 60, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 24; i++) {
    await page.mouse.move(box.x + 60 + i * 12, box.y + box.height / 2 + Math.sin(i / 2) * 40, {
      steps: 2,
    });
  }
  await page.mouse.up();
  await page.getByRole('button', { name: 'Gotowe' }).click();
}

test('kolejka dwóch dokumentów: drugi prefetchowany w tle i wyświetlony zaraz po podpisie pierwszego', async ({
  page,
}) => {
  const first = { ...pendingRequest(), requestId: 'aaaa0000-0000-0000-0000-000000000001' };
  const second = {
    ...pendingRequest(),
    requestId: 'aaaa0000-0000-0000-0000-000000000002',
    documentName: 'Zgody marketingowe',
    challenge: 'nonce-doc-2',
  };
  first.documentUrl = `/api/tablet/signature-requests/${first.requestId}/document`;
  second.documentUrl = `/api/tablet/signature-requests/${second.requestId}/document`;

  // Kolejka na serwerze — submit dokumentu zdejmuje go z niej, jak w realnym API.
  const queue = [first, second];
  const documentFetches: Array<{ requestId: string; prefetch: boolean }> = [];
  const displayedCalls: string[] = [];

  await page.route('**/ws-registry**', (route) => route.abort());
  await page.route('**/api/tablet/context', (route) =>
    route.fulfill({
      status: 200,
      json: { tabletId: PAIRING.tabletId, studioId: PAIRING.studioId, deviceName: 'Recepcja 1' },
    }),
  );
  await page.route('**/api/tablet/signature-requests/queue', (route) =>
    route.fulfill({ status: 200, json: { requests: queue } }),
  );
  // Stary endpoint nie może być w tym teście używany — kolejka jest dostępna.
  await page.route('**/api/tablet/signature-requests/pending', (route) =>
    route.fulfill({ status: 500, json: { message: 'pending nie powinien być wołany' } }),
  );

  for (const request of [first, second]) {
    await page.route(`**/api/tablet/signature-requests/${request.requestId}/document**`, (route) => {
      documentFetches.push({
        requestId: request.requestId,
        prefetch: new URL(route.request().url()).searchParams.get('prefetch') === 'true',
      });
      return route.fulfill({
        status: 200,
        body: PDF_BYTES,
        headers: {
          'Content-Type': 'application/pdf',
          'X-Document-Sha256': PDF_SHA256,
          'Cache-Control': 'no-store',
        },
      });
    });
    await page.route(`**/api/tablet/signature-requests/${request.requestId}/displayed`, (route) => {
      displayedCalls.push(request.requestId);
      return route.fulfill({ status: 204, body: '' });
    });
    await page.route(`**/api/tablet/signature-requests/${request.requestId}/submit`, (route) => {
      const index = queue.findIndex((entry) => entry.requestId === request.requestId);
      if (index >= 0) queue.splice(index, 1);
      return route.fulfill({
        status: 200,
        json: { requestId: request.requestId, status: 'COMPLETED' },
      });
    });
  }

  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    [
      'detailboost.tablet.pairing',
      JSON.stringify({
        token: PAIRING.token,
        tabletId: PAIRING.tabletId,
        studioId: PAIRING.studioId,
        deviceName: 'Recepcja 1',
      }),
    ] as const,
  );

  await page.goto('/');

  // ── Dokument 1 z kolejki wchodzi ze STANDBY ──
  await expect(page.getByText(first.documentName)).toBeVisible({ timeout: 20_000 });
  await signCurrentDocument(page);

  // ── Dokument 2 pojawia się SAM, bez udziału pracownika ──
  // (miga potwierdzenie, po NEXT_DOCUMENT_MS wchodzi kolejny przegląd)
  await expect(page.getByText(second.documentName)).toBeVisible({ timeout: 15_000 });

  // Prefetch zrobił swoje: bajty dokumentu 2 zeszły w tle podczas czytania
  // pierwszego, a wyświetlenie zostało zgłoszone przez /displayed.
  expect(documentFetches).toContainEqual({ requestId: second.requestId, prefetch: true });
  expect(displayedCalls).toContain(second.requestId);
  // Dokument 2 nie był pobierany drugi raz zwykłą ścieżką.
  expect(
    documentFetches.filter((fetch) => fetch.requestId === second.requestId && !fetch.prefetch),
  ).toHaveLength(0);

  await signCurrentDocument(page);

  // ── Kolejka pusta → powrót do czuwania ──
  await expect(page.locator('.standby-clock')).toBeVisible({ timeout: 10_000 });
});
