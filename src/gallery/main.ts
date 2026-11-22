// Card gallery (cards.html): every card in a scrollable grid with a live search. Cards show the in-game values
// and turn to their info side (keywords + summary) on hover, or on tap on touch screens.
import rawCards from "../../data/cards.json";
import rawCategories from "../../data/categories.json";
import { parseCards, parseCategories } from "../game/deck.ts";
import { playedCard, type Card } from "../game/model.ts";
import { openUrl, REPO_URL } from "../links.ts";
import { isTouchDevice } from "../platform.ts";
import { CARD_H, CARD_W, CardRenderer } from "../render/cardView.ts";
import { ImageStore } from "../render/images.ts";
import { searchCards, sortEntries, type SearchEntry } from "./search.ts";
import "./gallery.css";

const FLIP_SPEED = 2.5; // turns per second, as on the title screen

type Side = 1 | 2;

interface Tile extends SearchEntry {
  /** The card as drawn: `played` (rounded as in the game) or `exact`. */
  card: Card;
  played: Card;
  exact: Card;
  element: HTMLDivElement;
  canvas: HTMLCanvasElement;
  /** 1 = values, 2 = info side; animated towards `target()`. */
  turn: number;
  hovered: boolean;
  /** Side fixed by a click or tap; hovering has no effect then. */
  pinned: Side | null;
}

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
const grid = $("#grid");
const search = $<HTMLInputElement>("#search");
const count = $("#count");
const empty = $("#empty");
$<HTMLAnchorElement>("#repo-link").href = REPO_URL;

const exactToggle = $<HTMLInputElement>("#exact");
const valuesNote = $("#values-note");
const touch = isTouchDevice();

// Exact values as stored, plus the rounded ones the game plays with; package and repo only live in the raw JSON.
const categories = parseCategories(rawCategories);
const exactCards = parseCards(rawCards, categories);
const ids = new Map(
  (rawCards as { cards: { library: string; pypi?: string | null; repo?: string | null }[] }).cards.map((c) => [c.library, c]),
);

const target = (tile: Tile): Side => tile.pinned ?? (tile.hovered ? 2 : 1);

function draw(tile: Tile): void {
  const { canvas } = tile;
  if (canvas.width === 0) return;
  const ctx = canvas.getContext("2d")!;
  const scale = canvas.width / CARD_W;
  // The width follows |cos| to fake the 3D flip, like the cards in the game.
  const squash = Math.abs(Math.cos(Math.PI * tile.turn));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale * squash, 0, 0, scale, (canvas.width * (1 - squash)) / 2, 0);
  if (tile.turn >= 1.5) renderer.drawInfo(ctx, tile.card);
  else renderer.drawFront(ctx, tile.card, { highlight: null, outcome: null, hover: null });
}

function resize(tile: Tile): void {
  const density = window.devicePixelRatio || 1;
  const width = Math.round(tile.canvas.clientWidth * density);
  if (width === 0 || width === tile.canvas.width) return;
  tile.canvas.width = width;
  tile.canvas.height = Math.round((width * CARD_H) / CARD_W);
  draw(tile);
}

// One animation loop for all cards, running only while some card is turning.
let lastTime: number | null = null;
function animate(time: number): void {
  const dt = lastTime === null ? 0 : Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  let moving = false;
  for (const tile of tiles) {
    const goal = target(tile);
    if (tile.turn === goal) continue;
    const step = FLIP_SPEED * dt;
    tile.turn = tile.turn < goal ? Math.min(tile.turn + step, goal) : Math.max(tile.turn - step, goal);
    draw(tile);
    moving = true;
  }
  if (moving) requestAnimationFrame(animate);
  else lastTime = null;
}
const startAnimation = () => {
  if (lastTime === null) requestAnimationFrame(animate);
};

/** The homepage link under the library name, only on a fully turned info side. */
function linkAt(tile: Tile, event: MouseEvent): string | null {
  if (!tile.card.url || tile.turn !== 2) return null;
  const box = tile.canvas.getBoundingClientRect();
  const p = { x: ((event.clientX - box.left) / box.width) * CARD_W, y: ((event.clientY - box.top) / box.height) * CARD_H };
  return renderer.infoLinkAt(tile.card, p) ? tile.card.url : null;
}

function createTile(exact: Card): Tile {
  const card = playedCard(exact, categories);
  const element = document.createElement("div");
  element.className = "card";
  element.tabIndex = 0;
  element.setAttribute("role", "button");
  element.setAttribute("aria-label", `${card.library}: turn the card`);
  const canvas = document.createElement("canvas");
  element.append(canvas);
  const raw = ids.get(card.library);
  const tile: Tile = {
    card,
    played: card,
    exact,
    element,
    canvas,
    turn: 1,
    hovered: false,
    pinned: null,
    library: card.library,
    pypi: raw?.pypi ?? null,
    repo: raw?.repo ?? null,
    url: card.url,
    keywords: card.keywords,
    summary: card.summary,
  };
  // With a mouse, hovering already turned the card, so a click keeps the side it is turning to (or lets go again).
  // Touch and keyboard have no hover: there a tap or Enter turns the card itself.
  const pinCurrentSide = () => {
    tile.pinned = tile.pinned === null ? target(tile) : null;
    startAnimation();
  };
  const turn = () => {
    tile.pinned = target(tile) === 2 ? 1 : 2;
    startAnimation();
  };
  let pointerType = "";
  element.addEventListener("pointerdown", (e) => (pointerType = e.pointerType));
  // Mouse only: a tap also fires pointerenter, and there the tap itself turns the card.
  element.addEventListener("pointerenter", (e) => {
    if (e.pointerType !== "mouse") return;
    tile.hovered = true;
    startAnimation();
  });
  element.addEventListener("pointerleave", (e) => {
    if (e.pointerType !== "mouse") return;
    tile.hovered = false;
    startAnimation();
  });
  element.addEventListener("click", (e) => {
    const link = linkAt(tile, e);
    if (link) openUrl(link);
    else if (pointerType === "mouse") pinCurrentSide();
    else turn();
  });
  element.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    turn();
  });
  return tile;
}

const tiles = exactCards.map(createTile);
const byLibrary = new Map(tiles.map((t) => [t.card.library, t]));
const images = new ImageStore();
const renderer = new CardRenderer(categories, images);
images.load(exactCards, (card) => {
  const tile = byLibrary.get(card.library);
  if (tile) draw(tile);
});

const observer = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const tile = tiles.find((t) => t.canvas === entry.target);
    if (tile) resize(tile);
  }
});
for (const tile of tiles) observer.observe(tile.canvas);

// "match": best search hit first (A to Z without a search), "name", or a category label.
const sortKey = $<HTMLSelectElement>("#sort-key");
const sortDir = $<HTMLButtonElement>("#sort-dir");
for (const category of categories) sortKey.append(new Option(category.label, category.label));
let descending = false;

function showSortDirection(): void {
  sortDir.disabled = sortKey.value === "match";
  sortDir.textContent = descending ? "↓ Desc" : "↑ Asc";
  sortDir.setAttribute("aria-label", descending ? "Sorted descending" : "Sorted ascending");
}

function showResults(): void {
  const query = search.value.trim();
  const found = searchCards(tiles, query);
  const key = sortKey.value;
  // Category sorts use the exact values, so cards that look equal after rounding still come in their real order.
  const shown =
    key === "match" ? found : sortEntries(found, key === "name" ? null : (t) => t.exact.stats[key]!, descending);
  grid.replaceChildren(...shown.map((t) => t.element));
  empty.hidden = shown.length > 0;
  count.textContent = query ? `${shown.length} of ${tiles.length} cards` : `${tiles.length} cards`;
}

function showValues(): void {
  const exact = exactToggle.checked;
  valuesNote.textContent = exact ? "As stored" : "Rounded as in the game";
  for (const tile of tiles) {
    tile.card = exact ? tile.exact : tile.played;
    draw(tile);
  }
}
exactToggle.addEventListener("change", showValues);

sortKey.addEventListener("change", () => {
  // Highest values first is what you usually want for a category; names start at A.
  descending = sortKey.value !== "name";
  showSortDirection();
  showResults();
});
sortDir.addEventListener("click", () => {
  descending = !descending;
  showSortDirection();
  showResults();
});
showSortDirection();

search.addEventListener("input", showResults);
search.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && search.value) {
    search.value = "";
    showResults();
  }
});
showResults();
// Typing right away on desktop; on phones the keyboard would cover the cards.
if (!touch) search.focus();
