import type { JsonObject } from "../../domain/types.ts";

/**
 * Fictional placeholder data, shaped like the design's worked example
 * (design.md section 2: a handful of scalar leaves plus a couple of small
 * nested objects and one array, depth three), used to drive the local tree
 * browser before persistence exists (Phase 1 of impl.md). This file is
 * checked into a public repository, so it must never hold real note
 * content — see design.md section 3.3.
 */
export const sampleDocument: JsonObject = {
  "Example URL": "https://example.com/talk?t=1279",
  "Nickname for Forgetting Things": "Mnemosyne",
  club_ids: {
    alex: 30976537,
    sam: 566008093,
  },
  hardinfo: "The ultimate system information viewer",
  "head-to-head":
    "https://example.com/stats?memid=<player1>&ptype=O&rs=R&drill=<player2>",
  mtPaint: "MS Paint workalike",
  "on-call": "555-010-0100",
  tips: {
    bash: {
      "!<arg>:p": "Searches history but doesn't execute match",
      fc: "Puts recent history in editor",
    },
    python: {
      functions: "Put them in __init__.py rather than as static methods",
    },
  },
  league_ids: {
    "Ann Example": 12663913,
    "Cy Example": 13214962,
    Jo: 12877028,
    Mo: 31907100,
    Pat: 12910923,
    Robin: 32361943,
  },
  "where-was-i": "Added unit tests to move toward 100% coverage",
  "with-rating": [
    "#! /bin/bash",
    "htmldir=~/Desktop/rating_test_coverage",
    "pytest -v --cov=rating --cov-report=html:${htmldir}",
  ],
  yelp: "GNOME help system",
  zenity: "Dialogs in shell scripts",
};
