import "./style.css";
import { App } from "./app.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
const overlay = document.querySelector<HTMLElement>("#overlay");
if (!canvas || !overlay) throw new Error('Missing <canvas id="game"> or <div id="overlay">');

try {
  new App(canvas, overlay);
} catch (error) {
  // Typically a DeckError from malformed data/*.json; show it instead of a blank page.
  const message = document.createElement("pre");
  message.className = "fatal";
  message.textContent = String(error);
  document.body.replaceChildren(message);
  throw error;
}
