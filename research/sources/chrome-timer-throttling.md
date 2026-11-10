Source: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
Title: Heavy throttling of chained JS timers beginning in Chrome 88  |  Blog  |  Chrome for Developers
Fetched: 2026-11-10T02:20:53.925Z

[Skip to main content](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#main-content)

[![Chrome for Developers](https://www.gstatic.com/devrel-devsite/prod/v0bdbebc1f01a38de21004f32be4e375582bd633675ce8e19f11ee677174d47b4/chrome/images/lockup.svg)](https://developer.chrome.com/)

`/`

Language

- [English](https://developer.chrome.com/blog/timer-throttling-in-chrome-88)
- [Deutsch](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=de)
- [Español – América Latina](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=es-419)
- [Français](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=fr)
- [Indonesia](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=id)
- [Italiano](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=it)
- [Nederlands](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=nl)
- [Polski](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=pl)
- [Português – Brasil](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=pt-br)
- [Tiếng Việt](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=vi)
- [Türkçe](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=tr)
- [Русский](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=ru)
- [עברית](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=he)
- [العربيّة](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=ar)
- [فارسی](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=fa)
- [हिंदी](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=hi)
- [বাংলা](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=bn)
- [ภาษาไทย](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=th)
- [中文 – 简体](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=zh-cn)
- [中文 – 繁體](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=zh-tw)
- [日本語](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=ja)
- [한국어](https://developer.chrome.com/blog/timer-throttling-in-chrome-88?hl=ko)

Sign in

- [Blog](https://developer.chrome.com/blog)

- On this page
- [Terminology](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#terminology)
  - [Hidden pages](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#hidden_pages)
  - [JavaScript timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#javascript_timers)
  - [Chained timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#chained_timers)
- [How the throttling works](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#how_the_throttling_works)
  - [Minimal throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#minimal_throttling)
  - [Throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#throttling)
  - [Intensive throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#intensive_throttling)
- [Workarounds](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#workarounds)
  - [State polling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#state_polling)
  - [Animation](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#animation)
- [Testing](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#testing)
- [The future](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#the_future)

- [Chrome for Developers](https://developer.chrome.com/)
- [Blog](https://developer.chrome.com/blog)

# Heavy throttling of chained JS timers beginning in Chrome 88    Stay organized with collections      Save and categorize content based on your preferences.

- On this page
- [Terminology](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#terminology)
  - [Hidden pages](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#hidden_pages)
  - [JavaScript timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#javascript_timers)
  - [Chained timers](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#chained_timers)
- [How the throttling works](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#how_the_throttling_works)
  - [Minimal throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#minimal_throttling)
  - [Throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#throttling)
  - [Intensive throttling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#intensive_throttling)
- [Workarounds](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#workarounds)
  - [State polling](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#state_polling)
  - [Animation](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#animation)
- [Testing](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#testing)
- [The future](https://developer.chrome.com/blog/timer-throttling-in-chrome-88#the_future)

![Jake Archibald](https://web.dev/images/authors/jakearchibald.jpg)


Jake Archibald


[X](https://twitter.com/jaffathecake) [Homepage](https://jakearchibald.com/)

Chrome 88 (January 2021) will heavily throttle chained JavaScript timers for
hidden pages in particular conditions. This will reduce CPU usage, which will
also reduce battery usage. There are some edge cases where this will change
behavior, but timers are often used where a different API would be more
efficient, and more reliable.

OK, that was pretty jargon heavy, and a bit ambiguous. Let's dig in…

## Terminology

### Hidden pages

Generally, _hidden_ means a different tab is active, or the window has been
minimized, but browsers may consider a page hidden whenever its content is
totally not-visible. Some browsers go further than others here, but you can
always use the [page visibility API](https://developer.mozilla.org/docs/Web/API/Page_Visibility_API) to
track when the browser thinks visibility has changed.

### JavaScript timers

By _JavaScript timers_ I mean `setTimeout` and `setInterval`, which allow you to
schedule a callback sometime in the future. Timers are useful, and they aren't
going away, but sometimes they're used to poll state when an event would be more
efficient, and more accurate.

### Chained timers

If you call `setTimeout` in the same task as a `setTimeout` callback, the second
invocation is 'chained'. With `setInterval`, each iteration is part of the
_chain_. This might be easier to understand with code:

```
let chainCount = 0;

setInterval(() => {
  chainCount++;
  console.log(`This is number ${chainCount} in the chain`);
}, 500);
```

And:

```
let chainCount = 0;

function setTimeoutChain() {
  setTimeout(() => {
    chainCount++;
    console.log(`This is number ${chainCount} in the chain`);
    setTimeoutChain();
  }, 500);
}
```

## How the throttling works

The throttling happens in stages:

### Minimal throttling

This happens to timers that are scheduled when _any_ of the following is true:

- The page is _visible_.
- The page has made noises in the past 30 seconds. This can be from any of the
sound-making APIs, but a silent audio track doesn't count.

The timer isn't throttled, unless the requested timeout is less than 4ms, and
the chain count is 5 or greater, in which case the timeout is set to 4ms. This
isn't new; browsers have done this for many years.

### Throttling

This happens to timers that are scheduled when _minimal throttling_ doesn't
apply, and _any_ of the following is true:

- The _chain count_ is less than 5.
- The page has been _hidden_ for less than 5 minutes.
- WebRTC is in use. Specifically, there's an `RTCPeerConnection` with an 'open'
`RTCDataChannel` or a 'live' `MediaStreamTrack`.

The browser will check timers in this group once per **second**. Because they're
only checked once per second, timers with a similar timeout will batch together,
consolidating the time the tab needs to run code. This isn't new either;
browsers have been doing this to some extent for years.

### Intensive throttling

OK, here's the new bit in Chrome 88. Intensive throttling happens to timers that are
scheduled when none of the _minimal throttling_ or _throttling_ conditions
apply, and _all_ of the following conditions are true:

- The page has been _hidden_ for more than 5 minutes.
- The _chain count_ is 5 or greater.
- The page has been silent for at least 30 seconds.
- WebRTC is not in use.

In this case, the browser will check timers in this group once per **minute**.
Similar to before, this means timers will batch together in these
minute-by-minute checks.

## Workarounds

There's usually a better alternative to a timer, or timers can be combined with
something else to be kinder to CPUs and battery life.

### State polling

This is the most common (mis)use of timers, where they're used to continually
check or [poll](https://en.wikipedia.org/wiki/Polling_%28computer_science%29)
to see if something has changed. In most cases there's a
[push](https://en.wikipedia.org/wiki/Push_technology) equivalent, where the
thing tells you about the change when it happens, so you don't have to keep
checking. Look to see if there's an event that achieves the same thing.

Some examples:

- If you need to know when an element enters in the viewport, use
[`IntersectionObserver`](https://developer.mozilla.org/docs/Web/API/Intersection_Observer_API).
- If you need to know when an element changes size, use
[`ResizeObserver`](https://web.dev/articles/resize-observer).
- If you need to know when the DOM changes, use
[`MutationObserver`](https://developer.mozilla.org/docs/Web/API/MutationObserver),
or maybe [custom element lifecycle callbacks](https://developer.mozilla.org/docs/Web/Web_Components/Using_custom_elements).
- Rather than poll a server, consider [web sockets](https://developer.mozilla.org/docs/Web/API/WebSockets_API),
[server-sent events](https://developer.mozilla.org/docs/Web/API/EventSource), [push messages](https://developer.mozilla.org/docs/Web/API/Push_API), or
[fetch streams](https://web.dev/articles/fetch-upload-streaming#previously_on_the_exciting_adventures_of_fetch_streams).
- If you need to react to stage changes in audio/video, [use events like `timeupdate` and `ended`](https://html.spec.whatwg.org/multipage/media.html#mediaevents), or
[`requestVideoFrameCallback`](https://web.dev/articles/requestvideoframecallback-rvfc)
if you need to do something with each frame.

There's also [notification triggers](https://developer.chrome.com/docs/web-platform/notification-triggers) if
you want to show a notification at a particular time.

### Animation

Animation is a visual thing, so it shouldn't use CPU time when the page is _hidden_.

[`requestAnimationFrame`](https://developer.mozilla.org/docs/Web/API/window/requestAnimationFrame)
is much better at scheduling animation work than JavaScript timers. It
synchronizes with the refresh rate of the device, ensuring you only get one
callback per displayable frame, and you get the maximum amount of time to
construct that frame. Also, `requestAnimationFrame` will wait for the page to be
visible, so it doesn't use any CPU when the page is hidden.

If you can declare your whole animation up-front, consider using [CSS animations](https://developer.mozilla.org/docs/Web/CSS/animation) or the
[web animations API](https://developer.mozilla.org/docs/Web/API/Web_Animations_API). These
have the same advantages as `requestAnimationFrame`, but the browser can perform
additional optimizations like automatic compositing, and they're generally
easier to use.

If your animation is low-framerate (like a blinking cursor), timers are still
the best option right now, but you can combine them with `requestAnimationFrame`
to get the best of both worlds:

```
function animationInterval(ms, signal, callback) {
  const start = document.timeline.currentTime;

  function frame(time) {
    if (signal.aborted) return;
    callback(time);
    scheduleFrame(time);
  }

  function scheduleFrame(time) {
    const elapsed = time - start;
    const roundedElapsed = Math.round(elapsed / ms) * ms;
    const targetNext = start + roundedElapsed + ms;
    const delay = targetNext - performance.now();
    setTimeout(() => requestAnimationFrame(frame), delay);
  }

  scheduleFrame(start);
}
```

Usage:

```
const controller = new AbortController();

// Create an animation callback every second:
animationInterval(1000, controller.signal, time => {
  console.log('tick!', time);
});

// And stop it:
controller.abort();
```

## Testing

This change will be enabled for all Chrome users in Chrome 88 (January 2021).
It's currently enabled for 50% of Chrome Beta, Dev, and Canary users.
If you want to test it, use this command line flag when launching Chrome
Beta, Dev, or Canary:

```
--enable-features="IntensiveWakeUpThrottling:grace_period_seconds/10,OptOutZeroTimeoutTimersFromThrottling,AllowAggressiveThrottlingWithWebSocket"
```

The `grace_period_seconds/10` argument causes intense throttling to kick in
after 10 seconds of the page being hidden, rather than the full 5 minutes,
making it easier to see the impact of the throttling.

## The future

Since timers are a source of excessive CPU use, we're going to continue to look at
ways we can throttle them without breaking web content, and APIs we can
add/change to meet use-cases. Personally, I'd like to eliminate the need for
`animationInterval` in favor of efficient low-frequency animation callbacks. If
you have any questions, please [reach out to me on Twitter](https://twitter.com/jaffathecake/)!

Header photo by [Heather Zabriskie](https://unsplash.com/@heatherz) on
[Unsplash](https://unsplash.com/photos/yBzrPGLjMQw).

Except as otherwise noted, the content of this page is licensed under the [Creative Commons Attribution 4.0 License](https://creativecommons.org/licenses/by/4.0/), and code samples are licensed under the [Apache 2.0 License](https://www.apache.org/licenses/LICENSE-2.0). For details, see the [Google Developers Site Policies](https://developers.google.com/site-policies). Java is a registered trademark of Oracle and/or its affiliates.

Last updated 2021-01-18 UTC.




\[\[\["Easy to understand","easyToUnderstand","thumb-up"\],\["Solved my problem","solvedMyProblem","thumb-up"\],\["Other","otherUp","thumb-up"\]\],\[\["Missing the information I need","missingTheInformationINeed","thumb-down"\],\["Too complicated / too many steps","tooComplicatedTooManySteps","thumb-down"\],\["Out of date","outOfDate","thumb-down"\],\["Samples / code issue","samplesCodeIssue","thumb-down"\],\["Other","otherDown","thumb-down"\]\],\["Last updated 2021-01-18 UTC."\],\[\],\[\]\]