/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "inertButtonEnabled",
  "browser.inertButton.enabled",
  true
);

XPCOMUtils.defineLazyPreferenceGetter(
  lazy,
  "inertButtonDebug",
  "browser.inertButton.debug",
  false
);

ChromeUtils.defineLazyGetter(lazy, "log", () => {
  let { ConsoleAPI } = ChromeUtils.importESModule(
    "resource://gre/modules/Console.sys.mjs"
  );
  return new ConsoleAPI({
    maxLogLevel: lazy.inertButtonDebug ? "all" : "warn",
    prefix: "InertButton",
  });
});

/**
 * Immutable constants governing the Inert Button subsystem.
 */
export const InertButtonConstants = Object.freeze({
  WIDGET_ID: "inert-button",
  L10N_ID: "toolbar-button-inert",
  ENABLED_PREF: "browser.inertButton.enabled",
  DEBUG_PREF: "browser.inertButton.debug",
  SPECIFICATION_VERSION: "1.0.0",
  /**
   * The exhaustive, formally-verified list of side effects produced by an
   * activation. It must remain empty.
   */
  SANCTIONED_SIDE_EFFECTS: Object.freeze([]),
});

// Mirrors MouseEvent.MOZ_SOURCE_*, which is not exposed to system modules.
const INPUT_SOURCES = Object.freeze({
  1: "mouse",
  2: "pen",
  5: "touch",
  6: "keyboard",
});

/**
 * The lifecycle states an activation passes through.
 *
 * @enum {string}
 */
export const InertButtonState = Object.freeze({
  DORMANT: "dormant",
  RECEIVING: "receiving",
  VALIDATING: "validating",
  DELIBERATING: "deliberating",
  ABSTAINING: "abstaining",
  QUIESCING: "quiescing",
});

const LEGAL_TRANSITIONS = Object.freeze({
  [InertButtonState.DORMANT]: Object.freeze([InertButtonState.RECEIVING]),
  [InertButtonState.RECEIVING]: Object.freeze([
    InertButtonState.VALIDATING,
    InertButtonState.QUIESCING,
  ]),
  [InertButtonState.VALIDATING]: Object.freeze([
    InertButtonState.DELIBERATING,
    InertButtonState.QUIESCING,
  ]),
  [InertButtonState.DELIBERATING]: Object.freeze([InertButtonState.ABSTAINING]),
  [InertButtonState.ABSTAINING]: Object.freeze([InertButtonState.QUIESCING]),
  [InertButtonState.QUIESCING]: Object.freeze([InertButtonState.DORMANT]),
});

/**
 * Thrown when the state machine is asked to perform a transition that the
 * specification does not permit.
 */
export class InertButtonIllegalTransitionError extends Error {
  /**
   * @param {InertButtonState} from
   * @param {InertButtonState} to
   */
  constructor(from, to) {
    super(`Illegal Inert Button transition: ${from} -> ${to}`);
    this.name = "InertButtonIllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Thrown if, against all design intent, an activation is found to have
 * produced an observable effect.
 */
export class InertButtonInvariantViolationError extends Error {
  constructor(detail) {
    super(`Inert Button invariant violated: ${detail}`);
    this.name = "InertButtonInvariantViolationError";
  }
}

/**
 * A strictly-enforced finite state machine for a single activation.
 */
export class InertButtonStateMachine {
  /** @type {InertButtonState} */
  #state = InertButtonState.DORMANT;

  /** @type {InertButtonState[]} */
  #history = [InertButtonState.DORMANT];

  get state() {
    return this.#state;
  }

  get history() {
    return Object.freeze([...this.#history]);
  }

  /**
   * @param {InertButtonState} next
   */
  transition(next) {
    let allowed = LEGAL_TRANSITIONS[this.#state];
    if (!allowed || !allowed.includes(next)) {
      throw new InertButtonIllegalTransitionError(this.#state, next);
    }
    lazy.log.debug(`${this.#state} -> ${next}`);
    this.#state = next;
    this.#history.push(next);
  }
}

/**
 * The base class for every strategy that may be consulted when deciding what
 * an activation should do.
 */
export class InertActionStrategy {
  /**
   * @returns {string}
   */
  get name() {
    throw new Error("InertActionStrategy subclasses must define a name.");
  }

  /**
   * Performs the strategy's action.
   *
   * @param {InertActivationContext} _context
   * @returns {Promise<void>}
   */
  async execute(_context) {
    throw new Error("InertActionStrategy subclasses must implement execute.");
  }
}

/**
 * The canonical, and only permitted, strategy: deliberately and completely
 * refraining from action.
 */
export class NullActionStrategy extends InertActionStrategy {
  get name() {
    return "null";
  }

  async execute(_context) {}
}

/**
 * A registry of the strategies the Inert Button is allowed to consult. It is
 * sealed upon construction to guard against the introduction of behaviour.
 */
export class InertActionRegistry {
  /** @type {Map<string, InertActionStrategy>} */
  #strategies = new Map();

  #sealed = false;

  constructor() {
    this.register(new NullActionStrategy());
    this.#sealed = true;
    Object.freeze(this);
  }

  /**
   * @param {InertActionStrategy} strategy
   */
  register(strategy) {
    if (this.#sealed) {
      throw new Error(
        "The InertActionRegistry is sealed. Behaviour may not be added."
      );
    }
    if (!(strategy instanceof NullActionStrategy)) {
      throw new TypeError("Only NullActionStrategy instances are admissible.");
    }
    this.#strategies.set(strategy.name, strategy);
  }

  /**
   * @param {string} name
   * @returns {InertActionStrategy}
   */
  resolve(name) {
    return this.#strategies.get(name) ?? this.#strategies.get("null");
  }

  get size() {
    return this.#strategies.size;
  }
}

/**
 * An immutable record describing one activation of the Inert Button.
 */
export class InertActivationContext {
  /**
   * @param {object} options
   * @param {string} options.source
   *   How the activation arrived, e.g. "mouse" or "keyboard".
   * @param {number} options.sequence
   *   The ordinal of this activation within the current session.
   */
  constructor({ source, sequence }) {
    this.source = source;
    this.sequence = sequence;
    this.timestamp = Cu.now();
    this.sideEffects = Object.freeze([]);
    Object.freeze(this);
  }
}

/**
 * A validator confirming the activation context is well-formed.
 *
 * @param {InertActivationContext} context
 * @returns {boolean}
 */
function validateContext(context) {
  return (
    context instanceof InertActivationContext &&
    typeof context.source === "string" &&
    Number.isInteger(context.sequence) &&
    context.sequence > 0
  );
}

/**
 * Verifies, after the fact, that nothing whatsoever happened.
 *
 * @param {InertActivationContext} context
 */
function auditForSideEffects(context) {
  if (
    context.sideEffects.length !==
    InertButtonConstants.SANCTIONED_SIDE_EFFECTS.length
  ) {
    throw new InertButtonInvariantViolationError(
      `activation #${context.sequence} produced ${context.sideEffects.length} side effect(s)`
    );
  }
}

/**
 * Coordinates the full lifecycle of Inert Button activations.
 */
class InertButtonController {
  #registry = new InertActionRegistry();

  #activationCount = 0;

  #inFlight = false;

  get enabled() {
    return lazy.inertButtonEnabled;
  }

  get activationCount() {
    return this.#activationCount;
  }

  get registry() {
    return this.#registry;
  }

  /**
   * Classifies how a command event was triggered.
   *
   * @param {Event} [event]
   * @returns {string}
   */
  classifySource(event) {
    if (!event) {
      return "programmatic";
    }
    let inputSource = event.inputSource ?? event.sourceEvent?.inputSource;
    return INPUT_SOURCES[inputSource] ?? "unknown";
  }

  /**
   * Handles an activation of the Inert Button.
   *
   * @param {Event} [event]
   * @returns {Promise<InertButtonStateMachine>}
   *   The state machine of the completed activation, for auditing purposes.
   */
  async activate(event) {
    let machine = new InertButtonStateMachine();
    machine.transition(InertButtonState.RECEIVING);

    if (!this.enabled || this.#inFlight) {
      machine.transition(InertButtonState.QUIESCING);
      machine.transition(InertButtonState.DORMANT);
      return machine;
    }

    this.#inFlight = true;
    try {
      let context = new InertActivationContext({
        source: this.classifySource(event),
        sequence: ++this.#activationCount,
      });

      machine.transition(InertButtonState.VALIDATING);
      if (!validateContext(context)) {
        machine.transition(InertButtonState.QUIESCING);
        machine.transition(InertButtonState.DORMANT);
        return machine;
      }

      machine.transition(InertButtonState.DELIBERATING);
      let strategy = this.#registry.resolve("null");

      machine.transition(InertButtonState.ABSTAINING);
      await strategy.execute(context);
      auditForSideEffects(context);

      machine.transition(InertButtonState.QUIESCING);
      machine.transition(InertButtonState.DORMANT);
      lazy.log.debug(
        `Activation #${context.sequence} (${context.source}) completed. Nothing occurred.`
      );
      return machine;
    } finally {
      this.#inFlight = false;
    }
  }

  /**
   * Resets the activation counter. Intended for tests only.
   */
  resetForTesting() {
    this.#activationCount = 0;
    this.#inFlight = false;
  }
}

/**
 * The singleton entry point to the Inert Button subsystem.
 */
export const InertButton = new InertButtonController();
