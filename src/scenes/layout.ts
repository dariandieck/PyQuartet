import { centeredRect, type Point, type Rect } from "../render/draw.ts";

export interface SeatLayout {
  pile: Point;
  pileScale: number;
  hand: Point;
  handScale: number;
  table: Point;
}

export interface TableLayout {
  seats: Map<number, SeatLayout>;
  pot: Point;
  potScale: number;
  tableArea: Rect;
  tableScale: number;
}

const POT: Point = { x: 1160, y: 345 };
const OWN_PILE: Point = { x: 120, y: 545 };
const OWN_HAND: Point = { x: 640, y: 555 };

/**
 * Seat positions for 2–4 players. The local player always sits at the bottom; opponents keep the same
 * clockwise order on every screen (the players after you, then the ones before you).
 */
export function computeLayout(seatIds: number[], youId: number): TableLayout {
  const index = seatIds.indexOf(youId);
  const opponents = [...seatIds.slice(index + 1), ...seatIds.slice(0, index)];
  const seats = new Map<number, SeatLayout>();

  if (opponents.length <= 1) {
    // Two players: the original one-on-one table.
    seats.set(youId, { pile: OWN_PILE, pileScale: 0.5, hand: OWN_HAND, handScale: 1, table: { x: 520, y: 330 } });
    if (opponents[0] !== undefined) {
      seats.set(opponents[0], {
        pile: { x: 120, y: 175 },
        pileScale: 0.5,
        hand: { x: 640, y: 120 },
        handScale: 0.6,
        table: { x: 760, y: 330 },
      });
    }
    return { seats, pot: POT, potScale: 0.5, tableArea: centeredRect(640, 330, 580, 330), tableScale: 0.9 };
  }

  // Three or four players: opponents side by side along the top, each with pile + hand.
  const tableScale = opponents.length === 2 ? 0.8 : 0.72;
  const spacing = opponents.length === 2 ? 200 : 180;
  const tableOrder = [youId, ...opponents];
  const tableX = (i: number) => 640 + (i - (tableOrder.length - 1) / 2) * spacing;
  const tableY = 350;

  seats.set(youId, { pile: OWN_PILE, pileScale: 0.5, hand: OWN_HAND, handScale: 1, table: { x: tableX(0), y: tableY } });
  opponents.forEach((id, j) => {
    const slotX = (1280 * (j + 1)) / (opponents.length + 1);
    seats.set(id, {
      pile: { x: slotX - 75, y: 100 },
      pileScale: 0.4,
      hand: { x: slotX + 55, y: 105 },
      handScale: 0.55,
      table: { x: tableX(j + 1), y: tableY },
    });
  });
  const width = tableOrder.length * spacing + 40;
  return { seats, pot: POT, potScale: 0.5, tableArea: centeredRect(640, tableY, width, 300), tableScale };
}
