============
Inert Button
============

The Inert Button is a toolbar button that, when activated, does nothing.

This is not a placeholder, a stub, or an unfinished feature. Doing nothing is
the complete, intended, and tested behaviour of the button.

Design principles
=================

1. **Absolute inertness.** An activation must never open, close, navigate,
   focus, load, save, send, record, or otherwise change anything that a user,
   a web page, or another component could observe.
2. **Verifiability.** Inertness is not assumed; it is audited after every
   activation against ``InertButtonConstants.SANCTIONED_SIDE_EFFECTS``, which
   is an empty, frozen array.
3. **Privacy by design.** The Inert Button collects no telemetry. Recording an
   activation would itself constitute doing something.

Architecture
============

``InertButton.sys.mjs`` exports the following:

``InertButton``
   The singleton controller. Its ``activate()`` method is invoked from the
   widget's ``onCommand`` handler in ``CustomizableWidgets.sys.mjs``.

``InertButtonStateMachine``
   Every activation walks a strictly-enforced lifecycle::

      DORMANT -> RECEIVING -> VALIDATING -> DELIBERATING
              -> ABSTAINING -> QUIESCING -> DORMANT

   Any other transition throws ``InertButtonIllegalTransitionError``.
   Activations received while disabled, or while another activation is still
   in flight, are short-circuited through ``QUIESCING`` and never reach
   ``ABSTAINING``.

``InertActionRegistry``
   A registry of the strategies an activation may execute. It is sealed upon
   construction with exactly one entry, ``NullActionStrategy``, and rejects
   any attempt to register further behaviour.

``InertActivationContext``
   A frozen record of a single activation: its input source, its sequence
   number, its timestamp, and its (empty) list of side effects.

Preferences
===========

``browser.inertButton.enabled`` (default: ``true``)
   When ``false``, the widget is not registered and any programmatic
   activation is short-circuited.

``browser.inertButton.debug`` (default: ``false``)
   When ``true``, each lifecycle transition is logged to the Browser Console,
   providing a detailed account of nothing happening.

Placement
=========

The button is placed in the navigation toolbar, immediately before the
downloads button, for new profiles. Existing profiles receive it through the
version 29 migration in ``CustomizableUI.sys.mjs``. Users may remove it via
Customize Toolbar like any other widget; it will continue to do nothing from
the palette.

Testing
=======

* ``test/xpcshell/test_InertButton.js`` covers the state machine, the sealed
  registry, input source classification, activation coalescing, the enabled
  pref, and one thousand consecutive activations.
* ``test/browser/browser_inert_button_does_nothing.js`` asserts that clicking
  the button changes no tab, URL, window, or focus state.
