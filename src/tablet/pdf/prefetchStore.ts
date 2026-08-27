/**
 * Bufor dokumentów CZEKAJĄCYCH w kolejce podpisów — pobranych w tle, zanim
 * klient skończy czytać bieżący dokument, żeby następny wyświetlił się bez
 * rundy po sieci.
 *
 * Celowo poza stanem Reacta i celowo osobno od [DocumentStore]: tamten trzyma
 * dokument WYŚWIETLONY i podlega twardemu wymogowi eIDAS „po wyjściu
 * z przepływu podpisu w pamięci nie może zostać bufor PDF". Prefetch trzyma
 * dokumenty, które dopiero CZEKAJĄ na wyświetlenie — wolno im przeżyć ekran
 * podziękowania między jednym a drugim podpisem, bo inaczej cała optymalizacja
 * nie istnieje. Obowiązują za to te same zasady higieny: bajty są zerowane
 * przy każdym usunięciu, a magazyn jest czyszczony w całości, gdy kolejka
 * znika (pusta odpowiedź serwera, anulowanie, utrata parowania, błąd).
 */
export class PrefetchStore {
  private buffers = new Map<string, ArrayBuffer>();

  /** Zapamiętaj bajty żądania. Nadpisanie zeruje poprzedni bufor. */
  set(requestId: string, buffer: ArrayBuffer): void {
    this.drop(requestId);
    this.buffers.set(requestId, buffer);
  }

  has(requestId: string): boolean {
    return this.buffers.has(requestId);
  }

  /**
   * Wyjmij bufor — właściciel przejmuje odpowiedzialność za jego zniszczenie
   * (przejmuje go [DocumentStore], który zeruje bajty przy wipe).
   */
  take(requestId: string): ArrayBuffer | null {
    const buffer = this.buffers.get(requestId) ?? null;
    this.buffers.delete(requestId);
    return buffer;
  }

  /** Usuń jedno żądanie, zerując bajty. Idempotentne. */
  drop(requestId: string): void {
    const buffer = this.buffers.get(requestId);
    if (buffer) {
      zero(buffer);
      this.buffers.delete(requestId);
    }
  }

  /** Zostaw wyłącznie żądania z podanej listy — reszta znika (z zerowaniem). */
  retainOnly(requestIds: ReadonlySet<string>): void {
    for (const id of [...this.buffers.keys()]) {
      if (!requestIds.has(id)) this.drop(id);
    }
  }

  /** Wyczyść wszystko. Idempotentne. */
  wipe(): void {
    for (const id of [...this.buffers.keys()]) this.drop(id);
  }
}

function zero(buffer: ArrayBuffer): void {
  try {
    if (buffer.byteLength > 0) new Uint8Array(buffer).fill(0);
  } catch {
    // bufor odłączony (transfer do workera) — nie ma czego zerować
  }
}
