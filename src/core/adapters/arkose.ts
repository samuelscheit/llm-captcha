import type { AdapterSpec } from "../types";

/** The game frame; its host varies per customer (client-api., gitlab-api., …). */
const GAME = String.raw`arkoselabs\.com/fc/assets/ec-game-core/game-core/`;

/** Arkose Labs / FunCaptcha: a start screen, then "use the arrows" games answered per stage. */
export const ARKOSE: AdapterSpec[] = [
  {
    id: "arkose-start",
    kind: "checkbox",
    url: GAME,
    root: ".screen.home",
    targets: [{ id: "checkbox", selector: ".screen.home button" }],
  },
  {
    // One stage: pick the option (carousel, arrows) that matches the reference image, submit.
    // Correctness is only revealed after all stages; a failure offers "Try again".
    id: "arkose-game",
    kind: "select",
    url: GAME,
    root: ".screen.match-game, .screen.match-game-fail",
    instruction: ["h2"],
    errors: ["h2.match-game-alert"],
    solved: ".screen.victory",
    waiting: ".screen.progress",
    carousel: { options: "pip", next: "right", submit: "submit" },
    targets: [
      { id: "pip", selector: ".pip", all: true, optional: true, selected: ".pip.active" },
      { id: "left", selector: ".answer-frame .left-arrow", optional: true },
      { id: "right", selector: ".answer-frame .right-arrow", optional: true },
      { id: "submit", selector: ".screen button.button", labelFromText: true },
    ],
  },
];
