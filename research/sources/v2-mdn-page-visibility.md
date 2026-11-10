Source: https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API
Title: Page Visibility API - Web APIs | MDN
Fetched: 2026-11-10T02:24:19.561Z

- [Skip to main content](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#content)
- [Skip to search](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#mdn-search)

Learn frontend, backend, and AI from our course partner
[Scrimba](https://scrimba.com/learn/frontend?via=mdn)

# Page Visibility API

Baseline


Widely available

This feature is well established and works across many devices and browser versions. It’s been available across browsers since July 2015.

- [See full compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#browser_compatibility)
- [Learn more](https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility)

The Page Visibility API provides events you can watch for to know when a document becomes visible or hidden, as well as features to look at the current visibility state of the page.

This is especially useful for saving resources and improving performance by letting a page avoid performing unnecessary tasks when the document isn't visible.

## [Concepts and usage](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#concepts_and_usage)

When the user minimizes the window, switches to another tab, or the document is entirely obscured by another window, the API sends a [`visibilitychange`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event "visibilitychange") event to let listeners know the state of the page has changed. You can detect the event and perform some actions or behave differently. For example, if your web app is playing a video, it can pause the video when the user puts the tab into the background, and resume playback when the user returns to the tab. The user doesn't lose their place in the video, the video's soundtrack doesn't interfere with audio in the new foreground tab, and the user doesn't miss any of the video in the meantime.

Visibility states of an [`<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) are the same as the parent document. Hiding an `<iframe>` using CSS properties (such as [`display: none;`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display)) doesn't trigger visibility events or change the state of the document contained within the frame.

### [Use cases](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#use_cases)

Let's consider a few use cases for the Page Visibility API.

- A site has an image carousel that shouldn't advance to the next slide unless the user is viewing the page
- An application showing a dashboard of information doesn't want to poll the server for updates when the page isn't visible
- A site wants to switch off sounds when a device is in standby mode (user pushes power button to turn screen off)

Developers have historically used imperfect proxies to detect this. For example, watching for [`blur`](https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event "blur") and [`focus`](https://developer.mozilla.org/en-US/docs/Web/API/Window/focus_event "focus") events on the window helps you know when your page is not the active page, but it does not tell you that your page is actually hidden to the user. The Page Visibility API addresses this.

**Note:**
While [`onblur`](https://developer.mozilla.org/en-US/docs/Web/API/Window/blur_event "onblur") and [`onfocus`](https://developer.mozilla.org/en-US/docs/Web/API/Window/focus_event "onfocus") will tell you if the user switches windows, it doesn't necessarily mean it's hidden. Pages only become hidden when the user switches tabs or minimizes the browser window containing the tab.

### [Policies in place to aid background page performance](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#policies_in_place_to_aid_background_page_performance)

Separately from the Page Visibility API, user agents typically have a number of policies in place to mitigate the performance impact of background or hidden tabs. These may include:

- Most browsers stop sending [`requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame "requestAnimationFrame()") callbacks to background tabs or hidden [`<iframe>`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe) s in order to improve performance and battery life.
- Timers such as [`setTimeout()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout "setTimeout()") are throttled in background/inactive tabs to help improve performance. See [Reasons for longer delays than specified](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#reasons_for_longer_delays_than_specified) for more details.
- Browsers implement budget-based background timeout throttling. This operates in a similar way across modern browsers, with the details being as follows:
  - In Firefox, windows in background tabs each have their own time budget in milliseconds — a max and a min value of +50 ms and -150 ms, respectively. Chrome is very similar except that the budget is specified in seconds.
  - Windows are subjected to throttling after 30 seconds, with the same throttling delay rules as specified for window timers (again, see [Reasons for longer delays than specified](https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout#reasons_for_longer_delays_than_specified)). In Chrome, this value is 10 seconds.
  - Timer tasks are only permitted when the budget is non-negative.
  - Once a timer's code has finished running, the duration of time it took to execute is subtracted from its window's timeout budget.
  - The budget regenerates at a rate of 10 ms per second, in both Firefox and Chrome.

Some processes are exempt from this throttling behavior. In these cases, you can use the Page Visibility API to reduce the tabs' performance impact while they're hidden.

- Tabs which are playing audio are considered foreground and aren't throttled.
- Tabs running code that's using real-time network connections ( [WebSockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) and [WebRTC](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)) go unthrottled in order to avoid closing these connections timing out and getting unexpectedly closed.
- [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) processes are also left unthrottled in order to avoid timeouts.

## [Extensions to other interfaces](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#extensions_to_other_interfaces)

### [Instance properties](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#instance_properties)

The Page Visibility API adds the following properties to the [`Document`](https://developer.mozilla.org/en-US/docs/Web/API/Document) interface:

[`Document.hidden`](https://developer.mozilla.org/en-US/docs/Web/API/Document/hidden) Read only

Returns `true` if the page is in a state considered to be hidden to the user, and `false` otherwise.

[`Document.visibilityState`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState) Read only

A string indicating the document's current visibility state. Possible values are:

[`visible`](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#visible)

The page content may be at least partially visible. In practice this means that the page is the foreground tab of a non-minimized window.

[`hidden`](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API#hidden)

The page's content is not visible to the user, either due to the document's tab being in the background or part of a window that is minimized, or because the device's screen is off.

### [Events](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#events)

The Page Visibility API adds the following events to the [`Document`](https://developer.mozilla.org/en-US/docs/Web/API/Document) interface:

[`visibilitychange`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event "visibilitychange")

Fired when the content of a tab has become visible or has been hidden.

## [Examples](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#examples)

### [Pausing audio on page hide](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#pausing_audio_on_page_hide)

This example pauses playing audio when the page is hidden and resumes playing when the page becomes visible again.
The `<audio>` element controls allow the user to toggle between playing and paused audio.
The boolean `playingOnHide` is used to prevent audio from playing if the page changes to a `visible` state, but the media wasn't playing on page hide.

cssCopyPlay

```
audio {
  width: 100%;
}
```

#### HTML

htmlCopyPlay

```
<audio
  controls
  src="https://mdn.github.io/webaudio-examples/audio-basics/outfoxing.mp3"></audio>
```

#### JavaScript

jsCopyPlay

```
const audio = document.querySelector("audio");

let playingOnHide = false;

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    playingOnHide = !audio.paused;
    audio.pause();
  } else if (playingOnHide) {
    // Page became visible! Resume playing if audio was "playing on hide"
    audio.play();
  }
});
```

#### Result

Play

## [Specifications](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#specifications)

| Specification |
| --- |
| [HTML\<br>\# dom-document-visibilitystate](https://html.spec.whatwg.org/multipage/interaction.html#dom-document-visibilitystate) |

## [Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#browser_compatibility)

[Report problems with this compatibility data](https://github.com/mdn/browser-compat-data/issues/new?mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FPage_Visibility_API&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EMDN+page+report+details%3C%2Fsummary%3E%0A%0A*+Query%3A+%60api.Document.visibilityState%60%0A*+Report+started%3A+2026-11-09T00%3A50%3A23.073Z%0A%0A%3C%2Fdetails%3E&title=api.Document.visibilityState+-+%3CSUMMARIZE+THE+PROBLEM%3E&template=data-problem.yml "Report an issue with this compatibility data") •
[View data on GitHub](https://github.com/mdn/browser-compat-data/tree/main/api/Document.json "File: api/Document.json")

Settings

Select the browsers to show in compatibility tables. Your selection is saved in this browser.


### Desktop

Chrome Edge Firefox Safari

Internet Explorer Opera

### Mobile

Chrome Android Firefox for Android Safari on iOS

WebView Android WebView on iOS

Opera Android Samsung Browser

### Server

Bun Deno Node.js

### XR

Quest Browser

### Legend

Browser not available for current feature. No support data available.

|  | desktop | mobile |
| --- | --- | --- |
|  | Chrome | Edge | Firefox | Opera | Safari | Chrome Android | Firefox for Android | Opera Android | Safari on iOS | Samsung Browser | WebView Android | WebView on iOS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `visibilityState` | Chrome – Full support<br>Chrome33<br>more | Edge – Full support<br>Edge12 | Firefox – Full support<br>Firefox18<br>more | Opera – Full support<br>Opera20<br>more | Safari – Full support<br>Safari7 | Chrome Android – Full support<br>Chrome Android33<br>more | Firefox for Android – Full support<br>Firefox for Android18<br>more | Opera Android – Full support<br>Opera Android20<br>more | Safari on iOS – Full support<br>Safari on iOS7 | Samsung Browser – Full support<br>Samsung Browser2<br>more | WebView Android – Full support<br>WebView Android4.4.3<br>more | WebView on iOS – Full support<br>WebView on iOS7 |

### Legend

Tip: you can click/tap on a cell for more information.


Full supportFull support

Requires a vendor prefix or different name for use.

Has more compatibility info.

## [See also](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API\#see_also)

- [`Document.visibilityState`](https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState)
- [`Document.hidden`](https://developer.mozilla.org/en-US/docs/Web/API/Document/hidden)
- [Timing element visibility with the Intersection Observer API](https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API/Timing_element_visibility)

## Help improve MDN

Was this page helpful to you?

YesNo

[Learn how to contribute](https://developer.mozilla.org/en-US/docs/MDN/Community/Getting_started)

This page was last modified on Dec 30, 2025 by [MDN contributors](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API/contributors.txt).


[View this page on GitHub](https://github.com/mdn/content/blob/main/files/en-us/web/api/page_visibility_api/index.md?plain=1 "Folder: en-us/web/api/page_visibility_api (Opens in a new tab)") • [Report a problem with this content](https://github.com/mdn/content/issues/new?template=page-report.yml&mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FPage_Visibility_API&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EPage+report+details%3C%2Fsummary%3E%0A%0A*+Folder%3A+%60en-us%2Fweb%2Fapi%2Fpage_visibility_api%60%0A*+MDN+URL%3A+https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FPage_Visibility_API%0A*+GitHub+URL%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fblob%2Fmain%2Ffiles%2Fen-us%2Fweb%2Fapi%2Fpage_visibility_api%2Findex.md%0A*+Last+commit%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fcommit%2F21ed9a1338b207e8a39064583c19d9f720235235%0A*+Document+last+modified%3A+2025-12-30T02%3A28%3A58.000Z%0A%0A%3C%2Fdetails%3E "This will take you to GitHub to file a new issue.")