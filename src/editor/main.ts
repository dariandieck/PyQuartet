import type { RawCard } from "../../scripts/lib/cardsFile.ts";
import type { Resolved } from "../../scripts/lib/lookup.ts";
import { formatStat, needsPypi, type Card, type Category, type StatSource } from "../game/model.ts";
import { CARD_H, CARD_W, CardRenderer } from "../render/cardView.ts";
import { ImageStore } from "../render/images.ts";

// ---------------------------------------------------------------------------------------------------------------
// Server API (scripts/editor/vite.config.ts)

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, init);
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
  return body as T;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(Object.entries(params).filter(([, value]) => value)).toString();
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: number | undefined;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(fn, ms);
  };
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------------------------------------------
// Fields

/** empty → nothing yet; auto → filled by a lookup (highlighted); manual → typed by the user (never overwritten). */
type Origin = "empty" | "auto" | "manual" | "saved";

interface FieldOptions {
  label: string;
  hint?: string;
  placeholder?: string;
  inputMode?: "text" | "decimal" | "url";
  /** Makes the value Ctrl+clickable: the page it names, e.g. the PyPI project for a package name. */
  link?: (value: string) => string;
}

class Field {
  readonly row = element("div", "field");
  readonly input = element("input");
  readonly control = element("div", "control");
  private readonly status = element("div", "status");
  origin: Origin = "empty";
  onInput: () => void = () => {};
  private token = 0;

  constructor(parent: HTMLElement, options: FieldOptions) {
    const label = element("label");
    label.textContent = options.label;
    if (options.hint) label.append(Object.assign(element("small"), { textContent: options.hint }));
    this.input.id = `field-${parent.children.length}-${parent.id}`;
    label.htmlFor = this.input.id;
    this.input.placeholder = options.placeholder ?? "";
    this.input.inputMode = options.inputMode ?? "text";
    this.input.spellcheck = false;
    this.control.append(this.input);
    this.row.append(label, this.control, this.status);
    parent.append(this.row);
    const link = options.link;
    if (link) {
      this.row.classList.add("linkable");
      this.input.title = "Ctrl+click to open";
      this.input.addEventListener("click", (event) => {
        if (!(event.ctrlKey || event.metaKey) || !this.value) return;
        event.preventDefault();
        window.open(link(this.value), "_blank", "noopener");
      });
    }
    this.input.addEventListener("input", () => {
      this.token += 1; // a lookup still running for this field must not overwrite what was typed
      this.origin = this.input.value.trim() ? "manual" : "empty";
      this.row.classList.remove("auto", "invalid");
      this.setStatus("", "");
      this.onInput();
      markDirty();
    });
  }

  get value(): string {
    return this.input.value.trim();
  }

  /**
   * Starts an automatic lookup for this field. Returns null if the user typed the value, otherwise a check that
   * stays true only while this lookup is the latest one and the field wasn't edited meanwhile.
   */
  begin(): (() => boolean) | null {
    if (this.origin === "manual") return null;
    const token = ++this.token;
    this.setStatus("loading", "");
    return () => token === this.token && this.origin !== "manual";
  }

  fill(value: string, note: string, warn = false): void {
    this.input.value = value;
    this.origin = "auto";
    this.row.classList.add("auto");
    this.row.classList.remove("invalid");
    this.setStatus(warn ? "warn" : "done", note, true);
    markDirty();
    this.onFill();
  }

  fail(note: string): void {
    this.setStatus("error", note);
  }

  idle(): void {
    this.setStatus("", "");
  }

  note(text: string): void {
    this.setStatus("", text);
  }

  load(value: string | number | null | undefined): void {
    this.token += 1;
    this.input.value = value === null || value === undefined ? "" : String(value);
    this.origin = this.input.value ? "saved" : "empty";
    this.row.classList.remove("auto", "invalid");
    this.setStatus("", "");
    this.onFill();
  }

  /** Called after a programmatic value change (fill/load), e.g. to sync a color picker. */
  onFill: () => void = () => {};

  private setStatus(kind: "" | "loading" | "done" | "warn" | "error", text: string, badge = false): void {
    this.status.className = `status ${kind}`;
    this.status.replaceChildren();
    this.status.title = text;
    if (kind === "loading") this.status.append(element("div", "spinner"), "looking up…");
    else {
      if (badge) this.status.append(Object.assign(element("span", "badge"), { textContent: "auto" }));
      if (text) this.status.append(Object.assign(element("span"), { textContent: text }));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Form

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const libraryBox = $("#library-fields");
const imageBox = $("#image-fields");
const statBox = $("#stat-fields");
const saveButton = $<HTMLButtonElement>("#save");
const messageBox = $("#message");

const library = new Field(libraryBox, { label: "Library", hint: "name on the card", placeholder: "e.g. pandas" });
const home = new Field(libraryBox, {
  label: "Home URL",
  placeholder: "https://…",
  inputMode: "url",
  // Only web links; a typed "pandas.pydata.org" gets https:// in front.
  link: (url) => (/^https?:\/\//i.test(url) ? url : `https://${url.replace(/^[a-z][\w+.-]*:\/*/i, "")}`),
});
const pypi = new Field(libraryBox, {
  label: "PyPI package",
  hint: "for downloads",
  placeholder: "e.g. torch",
  link: (name) => `https://pypi.org/project/${encodeURIComponent(name)}/`,
});
const repo = new Field(libraryBox, {
  label: "GitHub repo",
  hint: "owner/name",
  placeholder: "e.g. pandas-dev/pandas",
  link: (name) => `https://github.com/${name.split("/").map(encodeURIComponent).join("/")}`,
});
const imgUrl = new Field(imageBox, { label: "Image URL", placeholder: "https://…/logo.svg", inputMode: "url" });

const logoSearch = Object.assign(element("button", "secondary"), {
  type: "button",
  textContent: "Search ↗",
  title: "Search the web for the library's branding",
});
imgUrl.control.append(logoSearch);
logoSearch.addEventListener("click", () => {
  if (!library.value) {
    library.input.focus();
    showMessage("Enter the library name first", true);
    return;
  }
  const q = encodeURIComponent(`${library.value} branding logo`);
  window.open(`https://www.google.com/search?q=${q}`, "_blank", "noopener");
});

// Hold Ctrl to see which fields are links.
for (const type of ["keydown", "keyup"] as const) {
  window.addEventListener(type, (event) => document.body.classList.toggle("ctrl", event.ctrlKey || event.metaKey));
}
window.addEventListener("blur", () => document.body.classList.remove("ctrl"));
const imgScale = new Field(imageBox, { label: "Image scale", hint: "1 = fit the box", inputMode: "decimal" });
const color = new Field(imageBox, { label: "Color", hint: "card frame", placeholder: "#rrggbb" });

const scaleSlider = Object.assign(element("input"), { type: "range", min: "0.3", max: "2", step: "0.05" });
imgScale.control.append(scaleSlider);
scaleSlider.addEventListener("input", () => {
  imgScale.input.value = scaleSlider.value;
  imgScale.input.dispatchEvent(new Event("input"));
});
imgScale.onFill = () => {
  scaleSlider.value = imgScale.value || "1";
};
imgScale.onInput = () => {
  if (Number(imgScale.value) > 0) scaleSlider.value = imgScale.value;
};

const HEX = /^#[0-9a-f]{6}$/i;
const picker = Object.assign(element("input"), { type: "color", value: "#3776ab", title: "Pick a color" });
color.control.prepend(picker);
picker.addEventListener("input", () => {
  color.input.value = picker.value;
  color.input.dispatchEvent(new Event("input"));
});
color.onFill = () => {
  if (HEX.test(color.value)) picker.value = color.value.toLowerCase();
};
color.onInput = () => {
  if (HEX.test(color.value)) picker.value = color.value.toLowerCase();
};

interface StatField {
  category: Category;
  field: Field;
}

const SOURCE_NAMES: Record<StatSource, string> = {
  github_stars: "GitHub",
  github_forks: "GitHub",
  github_contributors: "GitHub",
  pepy_downloads: "pepy.tech",
  pypi_wheel_mb: "PyPI",
  pypi_age_years: "PyPI",
  depsdev_dependents: "deps.dev",
};

let categories: Category[] = [];
let statFields: StatField[] = [];
let cards: RawCard[] = [];
/** Library name of the card being edited, null for a new card. */
let editing: string | null = null;
let dirty = false;

function markDirty(): void {
  dirty = true;
  messageBox.textContent = "";
}

function buildStatFields(): void {
  statFields = categories.map((category) => {
    const arrow = category.polarity === "positive" ? "▲ higher wins" : "▼ lower wins";
    const source = category.source ? ` - ${SOURCE_NAMES[category.source]}` : "";
    const field = new Field(statBox, {
      label: category.unit ? `${category.label} (${category.unit})` : category.label,
      hint: arrow + source,
      inputMode: "decimal",
    });
    field.onInput = () => {
      const value = Number(field.value);
      if (field.value && Number.isFinite(value)) field.note(`shown as ${formatStat(category, value)}`);
    };
    return { category, field };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Automatic lookups

/** Name (case-insensitive, "matplotlib" → "Matplotlib" is only a display change) + home URL of the last lookup. */
let lastLookup = "";
/** Counts typing in the name / home URL fields, to tell the user's edits from the lookup's own fills. */
let identityEdits = 0;

function lookupKey(): string {
  return `${library.value.toLowerCase()}\n${home.value}`;
}

/**
 * Library name or homepage → PyPI package, GitHub repo (and homepage / name if empty) → all stats. Skipped when
 * name and URL didn't change apart from upper/lower case, to save API calls; `force` (Fetch again) always runs.
 */
async function resolve(force = false): Promise<void> {
  const name = library.value;
  const url = home.value;
  if (!name && !url) return;
  if (!force && lookupKey() === lastLookup) return;
  lastLookup = lookupKey();
  const edits = identityEdits;
  const checks = new Map<Field, () => boolean>();
  for (const field of [library, home, pypi, repo]) {
    // A name/URL the lookup starts from stays as typed; only empty or automatic fields are (re)filled.
    if (field.value && (field === library || field === home) && field.origin !== "auto") continue;
    const check = field.begin();
    if (check) checks.set(field, check);
  }
  for (const { field } of statFields) if (field.origin !== "manual") field.begin();
  if (logoReplaceable()) imgUrl.begin();

  let found: Resolved;
  try {
    found = await api<Resolved>(`/resolve?${query({ library: name, url })}`);
  } catch (error) {
    for (const [field, check] of checks) if (check()) field.fail(message(error));
    fetchStats();
    void fetchLogo();
    return;
  }
  const apply = (field: Field, value: string | null, note: string, missing: string, warn = false) => {
    if (!checks.get(field)?.()) return;
    if (value) field.fill(value, note, warn);
    else field.fail(missing);
  };
  apply(library, found.library, "from the repo", "not found");
  apply(home, found.homepage, "found", "no homepage found");
  apply(repo, found.repo, "found on GitHub", "no repo found");
  apply(pypi, found.pypi, found.pypiLinked ? "found on PyPI" : "guess, check it", "not on PyPI", !found.pypiLinked);
  // The lookup may have filled an empty name or home URL; that must not count as a change worth a new lookup.
  if (edits === identityEdits) lastLookup = lookupKey();
  fetchStats();
  void fetchLogo();
}

/** A saved logo was usually picked by hand (e.g. a variant for light backgrounds), so lookups only fill empty ones. */
function logoReplaceable(): boolean {
  return imgUrl.origin === "empty" || imgUrl.origin === "auto";
}

/** Package/repo → logo from the READMEs or the GitHub organization → then its color. */
async function fetchLogo(): Promise<void> {
  if (!logoReplaceable()) return;
  const check = imgUrl.begin();
  if (!check) return;
  if (!pypi.value && !repo.value) {
    imgUrl.fail("needs a package or repo");
    return;
  }
  try {
    const { logo } = await api<{ logo: { url: string; from: string } | null }>(
      `/logo?${query({ pypi: pypi.value, repo: repo.value })}`,
    );
    if (!check()) return;
    if (!logo) {
      imgUrl.fail("no logo found, try Search");
      return;
    }
    imgUrl.fill(logo.url, `from the ${logo.from}`);
    showLogo();
    void fetchColor();
  } catch (error) {
    if (check()) imgUrl.fail(message(error));
  }
}

/** Fetches every stat whose source depends on `changed` (or all), skipping values the user typed. */
function fetchStats(changed?: "repo" | "pypi"): void {
  for (const { category, field } of statFields) {
    const source = category.source;
    if (!source) continue;
    const needs = needsPypi(source) ? "pypi" : "repo";
    if (changed && changed !== needs) continue;
    const check = field.begin();
    if (!check) continue;
    const id = needs === "repo" ? repo.value : pypi.value;
    if (!id) {
      // Not a Python package (e.g. an SDK): its PyPI-based values are 0 by decision, not missing.
      if (needs === "pypi") field.fill("0", "no PyPI package");
      else field.fail("needs a GitHub repo");
      continue;
    }
    api<{ value: number }>(`/stat?${query({ source, repo: repo.value, pypi: pypi.value })}`).then(
      ({ value }) => check() && field.fill(String(value), formatStat(category, value)),
      (error: unknown) => check() && field.fail(message(error)),
    );
  }
}

async function fetchColor(): Promise<void> {
  const url = imgUrl.value;
  if (!url) return;
  const check = color.begin();
  if (!check) return;
  try {
    const result = await api<{ color: string | null }>(`/color?${query({ url })}`);
    if (!check()) return;
    if (result.color) color.fill(result.color, "from the logo");
    else color.fail("no vivid color in the logo");
  } catch (error) {
    if (check()) color.fail(message(error));
  }
}

const resolveSoon = debounce(() => void resolve(), 700);
const colorSoon = debounce(() => void fetchColor(), 600);
const repoStatsSoon = debounce(() => {
  fetchStats("repo");
  void fetchLogo();
}, 700);
const pypiStatsSoon = debounce(() => {
  fetchStats("pypi");
  void fetchLogo();
}, 700);
library.onInput = home.onInput = () => {
  identityEdits += 1;
  resolveSoon();
};
repo.onInput = repoStatsSoon;
pypi.onInput = pypiStatsSoon;
imgUrl.onInput = () => {
  showLogo();
  colorSoon();
};

// ---------------------------------------------------------------------------------------------------------------
// Logo + card preview

const logo = $<HTMLImageElement>("#logo");
const logoInfo = $("#logo-info");

function showLogo(): void {
  const url = imgUrl.value;
  logo.hidden = true;
  if (!url) {
    logo.removeAttribute("src");
    logoInfo.textContent = "No image URL yet";
    return;
  }
  logoInfo.textContent = "Loading image…";
  logo.src = url;
}

logo.addEventListener("load", () => {
  logo.hidden = false;
  logoInfo.textContent = `${logo.naturalWidth} × ${logo.naturalHeight} px`;
});
logo.addEventListener("error", () => {
  if (!imgUrl.value) return;
  logo.hidden = true;
  logoInfo.textContent = "The image could not be loaded";
});

const PREVIEW_SCALE = 1.5;
const canvas = $<HTMLCanvasElement>("#card");
const ctx = canvas.getContext("2d")!;
let renderer: CardRenderer | null = null;
let rendererKey = "";

function previewCard(): Card {
  const stats: Record<string, number> = {};
  for (const { category, field } of statFields) stats[category.label] = Number(field.value) || 0;
  const scale = Number(imgScale.value);
  return {
    library: library.value || "library",
    url: home.value || null,
    imgUrl: imgUrl.value || null,
    imgScale: scale > 0 ? scale : 1,
    color: HEX.test(color.value) ? color.value : null,
    stats,
  };
}

function drawPreview(): void {
  const card = previewCard();
  // ImageStore keys images by library name and loads once, so a new name or URL needs a fresh store.
  const key = `${card.library}\n${card.imgUrl}\n${categories.length}`;
  if (key !== rendererKey) {
    const images = new ImageStore();
    images.load([card]);
    renderer = new CardRenderer(categories, images);
    rendererKey = key;
  }
  const density = window.devicePixelRatio || 1;
  const width = Math.round(CARD_W * PREVIEW_SCALE * density);
  const height = Math.round(CARD_H * PREVIEW_SCALE * density);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${CARD_W * PREVIEW_SCALE}px`;
    canvas.style.height = `${CARD_H * PREVIEW_SCALE}px`;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(PREVIEW_SCALE * density, 0, 0, PREVIEW_SCALE * density, 0, 0);
  renderer?.drawFront(ctx, card, { highlight: null, outcome: null, hover: null });
  requestAnimationFrame(drawPreview);
}

// ---------------------------------------------------------------------------------------------------------------
// Card list, load and save

const list = $("#card-list");
const search = $<HTMLInputElement>("#card-search");
const noMatch = $("#no-match");

function matchingCards(): RawCard[] {
  const query = search.value.trim().toLowerCase();
  if (!query) return cards;
  return cards.filter((card) =>
    [card.library, card.pypi, card.repo].some((text) => text?.toLowerCase().includes(query)),
  );
}

function renderList(): void {
  const shown = matchingCards();
  noMatch.hidden = shown.length > 0 || cards.length === 0;
  list.replaceChildren(
    ...shown.map((card) => {
      const button = element("button", card.library === editing ? "active" : "");
      button.type = "button";
      const swatch = element("span", "swatch");
      swatch.style.background = card.color ?? "transparent";
      button.append(swatch, card.library);
      button.addEventListener("click", () => openCard(card));
      const item = element("li");
      item.append(button);
      return item;
    }),
  );
}

search.addEventListener("input", renderList);
search.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    const first = matchingCards()[0];
    if (first) openCard(first);
  } else if (event.key === "Escape" && search.value) {
    search.value = "";
    renderList();
  }
});

function confirmDiscard(): boolean {
  return !dirty || window.confirm("Discard the unsaved changes of this card?");
}

function loadForm(card: RawCard | null): void {
  library.load(card?.library);
  home.load(card?.url);
  pypi.load(card?.pypi);
  repo.load(card?.repo);
  imgUrl.load(card?.img_url);
  imgScale.load(card ? (card.img_scale ?? 1) : 1);
  color.load(card?.color);
  for (const { category, field } of statFields) field.load(card?.stats[category.label]);
  editing = card?.library ?? null;
  saveButton.textContent = card ? "Save changes" : "Add card";
  dirty = false;
  messageBox.textContent = "";
  // An opened card counts as looked up, so fixing the case of its name doesn't refetch everything.
  lastLookup = lookupKey();
  showLogo();
  renderList();
}

function openCard(card: RawCard): void {
  if (card.library !== editing && confirmDiscard()) loadForm(card);
}

function collect(): RawCard | null {
  const invalid: Field[] = [];
  const stats: Record<string, number> = {};
  for (const { category, field } of statFields) {
    const value = Number(field.value);
    if (!field.value || !Number.isFinite(value)) invalid.push(field);
    else stats[category.label] = value;
  }
  const scale = Number(imgScale.value || 1);
  if (!(scale > 0)) invalid.push(imgScale);
  if (color.value && !HEX.test(color.value)) invalid.push(color);
  if (!library.value) invalid.push(library);
  for (const field of invalid) field.row.classList.add("invalid");
  if (invalid.length) {
    showMessage("Please fill the marked fields", true);
    invalid[0]!.input.focus();
    return null;
  }
  return {
    library: library.value,
    url: home.value || null,
    pypi: pypi.value || null,
    repo: repo.value || null,
    img_url: imgUrl.value || null,
    img_scale: scale,
    color: color.value ? color.value.toLowerCase() : null,
    stats,
  };
}

function showMessage(text: string, error = false): void {
  messageBox.textContent = text;
  messageBox.className = error ? "error" : "ok";
}

async function save(): Promise<void> {
  const card = collect();
  if (!card) return;
  saveButton.disabled = true;
  try {
    const result = await api<{ cards: RawCard[] }>("/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card, replace: editing }),
    });
    cards = result.cards;
    if (editing === null) {
      // Adding cards is usually done in a row, so go straight to the next empty card.
      loadForm(null);
      window.scrollTo({ top: 0 });
      library.input.focus();
      showMessage(`Added "${card.library}" to data/cards.json (${cards.length} cards)`);
    } else {
      editing = card.library;
      dirty = false;
      renderList();
      showMessage(`Saved to data/cards.json (${cards.length} cards)`);
    }
  } catch (error) {
    showMessage(message(error), true);
  } finally {
    saveButton.disabled = false;
  }
}

$("#form").addEventListener("submit", (event) => {
  event.preventDefault();
  void save();
});
$("#refetch").addEventListener("click", () => {
  void resolve(true);
  void fetchColor();
});
$("#new-card").addEventListener("click", () => {
  if (confirmDiscard()) loadForm(null);
});
window.addEventListener("beforeunload", (event) => {
  if (dirty) event.preventDefault();
});

// ---------------------------------------------------------------------------------------------------------------

const data = await api<{ categories: Category[]; cards: RawCard[] }>("/data");
categories = data.categories;
cards = data.cards;
buildStatFields();
loadForm(null);
library.input.focus();
requestAnimationFrame(drawPreview);
