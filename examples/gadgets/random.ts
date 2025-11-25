import { z } from "zod";
import { createGadget } from "../../src/index.js";

export const randomNumber = createGadget({
  name: "RandomNumber",
  description: "Generates a random number between min and max (inclusive)",
  schema: z.object({
    min: z.number().default(1).describe("Minimum value (default: 1)"),
    max: z.number().default(100).describe("Maximum value (default: 100)"),
  }),
  execute: ({ min, max }) => {
    const result = Math.floor(Math.random() * (max - min + 1)) + min;
    return String(result);
  },
});

export const coinFlip = createGadget({
  name: "CoinFlip",
  description: "Flips a coin and returns heads or tails",
  schema: z.object({}),
  execute: () => {
    return Math.random() < 0.5 ? "heads" : "tails";
  },
});

export const diceRoll = createGadget({
  name: "DiceRoll",
  description: "Rolls dice and returns the result",
  schema: z.object({
    sides: z.number().default(6).describe("Number of sides on the die (default: 6)"),
    count: z.number().default(1).describe("Number of dice to roll (default: 1)"),
  }),
  execute: ({ sides, count }) => {
    const rolls: number[] = [];
    for (let i = 0; i < count; i++) {
      rolls.push(Math.floor(Math.random() * sides) + 1);
    }
    const total = rolls.reduce((a, b) => a + b, 0);
    return count === 1 ? String(rolls[0]) : `Rolled: ${rolls.join(", ")} (total: ${total})`;
  },
});
