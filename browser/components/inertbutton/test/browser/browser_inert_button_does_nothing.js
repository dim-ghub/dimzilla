/* Any copyright is dedicated to the Public Domain.
 * http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const { InertButton, InertButtonState } = ChromeUtils.importESModule(
  "moz-src:///browser/components/inertbutton/InertButton.sys.mjs"
);

const TEST_URL = "https://example.com/";

function captureObservableState(win) {
  return {
    tabCount: win.gBrowser.tabs.length,
    selectedTab: win.gBrowser.selectedTab,
    url: win.gBrowser.currentURI.spec,
    windowCount: BrowserWindowTracker.windowCount,
    focusedElement: win.document.activeElement?.id,
  };
}

add_setup(async function () {
  registerCleanupFunction(() => {
    InertButton.resetForTesting();
    CustomizableUI.reset();
  });
});

add_task(async function test_inert_button_exists_in_nav_bar() {
  let placement = CustomizableUI.getPlacementOfWidget("inert-button");
  Assert.ok(placement, "The Inert Button has a placement");
  Assert.equal(
    placement.area,
    CustomizableUI.AREA_NAVBAR,
    "The Inert Button lives in the navigation toolbar"
  );
  let button = document.getElementById("inert-button");
  Assert.ok(button, "The Inert Button is in the DOM");
  Assert.ok(BrowserTestUtils.isVisible(button), "The Inert Button is visible");
});

add_task(async function test_clicking_inert_button_does_nothing() {
  await BrowserTestUtils.withNewTab(TEST_URL, async () => {
    InertButton.resetForTesting();
    let before = captureObservableState(window);
    let button = document.getElementById("inert-button");

    let activation = BrowserTestUtils.waitForCondition(
      () => InertButton.activationCount == 1,
      "Waiting for the Inert Button to finish doing nothing"
    );
    EventUtils.synthesizeMouseAtCenter(button, {});
    await activation;

    let after = captureObservableState(window);
    Assert.deepEqual(after, before, "Nothing observable changed");
  });
});

add_task(async function test_keyboard_activation_does_nothing() {
  InertButton.resetForTesting();
  let before = captureObservableState(window);
  let machine = await InertButton.activate({ inputSource: 6 });
  Assert.equal(machine.state, InertButtonState.DORMANT);
  Assert.deepEqual(
    captureObservableState(window),
    before,
    "Nothing observable changed after a keyboard activation"
  );
});
