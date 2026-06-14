---
name: Mobile RunContext v2
description: Key design decisions for the expanded Expo mobile RunContext and tab screens
---

# Mobile RunContext v2

## Storage key
`run-calc-mobile-v2` — bumped from v1 when the data model expanded. Any further shape changes must bump to v3 (old data is silently dropped).

## Multi-run shape
State is `{ runs: RunState[], currentIndex: number }` stored as one JSON blob. Max 30 runs matches the web.

## PPM calculation
`crustsPerCycle * cycleSpeed * speedAdjustment` is preferred. Falls back to `lineSpeedPPM` only when `crustsPerCycle === 0`. Both fields are in `RunSettings`.

## Ingredient buffer formula (matches web utils.ts)
```
pizzasForIngredients = pizzasLeft + casesPerLayer * pizzasPerCase
sauceLbs = pizzasForIngredients * sauceOzPerPizza / 16 + 30
appNLbs  = pizzasForIngredients * appNOzPerPizza / 16 + 20
pep1Lbs  = pizzasForIngredients * pep1OzPerPizza / 16 + pep1Sticks
```

## toNum guard
`toNum()` in configure.tsx must accept `string | undefined | null` — Metro can call the component before form state initializes fully, causing a crash if undefined is passed to `String.replace`.

**Why:** First render race between RunContext async load from AsyncStorage and form initial state.
