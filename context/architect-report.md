---
title: "Raport architektoniczny — Moduł 4 (10xArchitect)"
created: 2026-07-22
type: architecture-summary
---

# Raport architektoniczny — Moduł 4 (10xArchitect)

> Two-pager zsyntetyzowany wyłącznie z artefaktów L2–L5. Artefakty pochodzą z **dwóch różnych repozytoriów**.
> Twierdzenia strukturalne oparte na artefaktach, nie na pamięci o kodzie.

---

## 1. Opisane projekty

| Repo | Stack | Skala (orientacyjnie) | Artefakty |
|---|---|---|---|
| **Mattermost** | Backend Go (`server/`) + webapp React/TypeScript (`webapp/`) + E2E (Cypress→Playwright) | Duże monorepo: 4 879 modułów TS, 22 200 krawędzi importów; ~7 423 zmiany w Q2 2026; 151 plików w `package app` | **L2** mapa repo, **L3** research przepływu postów, **L4** plan refaktoru broadcast hooków |
| **10xCards** | Astro 6 SSR + React 19 islands + Supabase (PostgreSQL) + Cloudflare Workers; `ts-fsrs`, Zod | Mały: kilkanaście serwisów/schematów, 1 tabela domenowa (`flashcards`), 2 migracje | **L5** notatki DDD (domain distillation, invariant refactor, ACL) |

---

## 2. Mapa projektu (L2 — Mattermost)

1. **Dwa centra ciężkości**: `server/channels/app` (1 886 zmian/rok, core logika) i `webapp/.../admin_console` (1 645 zmian/rok, +875 w Q2 2026).
2. **Granice warstw czyste, dług wewnątrzwarstwowy**: 0 naruszeń granic w grafie importów, ale **121 cykli zależności** w webapp (38 w samym `admin_console`).
3. **Strefy ryzyka**: `admin_definition.tsx` (monolit, 96 importów), cykliczny klaster akcji `mattermost-redux` (`posts↔users↔teams↔threads↔channels`), `store.go` (73 zmiany/rok — wąskie gardło persystencji).
4. **Entry pointy / kolejność czytania**: kontrakt → implementacja, dół stacku → góra: `config.go` ↔ `config.ts`, `store.go`, `app/post.go`, `client4.ts`, `mattermost-redux/actions/posts.ts`.
5. **Najważniejsze unknowns**: **backend Go nie był analizowany grafem importów** — wszystkie sprzężenia backendu pochodzą wyłącznie z historii git (co-change ≠ import). Okno: tylko 07.2025–07.2026.

---

## 3. Analiza ficzera (L3 — Mattermost)

**Badany przepływ**: zapis posta (`user → Enter → DB → WebSocket broadcast`). Wybrany, bo trafia w strefę ryzyka #1 z mapy — `server/channels/app/post.go` (core delivery pipeline) i cykliczny klaster `mattermost-redux`.

**Feature overview**: Input z UI (`use_submit.tsx`) przechodzi 21-krokowym, ściśle warstwowym pipeline'em: Redux thunk (optymistyczny update) → `Client4` REST → `api4/post.go` → `app/post.go` (walidacja, plugin hooki, `Store().Post().Save()`) → PostgreSQL. Stan zmienia się w transakcji DB (`INSERT INTO Posts` + threads/priority + `UPDATE Channels`). Zwrotnie: WebSocket broadcast do wszystkich subskrybentów + trójfazowy batch dispatch do Redux (pending → real id).

**Technical debt (2–3 najważniejsze ryzyka):**
- **Luki testowe w broadcast hookach (blast radius bezpieczeństwa)**: `setupBroadcastHookForAbacFiles` i `processBroadcastHookForBurnOnRead` **nie mają testu na żadnej warstwie** — regresja cicho ujawnia metadane plików / treść burn-on-read nieupoważnionym odbiorcom.
- **Kruche sprzężenie interfejsu store**: zmiana `PostStore` (`store.go:L386`) wymusza synchroniczną regenerację `retrylayer.go` + mocków (`make store-layers`, `store-mocks`) — pominięcie łamie build; potwierdzone ast-grepem (`ast_grep_verified: 2026-07-22`, grep call sites 5× w `package app`).
- **Brak E2E dla podstawowego flow** send-and-receive: regresja w `handlePostEvents`/`publishWebsocketEventForPost` (post zapisany, ale WS event niewysłany) nie zostałaby wykryta przez żaden test przeglądarki.

---

## 4. Plan refaktoryzacji (L4 — Mattermost)

**Co refaktoryzowane**: dwa mechaniczne przeniesienia plików wewnątrz `package app`, bez zmiany API/interfejsów/zachowania. Docelowo: `web_broadcast_hooks.go` skupia całą logikę hooków (interfejs + `Process()` + 4 funkcje setup), nowy `post_broadcast.go` zawiera `publishWebsocketEventForPost`, a `post.go` kurczy się o ~130 linii. Dodatkowo domknięcie luki ABAC testem pozytywnej ścieżki.

**Czego świadomie NIE robimy**: zmiany sygnatur/receiverów/interfejsu `BroadcastHook`; dekompozycji `CreatePost` (zbyt duży blast radius); rozplątywania sprzężenia `notification.go ↔ post.go`; testów ścieżek błędów i rozjazdów typów TS/Go zidentyfikowanych jako NOT-classified.

**Fazy + weryfikacja:**
- Faza 1, Commit 1 — przenieś prostą parę setupów + test `..._PositivePath` — **auto** (`go build`, `go test ./channels/app/...`).
- Faza 1, Commit 2 — przenieś złożoną parę (permalink, burn-on-read) + importy `net/http`, `sqlstore` — **auto** build/test, **ręcznie** ABAC/permalink/burn-on-read WS.
- Faza 2 — wyodrębnij `publishWebsocketEventForPost` do `post_broadcast.go` — **auto** (`-run TestWebsocket`, `TestSendNotifications`), **ręcznie** real-time delivery, shared-channel, content-flagging, acknowledgements.

---

## 5. Domena wg DDD (L5 — 10xCards)

**Ubiquitous language (kluczowe pojęcia + rozjazdy model-vs-kod):**
- **Flashcard** — dwustronna karta (`front`≤1000, `back`≤5000); w kodzie to **gołe DTO bez metod** (rozjazd: brak agregatu).
- **FlashcardSource** (`manual`/`ai_full`/`ai_edited`) — jedyny instrument pomiaru KPI; semantyka egzekwowana **wyłącznie po stronie klienta** (rozjazd krytyczny).
- **Proposal** / **Source Text** — efemeryczne, nie persystowane; brak endpointu `reject` (PRD FR-006 mówi o odrzucaniu — serwer go nie widzi).
- **Rating** — PRD mówi domenowo „Recall Rating", kod używa `Rating` z `ts-fsrs` (Again/Hard/Good/Easy = 1/2/3/4).
- **Practice Mode** — istnieje w kodzie, **nieobecny w PRD** (niezadokumentowana koncepcja domenowa).

**Niezmiennik #1**: **I3 — `source` musi odzwierciedlać rzeczywistą ścieżkę tworzenia** (jedyny instrument pomiaru „75% kart tworzonych przez AI"). Należy do agregatu **Flashcard** — dziś naruszalny, bo semantykę oblicza tylko `getSourceForProposal()` w `GenerateFlashcards.tsx:78-83`; serwer przyjmuje dowolną wartość enum. Projekt naprawy: fabryka domenowa (`createManual` / `acceptProposal`) obliczająca `source` serwerowo.

**Anti-Corruption Layer**: przecieka **`ts-fsrs`** — przez **5 warstw** (schema API, service, typy domenowe, UI implicite, DB schema). Wire protocol API (`rating: 1|2|3|4`) i UI (`RatingValue = 1|2|3|4`) kodują wewnętrzny enum biblioteki bez traceability. Naprawa: port `SchedulerPort` + `FsrsAdapter` jako jedyne miejsce importu (kryterium: `grep "from \"ts-fsrs\""` zwraca tylko `fsrs.adapter.ts`).

---

## 6. Decyzje, które należą do mnie

AI zmapowało teren, wytrasowało 21-krokowy przepływ postów i wskazało luki testowe oraz przecieki zależności — ale wybory kierunkowe pozostały po mojej stronie. **Ja rozstrzygnąłem, że badam akurat przepływ zapisu posta** (a nie `admin_console`), bo to najgęstszy węzeł delivery i najwyższy blast radius. **Ja zdecydowałem o wąskim zakresie planu L4** — czyste przeniesienia plików zamiast kuszącej dekompozycji `CreatePost` — świadomie odkładając większy dług, by ograniczyć ryzyko. **Ja wybrałem niezmiennik I3 i zależność `ts-fsrs`** jako #1 w L5, ważąc rdzenność względem słabości egzekucji, mimo że AI podało kilku równorzędnych kandydatów. AI dostarczyło dowody (ast-grep, graf importów, cytaty `plik:linia`); priorytety i granice „czego NIE robimy" są moje.

---

> **Uwagi o kompletności**: wszystkie sześć sekcji ma pokrycie w artefaktach. BRAK artefaktu L2/L3/L4 dla 10xCards oraz BRAK artefaktu L5 dla Mattermost — analiza domenowa (L5) i analiza kodu (L2–L4) pochodzą z rozłącznych projektów i nie były ze sobą krzyżowane.
