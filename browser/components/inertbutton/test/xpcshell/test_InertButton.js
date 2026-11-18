/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const {
  InertActionRegistry,
  InertActionStrategy,
  InertActivationContext,
  InertButton,
  InertButtonConstants,
  InertButtonIllegalTransitionError,
  InertButtonState,
  InertButtonStateMachine,
  NullActionStrategy,
} = ChromeUtils.importESModule(
  "moz-src:///browser/components/inertbutton/InertButton.sys.mjs"
);

const EXPECTED_LIFECYCLE = [
  InertButtonState.DORMANT,
  InertButtonState.RECEIVING,
  InertButtonState.VALIDATING,
  InertButtonState.DELIBERATING,
  InertButtonState.ABSTAINING,
  InertButtonState.QUIESCING,
  InertButtonState.DORMANT,
];

add_setup(() => {
  Services.prefs.setBoolPref(InertButtonConstants.ENABLED_PREF, true);
  registerCleanupFunction(() => {
    Services.prefs.clearUserPref(InertButtonConstants.ENABLED_PREF);
    InertButton.resetForTesting();
  });
});

add_task(function test_constants_are_frozen() {
  Assert.ok(Object.isFrozen(InertButtonConstants), "Constants are frozen");
  Assert.deepEqual(
    InertButtonConstants.SANCTIONED_SIDE_EFFECTS,
    [],
    "There are no sanctioned side effects"
  );
});

add_task(function test_state_machine_rejects_illegal_transitions() {
  let machine = new InertButtonStateMachine();
  Assert.equal(machine.state, InertButtonState.DORMANT);
  Assert.throws(
    () => machine.transition(InertButtonState.ABSTAINING),
    e => e instanceof InertButtonIllegalTransitionError,
    "Cannot skip straight to abstaining"
  );
  Assert.equal(
    machine.state,
    InertButtonState.DORMANT,
    "State is unchanged after an illegal transition"
  );
});

add_task(function test_registry_is_sealed() {
  let registry = new InertActionRegistry();
  Assert.equal(registry.size, 1, "Exactly one strategy is registered");
  Assert.ok(
    registry.resolve("null") instanceof NullActionStrategy,
    "The null strategy is resolvable"
  );
  Assert.ok(
    registry.resolve("open-new-tab") instanceof NullActionStrategy,
    "Unknown strategies resolve to the null strategy"
  );
  Assert.throws(
    () => registry.register(new NullActionStrategy()),
    /sealed/,
    "No strategy may be added after construction"
  );
});

add_task(function test_registry_rejects_behaviour() {
  class SomethingStrategy extends InertActionStrategy {
    get name() {
      return "something";
    }
    async execute() {
      throw new Error("Something happened");
    }
  }
  let registry = new InertActionRegistry();
  Assert.throws(
    () => registry.register(new SomethingStrategy()),
    /sealed|admissible/,
    "Strategies that do something are rejected"
  );
});

add_task(function test_activation_context_is_immutable() {
  let context = new InertActivationContext({ source: "mouse", sequence: 1 });
  Assert.ok(Object.isFrozen(context), "Context is frozen");
  Assert.ok(Object.isFrozen(context.sideEffects), "Side effects are frozen");
  Assert.equal(context.sideEffects.length, 0, "Context has no side effects");
});

add_task(async function test_activation_follows_full_lifecycle() {
  InertButton.resetForTesting();
  let machine = await InertButton.activate();
  Assert.deepEqual(
    machine.history,
    EXPECTED_LIFECYCLE,
    "Activation walked the full lifecycle"
  );
  Assert.equal(InertButton.activationCount, 1, "One activation was recorded");
});

add_task(async function test_activation_source_classification() {
  Assert.equal(InertButton.classifySource(undefined), "programmatic");
  Assert.equal(InertButton.classifySource({ inputSource: 1 }), "mouse");
  Assert.equal(InertButton.classifySource({ inputSource: 6 }), "keyboard");
  Assert.equal(
    InertButton.classifySource({ sourceEvent: { inputSource: 5 } }),
    "touch"
  );
  Assert.equal(InertButton.classifySource({ inputSource: 42 }), "unknown");
});

add_task(async function test_concurrent_activations_are_coalesced() {
  InertButton.resetForTesting();
  let [first, second] = await Promise.all([
    InertButton.activate(),
    InertButton.activate(),
  ]);
  Assert.deepEqual(first.history, EXPECTED_LIFECYCLE);
  Assert.deepEqual(
    second.history,
    [
      InertButtonState.DORMANT,
      InertButtonState.RECEIVING,
      InertButtonState.QUIESCING,
      InertButtonState.DORMANT,
    ],
    "A second simultaneous activation is coalesced"
  );
  Assert.equal(InertButton.activationCount, 1);
});

add_task(async function test_disabled_pref_short_circuits() {
  InertButton.resetForTesting();
  Services.prefs.setBoolPref(InertButtonConstants.ENABLED_PREF, false);
  let machine = await InertButton.activate();
  Assert.equal(machine.state, InertButtonState.DORMANT);
  Assert.ok(
    !machine.history.includes(InertButtonState.ABSTAINING),
    "A disabled button does not even abstain"
  );
  Assert.equal(InertButton.activationCount, 0);
  Services.prefs.setBoolPref(InertButtonConstants.ENABLED_PREF, true);
});

add_task(async function test_many_activations_do_nothing() {
  InertButton.resetForTesting();
  const ITERATIONS = 1000;
  for (let i = 0; i < ITERATIONS; i++) {
    let machine = await InertButton.activate();
    Assert.equal(machine.state, InertButtonState.DORMANT);
  }
  Assert.equal(InertButton.activationCount, ITERATIONS);
});
