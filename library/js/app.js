/*
 * «Переплёт» — каталог, личная полка, статистика и рекомендации.
 * Полка, фильтры и выбранная вкладка хранятся в localStorage.
 * Полка — объект «id книги → запись», поэтому одна книга не может попасть на неё дважды.
 */
(function () {
  'use strict';

  const BOOKS = Array.isArray(window.LIBRARY_BOOKS) ? window.LIBRARY_BOOKS : [];
  const byId = new Map(BOOKS.map((book) => [book.id, book]));
  const collator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true });

  const PAGE_SIZE = 12;
  const NOTE_MAX = 2000;
  const KEYS = {
    shelf: 'pereplet.shelf.v1',
    filters: 'pereplet.filters.v1',
    ui: 'pereplet.ui.v1',
  };

  const STATUS = {
    want: { label: 'Хочу прочитать' },
    reading: { label: 'Читаю' },
    read: { label: 'Прочитано' },
  };
  const STATUS_ORDER = ['want', 'reading', 'read'];
  const RATING_WORDS = ['', 'плохо', 'так себе', 'неплохо', 'хорошо', 'отлично'];
  const BOOK_FORMS = ['книга', 'книги', 'книг'];

  const GENRES = [...new Set(BOOKS.map((book) => book.genre))].sort(collator.compare);
  const YEAR_MIN = Math.min(...BOOKS.map((book) => book.year));
  const YEAR_MAX = Math.max(...BOOKS.map((book) => book.year));
  const YEAR_PRESETS = [
    { id: 'old', label: 'До 1900', from: '', to: 1899 },
    { id: 'early', label: '1900–1959', from: 1900, to: 1959 },
    { id: 'late', label: '1960–1999', from: 1960, to: 1999 },
    { id: 'new', label: 'С 2000', from: 2000, to: '' },
  ];

  const sortTitle = (book) => book.title.replace(/^[«"]/, '');
  const SORTS = {
    'title-asc': { label: 'По названию, А → Я', compare: (a, b) => collator.compare(sortTitle(a), sortTitle(b)) },
    'title-desc': { label: 'По названию, Я → А', compare: (a, b) => collator.compare(sortTitle(b), sortTitle(a)) },
    'year-desc': { label: 'Сначала новые', compare: (a, b) => b.year - a.year || collator.compare(sortTitle(a), sortTitle(b)) },
    'year-asc': { label: 'Сначала старые', compare: (a, b) => a.year - b.year || collator.compare(sortTitle(a), sortTitle(b)) },
  };
  const DEFAULT_FILTERS = { q: '', genre: '', yearFrom: '', yearTo: '', sort: 'title-asc', shown: PAGE_SIZE };

  // Пример заполнения полки — только по кнопке «Заполнить примером».
  const DEMO_SHELF = [
    { id: 9, status: 'read', rating: 5, daysAgo: 64, note: 'Пример заметки. Перечитать сцену первого похода в Зону: напряжение держится на деталях, а не на событиях.' },
    { id: 10, status: 'read', rating: 4, daysAgo: 41 },
    { id: 13, status: 'read', rating: 5, daysAgo: 30, note: 'Пример заметки. Сравнить с «Мы» Замятина: у Оруэлла страх, у Замятина — математика.' },
    { id: 16, status: 'read', rating: 4, daysAgo: 12 },
    { id: 17, status: 'read', rating: 4, daysAgo: 6 },
    { id: 2, status: 'reading', daysAgo: 3 },
    { id: 21, status: 'want', daysAgo: 2 },
    { id: 30, status: 'want', daysAgo: 1 },
  ];

  const ICON = {
    star: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.6l2.84 5.98 6.56.8-4.84 4.52 1.25 6.5L12 17.2l-5.81 3.2 1.25-6.5L2.6 9.38l6.56-.8z"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    shelf: '<svg viewBox="0 0 120 64" aria-hidden="true" focusable="false"><rect x="18" y="14" width="12" height="40" rx="1.5" class="i-wine"/><rect x="32" y="8" width="11" height="46" rx="1.5" class="i-ink"/><rect x="45" y="18" width="10" height="36" rx="1.5" class="i-soft"/><rect x="66" y="12" width="11" height="42" rx="1.5" class="i-wine" transform="rotate(14 72 54)"/><rect x="8" y="54" width="104" height="4" rx="2" class="i-ink"/></svg>',
  };

  /* ---------- Хранилище ---------- */

  let storageWarned = false;
  const storage = {
    get(key) {
      try {
        const raw = window.localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch (err) {
        if (!storageWarned) {
          storageWarned = true;
          toast('Браузер не разрешает сохранять данные: изменения пропадут после перезагрузки.');
        }
        return false;
      }
    },
  };

  const toNumber = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null);
  const toYear = (value) => (/^\d{1,4}$/.test(String(value)) ? Number(value) : '');

  function loadShelf() {
    const data = storage.get(KEYS.shelf);
    const items = {};
    if (!data || typeof data.items !== 'object' || data.items === null) return items;
    Object.keys(data.items).forEach((key) => {
      const id = Number(key);
      const entry = data.items[key];
      if (!byId.has(id) || !entry || !STATUS[entry.status]) return;
      const now = Date.now();
      const rating = Number(entry.rating);
      items[id] = {
        status: entry.status,
        rating: rating >= 1 && rating <= 5 ? Math.round(rating) : 0,
        note: typeof entry.note === 'string' ? entry.note.slice(0, NOTE_MAX) : '',
        addedAt: toNumber(entry.addedAt) || now,
        updatedAt: toNumber(entry.updatedAt) || toNumber(entry.addedAt) || now,
        finishedAt: entry.status === 'read' ? toNumber(entry.finishedAt) || toNumber(entry.updatedAt) || now : null,
        noteUpdatedAt: toNumber(entry.noteUpdatedAt),
      };
    });
    return items;
  }

  function loadFilters() {
    const saved = storage.get(KEYS.filters) || {};
    const shown = Number(saved.shown);
    return {
      q: typeof saved.q === 'string' ? saved.q.slice(0, 100) : '',
      genre: GENRES.includes(saved.genre) ? saved.genre : '',
      yearFrom: toYear(saved.yearFrom),
      yearTo: toYear(saved.yearTo),
      sort: SORTS[saved.sort] ? saved.sort : DEFAULT_FILTERS.sort,
      shown: shown >= PAGE_SIZE && shown <= BOOKS.length + PAGE_SIZE ? Math.round(shown) : PAGE_SIZE,
    };
  }

  function loadUi() {
    const saved = storage.get(KEYS.ui) || {};
    return { shelfTab: saved.shelfTab === 'all' || STATUS[saved.shelfTab] ? saved.shelfTab : 'all' };
  }

  const saveShelf = () => storage.set(KEYS.shelf, { version: 1, items: shelf });
  const saveFilters = () => storage.set(KEYS.filters, filters);
  const saveUi = () => storage.set(KEYS.ui, ui);

  /* ---------- Состояние ---------- */

  let shelf = loadShelf();
  const filters = loadFilters();
  const ui = loadUi();
  const drafts = {};
  const noteTimers = {};
  let route = parseRoute(window.location.hash);
  let catalogScroll = 0;
  let main = null;
  let toastTimer = null;
  let toastAction = null;
  let catalogTimer = null;

  /* ---------- Утилиты ---------- */

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (value) => String(value).replace(/[&<>"']/g, (ch) => ESC_MAP[ch]);
  const norm = (value) => String(value).toLowerCase().replace(/ё/g, 'е').replace(/[«»"„“]/g, '').replace(/\s+/g, ' ').trim();

  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }

  const fmtNumber = new Intl.NumberFormat('ru-RU');
  const fmtRating = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const fmtDate = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  const fmtDateTime = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const countBooks = (n) => `${fmtNumber.format(n)} ${plural(n, BOOK_FORMS)}`;

  function excerpt(text, max) {
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max).replace(/\s+\S*$/, '')}…` : clean;
  }

  /* ---------- Операции с полкой ---------- */

  function shelfEntries() {
    return Object.keys(shelf)
      .map((key) => Object.assign({ book: byId.get(Number(key)) }, shelf[key]))
      .filter((entry) => entry.book)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function commit(fallbackId) {
    saveShelf();
    refresh(fallbackId);
  }

  function addToShelf(id, status) {
    const book = byId.get(id);
    if (!book || !STATUS[status]) return;
    if (shelf[id]) {
      if (shelf[id].status === status) toast(`«${book.title}» уже на вашей полке.`);
      else setStatus(id, status);
      return;
    }
    const now = Date.now();
    shelf[id] = { status, rating: 0, note: '', addedAt: now, updatedAt: now, finishedAt: status === 'read' ? now : null, noteUpdatedAt: null };
    commit(route.view === 'book' ? `p-st-${id}-${status}` : `c-title-${id}`);
    const extra = status === 'read' ? ' Статистика и рекомендации обновлены.' : '';
    toast(
      `«${book.title}» на полке: ${STATUS[status].label.toLowerCase()}.${extra}`,
      route.view === 'shelf' ? null : { label: 'Открыть полку', run: () => navigate('#shelf') }
    );
  }

  function setStatus(id, status) {
    const entry = shelf[id];
    const book = byId.get(id);
    if (!entry || !book || !STATUS[status] || entry.status === status) return;
    const touchesRead = entry.status === 'read' || status === 'read';
    const now = Date.now();
    entry.status = status;
    entry.updatedAt = now;
    entry.finishedAt = status === 'read' ? now : null;
    commit();
    toast(`«${book.title}»: ${STATUS[status].label.toLowerCase()}.${touchesRead ? ' Статистика и рекомендации обновлены.' : ''}`);
  }

  function setRating(id, value) {
    const entry = shelf[id];
    if (!entry || !(value >= 1 && value <= 5)) return;
    entry.rating = entry.rating === value ? 0 : value;
    entry.updatedAt = Date.now();
    commit();
  }

  function removeFromShelf(id) {
    const entry = shelf[id];
    const book = byId.get(id);
    if (!entry || !book) return;
    clearTimeout(noteTimers[id]);
    if (id in drafts) {
      entry.note = drafts[id].slice(0, NOTE_MAX);
      delete drafts[id];
    }
    const snapshot = Object.assign({}, entry);
    delete shelf[id];
    commit(route.view === 'book' ? `p-add-${id}-want` : null);
    toast(`«${book.title}» убрана с полки.`, {
      label: 'Вернуть',
      run: () => {
        if (shelf[id]) return;
        shelf[id] = snapshot;
        commit();
        toast(`«${book.title}» снова на полке.`);
      },
    });
  }

  function clearShelf() {
    const count = Object.keys(shelf).length;
    if (!count) return;
    Object.keys(noteTimers).forEach((id) => clearTimeout(noteTimers[id]));
    Object.keys(drafts).forEach((id) => delete drafts[id]);
    const snapshot = JSON.parse(JSON.stringify(shelf));
    shelf = {};
    commit();
    toast(`Полка очищена: ${countBooks(count)}.`, {
      label: 'Вернуть',
      run: () => {
        shelf = Object.assign(snapshot, shelf);
        commit();
        toast('Полка восстановлена.');
      },
    });
  }

  function fillDemo() {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    DEMO_SHELF.forEach((item) => {
      if (shelf[item.id] || !byId.has(item.id)) return;
      const at = now - item.daysAgo * day;
      shelf[item.id] = {
        status: item.status,
        rating: item.rating || 0,
        note: item.note || '',
        addedAt: at - 20 * day,
        updatedAt: at,
        finishedAt: item.status === 'read' ? at : null,
        noteUpdatedAt: item.note ? at : null,
      };
    });
    commit();
    toast('Полка заполнена примером. Меняйте статусы и оценки — статистика и рекомендации пересчитаются сразу.');
  }

  /* ---------- Заметки ---------- */

  function noteText(id) {
    return id in drafts ? drafts[id] : shelf[id] ? shelf[id].note : '';
  }

  function updateNoteMeta(id) {
    const entry = shelf[id];
    const meta = document.getElementById(`note-meta-${id}`);
    const counter = document.getElementById(`note-count-${id}`);
    if (!entry) return;
    if (counter) counter.textContent = `${noteText(id).length} / ${NOTE_MAX}`;
    if (!meta) return;
    if (id in drafts && drafts[id] !== entry.note) {
      meta.textContent = 'Есть несохранённые изменения';
      meta.dataset.state = 'dirty';
    } else if (entry.noteUpdatedAt) {
      meta.textContent = `Сохранено ${fmtDateTime.format(entry.noteUpdatedAt)}`;
      meta.dataset.state = 'saved';
    } else {
      meta.textContent = 'Заметка сохраняется автоматически';
      meta.dataset.state = '';
    }
  }

  function commitNote(id, announce) {
    clearTimeout(noteTimers[id]);
    const entry = shelf[id];
    if (!entry) return;
    if (id in drafts) {
      const text = drafts[id].slice(0, NOTE_MAX);
      delete drafts[id];
      if (text !== entry.note) {
        entry.note = text;
        entry.noteUpdatedAt = Date.now();
        saveShelf();
      }
    }
    updateNoteMeta(id);
    if (announce) toast('Заметка сохранена.');
  }

  /* ---------- Каталог: фильтры ---------- */

  function yearBounds() {
    let from = filters.yearFrom === '' ? -Infinity : filters.yearFrom;
    let to = filters.yearTo === '' ? Infinity : filters.yearTo;
    if (from > to) [from, to] = [to, from];
    return { from, to };
  }

  function matchesQuery(book, q) {
    return !q || norm(book.title).includes(q) || norm(book.author).includes(q);
  }

  function getFiltered() {
    const q = norm(filters.q);
    const { from, to } = yearBounds();
    return BOOKS.filter(
      (book) => matchesQuery(book, q) && (!filters.genre || book.genre === filters.genre) && book.year >= from && book.year <= to
    ).sort(SORTS[filters.sort].compare);
  }

  function genreCounts() {
    const q = norm(filters.q);
    const { from, to } = yearBounds();
    const counts = { total: 0 };
    BOOKS.forEach((book) => {
      if (!matchesQuery(book, q) || book.year < from || book.year > to) return;
      counts.total += 1;
      counts[book.genre] = (counts[book.genre] || 0) + 1;
    });
    return counts;
  }

  function yearLabel() {
    const { from, to } = yearBounds();
    if (from === -Infinity && to === Infinity) return '';
    if (from === -Infinity) return `по ${to}`;
    if (to === Infinity) return `с ${from}`;
    return from === to ? `${from}` : `${from}–${to}`;
  }

  function setFilters(patch) {
    Object.assign(filters, patch);
    filters.shown = PAGE_SIZE;
    saveFilters();
    if (route.view === 'catalog') preserveFocus(updateCatalogResults);
  }

  function syncControls() {
    const search = document.getElementById('search');
    const from = document.getElementById('year-from');
    const to = document.getElementById('year-to');
    const sort = document.getElementById('sort');
    if (search) search.value = filters.q;
    if (from) from.value = filters.yearFrom;
    if (to) to.value = filters.yearTo;
    if (sort) sort.value = filters.sort;
  }

  function scheduleCatalogUpdate(delay) {
    clearTimeout(catalogTimer);
    catalogTimer = setTimeout(() => {
      saveFilters();
      if (route.view === 'catalog') preserveFocus(updateCatalogResults);
    }, delay);
  }

  /* ---------- Статистика и рекомендации ---------- */

  function getStats() {
    const entries = shelfEntries();
    const counts = { want: 0, reading: 0, read: 0 };
    entries.forEach((entry) => {
      counts[entry.status] += 1;
    });
    const read = entries.filter((entry) => entry.status === 'read');
    const rated = read.filter((entry) => entry.rating);
    const year = new Date().getFullYear();
    return {
      total: entries.length,
      counts,
      pages: read.reduce((sum, entry) => sum + entry.book.pages, 0),
      avg: rated.length ? rated.reduce((sum, entry) => sum + entry.rating, 0) / rated.length : null,
      rated: rated.length,
      thisYear: read.filter((entry) => entry.finishedAt && new Date(entry.finishedAt).getFullYear() === year).length,
      year,
    };
  }

  // Жанры прочитанных книг: сначала по количеству, при равенстве — по средней оценке и свежести.
  function getTaste() {
    const groups = new Map();
    Object.keys(shelf).forEach((key) => {
      const entry = shelf[key];
      const book = byId.get(Number(key));
      if (!book || entry.status !== 'read') return;
      let group = groups.get(book.genre);
      if (!group) {
        group = { genre: book.genre, count: 0, ratingSum: 0, rated: 0, last: 0, yearSum: 0 };
        groups.set(book.genre, group);
      }
      group.count += 1;
      group.yearSum += book.year;
      group.last = Math.max(group.last, entry.finishedAt || 0);
      if (entry.rating) {
        group.ratingSum += entry.rating;
        group.rated += 1;
      }
    });
    const genres = [...groups.values()]
      .map((group) => Object.assign(group, { avg: group.rated ? group.ratingSum / group.rated : null, avgYear: group.yearSum / group.count }))
      .sort((a, b) => b.count - a.count || (b.avg || 0) - (a.avg || 0) || b.last - a.last || collator.compare(a.genre, b.genre));
    return { readCount: genres.reduce((sum, group) => sum + group.count, 0), genres, top: genres.slice(0, 3) };
  }

  // Книги любимых жанров, которых ещё нет на полке. Жанры чередуются, внутри жанра —
  // книги, ближе всего по времени к уже прочитанным.
  function getRecommendations(taste, limit) {
    const queues = taste.top.map((group, rank) =>
      BOOKS.filter((book) => book.genre === group.genre && !shelf[book.id])
        .sort((a, b) => Math.abs(a.year - group.avgYear) - Math.abs(b.year - group.avgYear) || collator.compare(a.title, b.title))
        .map((book) => ({ book, group, rank }))
    );
    const result = [];
    while (result.length < limit && queues.some((queue) => queue.length)) {
      queues.forEach((queue) => {
        if (queue.length && result.length < limit) result.push(queue.shift());
      });
    }
    return result;
  }

  const recReason = (rec) => `Вы прочитали ${rec.group.count} ${plural(rec.group.count, ['книгу', 'книги', 'книг'])} в этом жанре`;

  /* ---------- Шаблоны ---------- */

  function coverHTML(book, extraClass) {
    const c = book.cover;
    const classes = ['cover', `cover--${c.layout}`];
    if (c.ring) classes.push('cover--ring');
    if (extraClass) classes.push(extraClass);
    // Кегль названия подбирается по самому длинному слову, чтобы оно влезало в строку.
    const room = { frame: 62, spine: 58 }[c.layout] || 74;
    const longest = Math.max(...book.title.split(/[\s-]+/).map((word) => word.length));
    let size = Math.min(11, room / (longest * 0.68));
    if (book.title.length > 26) size = Math.min(size, 8.2);
    let style = `--cv-bg:${c.bg};--cv-ink:${c.ink};--cv-acc:${c.acc};--cv-title:${size.toFixed(2)}cqi`;
    if (c.vars) style += `;${c.vars}`;
    let art = '';
    if (c.layout === 'type') {
      const glyph = c.glyph || book.title.charAt(0);
      const wide = glyph.length >= 5 ? ' cover__glyph--xwide' : glyph.length >= 3 ? ' cover__glyph--wide' : '';
      art = `<span class="cover__glyph${wide}">${esc(glyph)}</span>`;
    }
    return `<div class="${classes.join(' ')}" style="${style}" aria-hidden="true"><div class="cover__art">${art}</div><div class="cover__meta"><span class="cover__author">${esc(book.author)}</span><span class="cover__title">${esc(book.title)}</span></div></div>`;
  }

  const pillHTML = (status) => `<span class="pill pill--${status}">${STATUS[status].label}</span>`;

  function cardHTML(book, opts) {
    const options = opts || {};
    const prefix = options.prefix || 'c';
    const entry = shelf[book.id];
    const foot = entry
      ? `${pillHTML(entry.status)}${entry.rating ? `<span class="mini-rating" title="Ваша оценка">${ICON.star}<span class="sr-only">Ваша оценка: </span>${entry.rating}</span>` : ''}`
      : `<button type="button" class="btn btn--soft btn--sm" id="${prefix}-add-${book.id}" data-action="add" data-id="${book.id}" data-status="want" aria-label="Добавить «${esc(book.title)}» на полку">${ICON.plus}На полку</button>`;
    return `<article class="card">
      ${coverHTML(book)}
      <div class="card__body">
        <p class="card__kicker">${esc(book.genre)} · ${book.year}</p>
        <h3 class="card__title"><a href="#book-${book.id}" id="${prefix}-title-${book.id}">${esc(book.title)}</a></h3>
        <p class="card__author">${esc(book.author)}</p>
        ${options.reason ? `<p class="card__reason">${esc(options.reason)}</p>` : ''}
        <div class="card__foot">${foot}</div>
      </div>
    </article>`;
  }

  function statusControlHTML(id, current, prefix) {
    const buttons = STATUS_ORDER.map(
      (status) =>
        `<button type="button" class="segmented__btn segmented__btn--${status}" id="${prefix}-st-${id}-${status}" data-action="status" data-id="${id}" data-status="${status}" aria-pressed="${status === current}">${STATUS[status].label}</button>`
    ).join('');
    return `<div class="segmented" role="group" aria-label="Статус чтения">${buttons}</div>`;
  }

  function starsHTML(id, rating, prefix, large) {
    let html = `<div class="stars${large ? ' stars--lg' : ''}" role="group" aria-label="Оценка от 1 до 5">`;
    for (let n = 1; n <= 5; n += 1) {
      const hint = n === rating ? `${n} из 5, выбрано. Нажмите ещё раз, чтобы сбросить` : `${n} из 5 — ${RATING_WORDS[n]}`;
      html += `<button type="button" class="star${n <= rating ? ' is-on' : ''}" id="${prefix}-star-${id}-${n}" data-action="rate" data-id="${id}" data-value="${n}" aria-pressed="${n === rating}" aria-label="${hint}" title="${n} — ${RATING_WORDS[n]}">${ICON.star}</button>`;
    }
    return `${html}</div>`;
  }

  function emptyHTML(title, text, actions) {
    return `<div class="empty">${ICON.shelf}<h2>${title}</h2><p>${text}</p>${actions ? `<div class="empty__actions">${actions}</div>` : ''}</div>`;
  }

  /* ---------- Вид: каталог ---------- */

  function viewCatalog() {
    const sortOptions = Object.keys(SORTS)
      .map((key) => `<option value="${key}"${key === filters.sort ? ' selected' : ''}>${SORTS[key].label}</option>`)
      .join('');
    return `<div class="wrap page">
      <div class="catalog-head">
        <header class="page-head">
          <p class="eyebrow">Электронная библиотека</p>
          <h1 tabindex="-1" data-focus-fallback>Каталог</h1>
          <p class="lede">${countBooks(BOOKS.length)} восьми жанров — от «Робинзона Крузо» ${YEAR_MIN} года до «Sapiens» ${YEAR_MAX}-го. Откройте карточку книги, чтобы прочитать аннотацию и поставить её на полку.</p>
        </header>
        <aside class="now" id="now" aria-label="Ваша полка" hidden></aside>
      </div>

      <div class="catalog-tools">
        <form class="search" role="search" data-search-form>
          <label for="search" class="sr-only">Поиск по названию или автору</label>
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <input id="search" type="search" placeholder="Название или автор" value="${esc(filters.q)}" autocomplete="off" spellcheck="false" enterkeyhint="search">
        </form>
        <button type="button" class="btn btn--outline filters-toggle" id="filters-toggle" data-action="toggle-filters" aria-expanded="false" aria-controls="filters">Фильтры <span class="badge" id="filters-badge"></span></button>
      </div>

      <div class="catalog">
        <aside class="filters" id="filters" aria-label="Фильтры каталога">
          <section class="filters__section">
            <h2 class="filters__title">Жанр</h2>
            <ul class="genre-list" id="genre-list"></ul>
          </section>
          <section class="filters__section">
            <h2 class="filters__title">Год первой публикации</h2>
            <div class="years">
              <label for="year-from">с</label>
              <input id="year-from" type="number" inputmode="numeric" min="1" max="2100" placeholder="${YEAR_MIN}" value="${filters.yearFrom}">
              <label for="year-to">по</label>
              <input id="year-to" type="number" inputmode="numeric" min="1" max="2100" placeholder="${YEAR_MAX}" value="${filters.yearTo}">
            </div>
            <div class="presets" id="year-presets"></div>
          </section>
          <button type="button" class="link-btn" id="reset-filters" data-action="reset-filters">Сбросить фильтры</button>
        </aside>

        <section class="results" aria-labelledby="results-count">
          <div class="results-head">
            <h2 class="results-count" id="results-count" aria-live="polite"></h2>
            <div class="sort">
              <label for="sort">Сортировка</label>
              <select id="sort" class="select">${sortOptions}</select>
            </div>
          </div>
          <div class="active-filters" id="active-filters"></div>
          <div class="grid" id="catalog-grid"></div>
          <div class="more" id="catalog-more"></div>
        </section>
      </div>
    </div>`;
  }

  function updateCatalogResults() {
    const grid = document.getElementById('catalog-grid');
    if (!grid) return;
    const list = getFiltered();
    const shown = Math.min(filters.shown, list.length);
    const counts = genreCounts();
    const years = yearLabel();
    const activeCount = (filters.genre ? 1 : 0) + (years ? 1 : 0);
    const anyFilter = activeCount > 0 || norm(filters.q) !== '';

    document.getElementById('results-count').innerHTML = anyFilter
      ? `Найдено: ${countBooks(list.length)} <span>из ${BOOKS.length}</span>`
      : `Все книги <span>· ${BOOKS.length}</span>`;

    const genreItems = [{ value: '', label: 'Все жанры', count: counts.total }].concat(
      GENRES.map((genre) => ({ value: genre, label: genre, count: counts[genre] || 0 }))
    );
    document.getElementById('genre-list').innerHTML = genreItems
      .map(
        (item, i) =>
          `<li><button type="button" class="genre-btn${item.count ? '' : ' is-empty'}" id="genre-${i}" data-action="genre" data-genre="${esc(item.value)}" aria-pressed="${filters.genre === item.value}"><span>${esc(item.label)}</span><span class="genre-btn__count">${item.count}</span></button></li>`
      )
      .join('');

    document.getElementById('year-presets').innerHTML = YEAR_PRESETS.map((preset) => {
      const active = String(filters.yearFrom) === String(preset.from) && String(filters.yearTo) === String(preset.to);
      return `<button type="button" class="chip" id="preset-${preset.id}" data-action="preset" data-preset="${preset.id}" aria-pressed="${active}">${preset.label}</button>`;
    }).join('');

    const tags = [];
    if (norm(filters.q)) tags.push({ key: 'q', label: `«${filters.q.trim()}»` });
    if (filters.genre) tags.push({ key: 'genre', label: filters.genre });
    if (years) tags.push({ key: 'years', label: `Годы: ${years}` });
    document.getElementById('active-filters').innerHTML = tags.length
      ? tags
          .map(
            (tag) =>
              `<button type="button" class="tag" id="tag-${tag.key}" data-action="clear-filter" data-key="${tag.key}" aria-label="Убрать фильтр: ${esc(tag.label)}">${esc(tag.label)}${ICON.close}</button>`
          )
          .join('') + (tags.length > 1 ? '<button type="button" class="link-btn" id="tag-reset" data-action="reset-filters">Сбросить всё</button>' : '')
      : '';

    const badge = document.getElementById('filters-badge');
    badge.textContent = activeCount ? String(activeCount) : '';
    document.getElementById('reset-filters').hidden = !anyFilter;

    if (!list.length) {
      grid.innerHTML = '';
      grid.hidden = true;
      document.getElementById('catalog-more').innerHTML = emptyHTML(
        'Ничего не нашлось',
        'Проверьте написание или ослабьте фильтры: например, уберите жанр или расширьте годы.',
        '<button type="button" class="btn btn--primary" id="empty-reset" data-action="reset-filters">Сбросить фильтры</button>'
      );
      return;
    }

    grid.hidden = false;
    grid.innerHTML = list.slice(0, shown).map((book) => cardHTML(book)).join('');
    const rest = list.length - shown;
    const progress = Math.round((shown / list.length) * 100);
    document.getElementById('catalog-more').innerHTML = `
      <p class="more__note">Показано ${shown} из ${list.length}</p>
      <div class="progress" aria-hidden="true"><span style="width:${progress}%"></span></div>
      ${rest > 0 ? `<button type="button" class="btn btn--outline btn--wide" id="show-more" data-action="more">Показать ещё ${Math.min(PAGE_SIZE, rest)}</button>` : ''}`;
  }

  function updateNow() {
    const box = document.getElementById('now');
    if (!box) return;
    const entries = shelfEntries();
    const reading = entries.filter((entry) => entry.status === 'reading').slice(0, 3);
    if (reading.length) {
      box.innerHTML = `<p class="now__title">Сейчас читаете</p><ul class="now__list">${reading
        .map(
          (entry) =>
            `<li><a class="now__item" href="#book-${entry.book.id}">${coverHTML(entry.book, 'cover--thumb')}<span><strong>${esc(entry.book.title)}</strong><small>${esc(entry.book.author)}</small></span></a></li>`
        )
        .join('')}</ul><a class="now__link" href="#shelf">Вся полка ${ICON.arrow}</a>`;
      box.hidden = false;
    } else if (entries.length) {
      const stats = getStats();
      box.innerHTML = `<p class="now__title">Ваша полка</p><p class="now__counts">${STATUS_ORDER.map((status) => `<span>${STATUS[status].label}: <b>${stats.counts[status]}</b></span>`).join('')}</p><a class="now__link" href="#shelf">Открыть полку ${ICON.arrow}</a>`;
      box.hidden = false;
    } else {
      box.innerHTML = '';
      box.hidden = true;
    }
  }

  /* ---------- Вид: книга ---------- */

  function viewBook(book) {
    const related = BOOKS.filter((other) => other.genre === book.genre && other.id !== book.id);
    const rows = [
      ['Автор', esc(book.author)],
      ['Жанр', esc(book.genre)],
      ['Первая публикация', `${book.year} г.`],
      ['Объём', `≈ ${fmtNumber.format(book.pages)} стр.`],
      ['Страна', esc(book.country)],
    ];
    if (book.original) rows.push(['Оригинал', `<span lang="und">${esc(book.original)}</span>`]);
    return `<div class="wrap page">
      <nav class="crumbs" aria-label="Навигация"><a href="#catalog">Каталог</a><span aria-hidden="true">/</span><span>${esc(book.genre)}</span></nav>
      <article class="book">
        <div class="book__cover">${coverHTML(book)}</div>
        <div class="book__info">
          <header class="book__head">
            <p class="eyebrow">${esc(book.genre)} · ${book.year}</p>
            <h1 class="book__title" tabindex="-1" data-focus-fallback>${esc(book.title)}</h1>
            <p class="book__author">${esc(book.author)}</p>
          </header>
          <dl class="biblio">
            <div class="biblio__head"><span>Каталожная карточка</span><span>Инв. № П-${String(book.id).padStart(4, '0')}</span></div>
            ${rows.map((row) => `<dt>${row[0]}</dt><dd>${row[1]}</dd>`).join('')}
          </dl>
          <section class="about" aria-labelledby="about-title">
            <h2 id="about-title">Аннотация</h2>
            <p>${esc(book.annotation)}</p>
          </section>
          <section class="shelf-panel" id="shelf-panel" aria-labelledby="panel-title">${shelfPanelHTML(book)}</section>
        </div>
      </article>
      ${
        related.length
          ? `<section class="related" aria-labelledby="related-title"><h2 id="related-title">Ещё в жанре «${esc(book.genre)}»</h2><div class="grid grid--related" id="related-grid">${related.map((other) => cardHTML(other, { prefix: 'r' })).join('')}</div></section>`
          : ''
      }
    </div>`;
  }

  function shelfPanelHTML(book) {
    const id = book.id;
    const entry = shelf[id];
    if (!entry) {
      return `<h2 class="panel-title" id="panel-title">Поставить на полку</h2>
        <p class="field__hint">Выберите статус — книга появится в разделе «Моя полка», а прочитанные попадут в статистику и рекомендации.</p>
        <div class="status-choice">
          ${STATUS_ORDER.map(
            (status, i) =>
              `<button type="button" class="btn ${i === 0 ? 'btn--primary' : 'btn--outline'}" id="p-add-${id}-${status}" data-action="add" data-id="${id}" data-status="${status}">${STATUS[status].label}</button>`
          ).join('')}
        </div>`;
    }
    const since = entry.status === 'read' && entry.finishedAt ? `Прочитано ${fmtDate.format(entry.finishedAt)}` : `На полке с ${fmtDate.format(entry.addedAt)}`;
    const ratingText = entry.rating ? `${entry.rating} из 5 — ${RATING_WORDS[entry.rating]}` : 'Оценки пока нет';
    return `<div class="panel-head">
        <h2 class="panel-title" id="panel-title">На вашей полке</h2>
        <span>${since}</span>
      </div>
      <div class="field">
        <span class="field__label" id="status-label">Статус чтения</span>
        ${statusControlHTML(id, entry.status, 'p')}
      </div>
      <div class="field">
        <span class="field__label">Ваша оценка</span>
        <div class="rating-row">${starsHTML(id, entry.rating, 'p', true)}<span class="rating-word" aria-live="polite">${ratingText}</span></div>
      </div>
      <form class="note-form" data-note-form="${id}">
        <label class="field__label" for="note-${id}">Заметки и отзыв</label>
        <p class="field__hint" id="note-hint-${id}">Впечатления, цитаты, мысли — видны только вам. Сохраняется автоматически; Ctrl + Enter — сохранить сразу.</p>
        <textarea id="note-${id}" data-note="${id}" rows="7" maxlength="${NOTE_MAX}" aria-describedby="note-hint-${id} note-meta-${id}" placeholder="Например: что запомнилось, кому посоветовать, любимая цитата">${esc(noteText(id))}</textarea>
        <div class="note-form__foot">
          <span class="note-form__meta" id="note-meta-${id}"></span>
          <span class="note-form__count" id="note-count-${id}"></span>
          <button type="submit" class="btn btn--primary" id="note-save-${id}">Сохранить заметку</button>
        </div>
      </form>
      <button type="button" class="link-btn link-btn--danger" id="p-remove-${id}" data-action="remove" data-id="${id}">Убрать с полки</button>`;
  }

  function updateBookView() {
    const book = byId.get(route.id);
    const panel = document.getElementById('shelf-panel');
    if (!book || !panel) return;
    panel.innerHTML = shelfPanelHTML(book);
    if (shelf[book.id]) updateNoteMeta(book.id);
    const related = document.getElementById('related-grid');
    if (related) {
      related.innerHTML = BOOKS.filter((other) => other.genre === book.genre && other.id !== book.id)
        .map((other) => cardHTML(other, { prefix: 'r' }))
        .join('');
    }
  }

  /* ---------- Вид: моя полка ---------- */

  function statsHTML(stats) {
    const taste = getTaste();
    const topGenres = new Set(taste.top.map((group) => group.genre));
    const max = taste.genres.length ? taste.genres[0].count : 1;
    const tiles = [
      { value: fmtNumber.format(stats.counts.read), label: `${plural(stats.counts.read, ['книга прочитана', 'книги прочитаны', 'книг прочитано'])}` },
      { value: fmtNumber.format(stats.pages), label: `${plural(stats.pages, ['страница', 'страницы', 'страниц'])} в прочитанном` },
      {
        value: stats.avg === null ? '—' : fmtRating.format(stats.avg),
        label: stats.avg === null ? 'средняя оценка · оценок пока нет' : `средняя оценка · ${stats.rated} ${plural(stats.rated, ['оценка', 'оценки', 'оценок'])}`,
      },
      { value: fmtNumber.format(stats.thisYear), label: `прочитано в ${stats.year} году` },
    ];
    const stack = STATUS_ORDER.filter((status) => stats.counts[status])
      .map((status) => `<span class="stack__part stack__part--${status}" style="flex-grow:${stats.counts[status]}"></span>`)
      .join('');
    const bars = taste.genres.length
      ? `<ul class="bars">${taste.genres
          .map(
            (group) =>
              `<li class="bar${topGenres.has(group.genre) ? ' bar--top' : ''}"><span class="bar__label">${esc(group.genre)}</span><span class="bar__track"><span class="bar__fill" style="width:${Math.max(6, Math.round((group.count / max) * 100))}%"></span></span><span class="bar__value">${group.count}</span></li>`
          )
          .join('')}</ul><p class="chart__note"><span class="key key--top"></span>Жанры, по которым подбираются рекомендации</p>`
      : '<p class="chart__empty">Отметьте книгу как «Прочитано» — здесь появится распределение по жанрам.</p>';

    return `<section class="formular" aria-labelledby="stats-title">
      <div class="section-head">
        <h2 id="stats-title">Читательский формуляр</h2>
        <span class="section-head__note">Пересчитывается сразу при смене статуса</span>
      </div>
      <div class="tiles">${tiles.map((tile) => `<div class="tile"><span class="tile__value">${tile.value}</span><span class="tile__label">${tile.label}</span></div>`).join('')}</div>
      <div class="charts">
        <div class="chart">
          <h3>Статусы на полке</h3>
          <div class="stack" role="img" aria-label="${STATUS_ORDER.map((status) => `${STATUS[status].label}: ${stats.counts[status]}`).join(', ')}">${stack}</div>
          <ul class="legend">${STATUS_ORDER.map(
            (status) => `<li><span class="key key--${status}"></span>${STATUS[status].label}<b>${stats.counts[status]}</b></li>`
          ).join('')}</ul>
        </div>
        <div class="chart">
          <h3>Жанры прочитанного</h3>
          ${bars}
        </div>
      </div>
    </section>`;
  }

  function shelfItemHTML(entry) {
    const book = entry.book;
    const date = entry.status === 'read' && entry.finishedAt ? `Прочитано ${fmtDate.format(entry.finishedAt)}` : `Добавлено ${fmtDate.format(entry.addedAt)}`;
    const note = entry.note.trim()
      ? `<p class="shelf-item__note">«${esc(excerpt(entry.note, 220))}»</p>`
      : '<p class="shelf-item__note shelf-item__note--empty">Заметок пока нет</p>';
    return `<li class="shelf-item">
      <a class="shelf-item__cover" href="#book-${book.id}" tabindex="-1" aria-hidden="true">${coverHTML(book)}</a>
      <div class="shelf-item__head">
        <h3 class="shelf-item__title"><a href="#book-${book.id}" id="s-title-${book.id}">${esc(book.title)}</a></h3>
        <p class="shelf-item__meta">${esc(book.author)} · ${esc(book.genre)} · ${book.year}</p>
      </div>
      <div class="shelf-item__controls">
        ${statusControlHTML(book.id, entry.status, 's')}
        ${starsHTML(book.id, entry.rating, 's', false)}
      </div>
      ${note}
      <div class="shelf-item__foot">
        <span>${date}</span>
        <a href="#book-${book.id}">${entry.note.trim() ? 'Открыть заметку' : 'Написать заметку'}</a>
        <button type="button" class="link-btn link-btn--danger" id="s-remove-${book.id}" data-action="remove" data-id="${book.id}">Убрать с полки</button>
      </div>
    </li>`;
  }

  function recsTeaserHTML() {
    const taste = getTaste();
    if (!taste.readCount) {
      return `<section class="teaser" aria-labelledby="teaser-title">
        <div class="section-head"><h2 id="teaser-title">Рекомендации</h2></div>
        <p class="muted">Отметьте хотя бы одну книгу как «Прочитано» — и здесь появится подборка по вашим любимым жанрам.</p>
      </section>`;
    }
    const recs = getRecommendations(taste, 5);
    return `<section class="teaser" aria-labelledby="teaser-title">
      <div class="section-head">
        <h2 id="teaser-title">Вам может понравиться</h2>
        <a class="section-head__link" href="#recs">Все рекомендации ${ICON.arrow}</a>
      </div>
      <p class="muted">По жанрам: ${taste.top.map((group) => `<b>${esc(group.genre)}</b>`).join(', ')}.</p>
      ${
        recs.length
          ? `<div class="grid grid--wide">${recs.map((rec) => cardHTML(rec.book, { prefix: 't', reason: recReason(rec) })).join('')}</div>`
          : '<p class="muted">Все книги этих жанров уже на вашей полке.</p>'
      }
    </section>`;
  }

  function viewShelf() {
    const entries = shelfEntries();
    const head = `<header class="page-head">
        <p class="eyebrow">Личный кабинет</p>
        <h1 tabindex="-1" data-focus-fallback>Моя полка</h1>
        <p class="lede">Статусы, оценки и заметки по каждой книге. Всё хранится в этом браузере и сохраняется между визитами.</p>
      </header>`;
    if (!entries.length) {
      return `<div class="wrap page">${head}${emptyHTML(
        'Полка пока пуста',
        'Откройте каталог и добавьте книги, которые читаете или собираетесь прочитать. Чтобы быстро посмотреть, как работают статистика и рекомендации, заполните полку примером.',
        '<a class="btn btn--primary" href="#catalog">Перейти в каталог</a><button type="button" class="btn btn--outline" id="demo-fill" data-action="demo">Заполнить примером</button>'
      )}</div>`;
    }
    const stats = getStats();
    const tab = ui.shelfTab;
    const visible = tab === 'all' ? entries : entries.filter((entry) => entry.status === tab);
    const tabs = [{ id: 'all', label: 'Все', count: stats.total }].concat(
      STATUS_ORDER.map((status) => ({ id: status, label: STATUS[status].label, count: stats.counts[status] }))
    );
    return `<div class="wrap page">
      ${head}
      ${statsHTML(stats)}
      <section class="shelf" aria-labelledby="shelf-title">
        <div class="section-head">
          <h2 id="shelf-title">Книги на полке</h2>
          <button type="button" class="link-btn link-btn--danger" id="clear-shelf" data-action="clear-shelf">Очистить полку</button>
        </div>
        <div class="tabs" role="group" aria-label="Показать на полке">${tabs
          .map(
            (item) =>
              `<button type="button" class="tab" id="tab-${item.id}" data-action="tab" data-tab="${item.id}" aria-pressed="${item.id === tab}">${item.label}<span class="tab__n">${item.count}</span></button>`
          )
          .join('')}</div>
        ${
          visible.length
            ? `<ul class="shelf-list">${visible.map(shelfItemHTML).join('')}</ul>`
            : `<p class="muted shelf__empty">В разделе «${STATUS[tab].label}» пока нет книг.</p>`
        }
      </section>
      ${recsTeaserHTML()}
    </div>`;
  }

  /* ---------- Вид: рекомендации ---------- */

  function viewRecs() {
    const taste = getTaste();
    const head = `<header class="page-head">
        <p class="eyebrow">Подборка для вас</p>
        <h1 tabindex="-1" data-focus-fallback>Рекомендации</h1>
        <p class="lede">Берём 2–3 жанра, которые вы читаете чаще всего, и предлагаем книги из них, которых ещё нет на вашей полке.</p>
      </header>`;
    if (!taste.readCount) {
      const hasShelf = Object.keys(shelf).length > 0;
      return `<div class="wrap page">${head}${emptyHTML(
        'Пока не на что опереться',
        hasShelf
          ? 'На полке есть книги, но ни одна не отмечена как «Прочитано». Поменяйте статус хотя бы одной — подборка появится сразу.'
          : 'Отметьте хотя бы одну книгу как «Прочитано» — подборка появится сразу. Или заполните полку примером, чтобы посмотреть, как это работает.',
        hasShelf
          ? '<a class="btn btn--primary" href="#shelf">Открыть полку</a>'
          : '<a class="btn btn--primary" href="#catalog">Перейти в каталог</a><button type="button" class="btn btn--outline" id="demo-fill" data-action="demo">Заполнить примером</button>'
      )}</div>`;
    }
    const recs = getRecommendations(taste, 10);
    const tasteItems = taste.top
      .map(
        (group, i) =>
          `<li class="taste__item"><span class="taste__rank">${i + 1}</span><span><b>${esc(group.genre)}</b><small>${countBooks(group.count)}${group.avg !== null ? ` · средняя оценка ${fmtRating.format(group.avg)}` : ''}</small></span></li>`
      )
      .join('');
    const narrow = taste.top.length < 2
      ? '<p class="note">Пока вы читали книги только одного жанра. Прочитайте что-нибудь из других — подборка станет разнообразнее.</p>'
      : '';
    return `<div class="wrap page">
      ${head}
      <section class="taste" aria-labelledby="taste-title">
        <h2 id="taste-title" class="taste__title">Ваши жанры по прочитанному</h2>
        <ol class="taste__list">${tasteItems}</ol>
        ${narrow}
      </section>
      ${
        recs.length
          ? `<section aria-labelledby="recs-title"><h2 class="sr-only" id="recs-title">Рекомендованные книги</h2><div class="grid grid--wide">${recs
              .map((rec) => cardHTML(rec.book, { prefix: 'rc', reason: recReason(rec) }))
              .join('')}</div></section>`
          : emptyHTML(
              'Вы собрали все книги любимых жанров',
              'Все книги этих жанров уже на вашей полке. Загляните в каталог — возможно, пора открыть новый жанр.',
              '<a class="btn btn--primary" href="#catalog">Перейти в каталог</a>'
            )
      }
    </div>`;
  }

  function viewNotFound() {
    return `<div class="wrap page">${emptyHTML(
      'Такой книги нет в каталоге',
      'Возможно, ссылка устарела. Вернитесь в каталог и найдите книгу через поиск.',
      '<a class="btn btn--primary" href="#catalog">Перейти в каталог</a>'
    )}</div>`;
  }

  /* ---------- Маршруты и отрисовка ---------- */

  function parseRoute(hash) {
    const value = String(hash || '').replace(/^#\/?/, '');
    const match = /^book-(\d+)$/.exec(value);
    if (match) return byId.has(Number(match[1])) ? { view: 'book', id: Number(match[1]) } : { view: 'notfound' };
    if (value === 'shelf') return { view: 'shelf' };
    if (value === 'recs') return { view: 'recs' };
    return { view: 'catalog' };
  }

  const sameRoute = (a, b) => a.view === b.view && a.id === b.id;

  function mount(opts) {
    const options = opts || {};
    if (route.view === 'catalog') {
      main.innerHTML = viewCatalog();
      updateCatalogResults();
      updateNow();
    } else if (route.view === 'book') {
      main.innerHTML = viewBook(byId.get(route.id));
      if (shelf[route.id]) updateNoteMeta(route.id);
    } else if (route.view === 'shelf') {
      main.innerHTML = viewShelf();
    } else if (route.view === 'recs') {
      main.innerHTML = viewRecs();
    } else {
      main.innerHTML = viewNotFound();
    }
    updateChrome();
    window.scrollTo(0, options.scroll || 0);
    if (options.focus) {
      const target = main.querySelector('[data-focus-fallback]');
      if (target) target.focus({ preventScroll: true });
    }
  }

  function refresh(fallbackId) {
    updateChrome();
    preserveFocus(() => {
      if (route.view === 'catalog') {
        updateCatalogResults();
        updateNow();
      } else if (route.view === 'book') {
        updateBookView();
      } else if (route.view === 'shelf') {
        main.innerHTML = viewShelf();
      } else if (route.view === 'recs') {
        main.innerHTML = viewRecs();
      }
    }, fallbackId);
  }

  // После перерисовки возвращает фокус на тот же элемент (по id), чтобы не терять место.
  function preserveFocus(render, fallbackId) {
    const active = document.activeElement;
    const id = active && active.id;
    let selection = null;
    if (active && typeof active.selectionStart === 'number') {
      try {
        selection = [active.selectionStart, active.selectionEnd];
      } catch (err) {
        selection = null;
      }
    }
    render();
    if (!active || active === document.body || document.contains(active)) return;
    const target =
      (id && document.getElementById(id)) || (fallbackId && document.getElementById(fallbackId)) || main.querySelector('[data-focus-fallback]');
    if (!target) return;
    target.focus({ preventScroll: true });
    if (selection && typeof target.setSelectionRange === 'function') {
      try {
        target.setSelectionRange(selection[0], selection[1]);
      } catch (err) {
        /* поле без выделения текста */
      }
    }
  }

  function updateChrome() {
    const total = Object.keys(shelf).length;
    const count = document.getElementById('nav-shelf-count');
    if (count) {
      count.textContent = total ? String(total) : '';
      count.setAttribute('aria-label', total ? `на полке ${countBooks(total)}` : '');
    }
    const section = route.view === 'book' || route.view === 'notfound' ? 'catalog' : route.view;
    document.querySelectorAll('[data-nav]').forEach((link) => {
      if (link.dataset.nav === section) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    const titles = { catalog: 'Каталог', shelf: 'Моя полка', recs: 'Рекомендации', notfound: 'Книга не найдена' };
    const page = route.view === 'book' ? byId.get(route.id).title : titles[route.view];
    document.title = `${page} — Переплёт`;
  }

  function navigate(hash) {
    const next = parseRoute(hash);
    closeMenu();
    if (sameRoute(next, route)) {
      if (route.view !== 'catalog') window.scrollTo(0, 0);
      return;
    }
    if (route.view === 'catalog') catalogScroll = window.scrollY;
    route = next;
    try {
      window.history.pushState(null, '', hash);
    } catch (err) {
      try {
        window.location.hash = hash;
      } catch (err2) {
        /* навигация работает и без адресной строки */
      }
    }
    mount({ scroll: next.view === 'catalog' ? catalogScroll : 0, focus: true });
  }

  function onLocationChange() {
    const next = parseRoute(window.location.hash);
    if (sameRoute(next, route)) return;
    if (route.view === 'catalog') catalogScroll = window.scrollY;
    route = next;
    mount({ scroll: next.view === 'catalog' ? catalogScroll : 0, focus: true });
  }

  /* ---------- Меню, уведомления ---------- */

  function closeMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;
    toggle.setAttribute('aria-expanded', 'false');
    nav.classList.remove('is-open');
  }

  function toggleMenu() {
    const toggle = document.getElementById('menu-toggle');
    const nav = document.getElementById('site-nav');
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    toggle.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('is-open', open);
  }

  function toast(message, action) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    toastAction = action ? action.run : null;
    region.innerHTML = `<div class="toast"><span class="toast__text">${esc(message)}</span>${
      action ? `<button type="button" class="toast__action" data-action="toast-action">${esc(action.label)}</button>` : ''
    }<button type="button" class="toast__close" data-action="toast-close" aria-label="Закрыть уведомление">${ICON.close}</button></div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 8000 : 4500);
  }

  function hideToast() {
    const region = document.getElementById('toast-region');
    if (region) region.innerHTML = '';
    toastAction = null;
  }

  /* ---------- События ---------- */

  function onClick(event) {
    const link = event.target.closest('a[href^="#"]');
    if (link && !link.dataset.action && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const href = link.getAttribute('href');
      if (href.length > 1) {
        event.preventDefault();
        navigate(href);
        return;
      }
    }

    const el = event.target.closest('[data-action]');
    if (!el) {
      if (!event.target.closest('.site-header')) closeMenu();
      return;
    }
    const id = Number(el.dataset.id);
    switch (el.dataset.action) {
      case 'skip':
        event.preventDefault();
        main.focus();
        break;
      case 'toggle-menu':
        toggleMenu();
        break;
      case 'add':
        addToShelf(id, el.dataset.status || 'want');
        break;
      case 'status':
        setStatus(id, el.dataset.status);
        break;
      case 'rate':
        setRating(id, Number(el.dataset.value));
        break;
      case 'remove':
        removeFromShelf(id);
        break;
      case 'genre':
        setFilters({ genre: filters.genre === el.dataset.genre ? '' : el.dataset.genre });
        break;
      case 'preset': {
        const preset = YEAR_PRESETS.find((item) => item.id === el.dataset.preset);
        const active = String(filters.yearFrom) === String(preset.from) && String(filters.yearTo) === String(preset.to);
        setFilters(active ? { yearFrom: '', yearTo: '' } : { yearFrom: preset.from, yearTo: preset.to });
        syncControls();
        break;
      }
      case 'clear-filter': {
        const key = el.dataset.key;
        setFilters(key === 'q' ? { q: '' } : key === 'genre' ? { genre: '' } : { yearFrom: '', yearTo: '' });
        syncControls();
        break;
      }
      case 'reset-filters':
        setFilters(Object.assign({}, DEFAULT_FILTERS, { sort: filters.sort }));
        syncControls();
        break;
      case 'more': {
        const before = filters.shown;
        filters.shown += PAGE_SIZE;
        saveFilters();
        updateCatalogResults();
        const next = getFiltered()[before];
        const target = (next && document.getElementById(`c-title-${next.id}`)) || document.getElementById('catalog-grid');
        if (target) target.focus({ preventScroll: true });
        break;
      }
      case 'toggle-filters': {
        const panel = document.getElementById('filters');
        const open = el.getAttribute('aria-expanded') !== 'true';
        el.setAttribute('aria-expanded', String(open));
        panel.classList.toggle('is-open', open);
        break;
      }
      case 'tab':
        ui.shelfTab = el.dataset.tab;
        saveUi();
        preserveFocus(() => {
          main.innerHTML = viewShelf();
        });
        break;
      case 'demo':
        fillDemo();
        break;
      case 'clear-shelf':
        clearShelf();
        break;
      case 'toast-action': {
        const run = toastAction;
        hideToast();
        if (run) run();
        break;
      }
      case 'toast-close':
        hideToast();
        break;
      default:
        break;
    }
  }

  function onInput(event) {
    const target = event.target;
    if (target.id === 'search') {
      filters.q = target.value.slice(0, 100);
      filters.shown = PAGE_SIZE;
      scheduleCatalogUpdate(140);
    } else if (target.id === 'year-from' || target.id === 'year-to') {
      const value = toYear(target.value.trim());
      if (target.id === 'year-from') filters.yearFrom = value;
      else filters.yearTo = value;
      filters.shown = PAGE_SIZE;
      scheduleCatalogUpdate(300);
    } else if (target.dataset.note) {
      const id = Number(target.dataset.note);
      if (!shelf[id]) return;
      drafts[id] = target.value;
      updateNoteMeta(id);
      clearTimeout(noteTimers[id]);
      noteTimers[id] = setTimeout(() => commitNote(id, false), 900);
    }
  }

  function onChange(event) {
    if (event.target.id === 'sort' && SORTS[event.target.value]) {
      setFilters({ sort: event.target.value });
    }
  }

  function onSubmit(event) {
    const form = event.target;
    if (form.hasAttribute('data-search-form')) {
      event.preventDefault();
      const input = document.getElementById('search');
      if (input) input.blur();
      return;
    }
    if (form.dataset.noteForm) {
      event.preventDefault();
      commitNote(Number(form.dataset.noteForm), true);
    }
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      const toggle = document.getElementById('menu-toggle');
      if (toggle && toggle.getAttribute('aria-expanded') === 'true') {
        closeMenu();
        toggle.focus();
      }
    }
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && event.target.dataset && event.target.dataset.note) {
      event.preventDefault();
      commitNote(Number(event.target.dataset.note), true);
    }
  }

  function onFocusOut(event) {
    const target = event.target;
    if (target.dataset && target.dataset.note && Number(target.dataset.note) in drafts) {
      commitNote(Number(target.dataset.note), false);
    }
  }

  function onStorage(event) {
    if (event.key === KEYS.shelf) {
      shelf = loadShelf();
      refresh();
    }
  }

  function init() {
    main = document.getElementById('main');
    if (!main) return;
    mount();
    document.addEventListener('click', onClick);
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('submit', onSubmit);
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('focusout', onFocusOut);
    window.addEventListener('popstate', onLocationChange);
    window.addEventListener('hashchange', onLocationChange);
    window.addEventListener('storage', onStorage);
    window.addEventListener('pagehide', () => Object.keys(drafts).forEach((id) => commitNote(Number(id), false)));
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
