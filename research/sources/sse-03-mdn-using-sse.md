Source: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events
Title: Using server-sent events - Web APIs | MDN
Fetched: 2026-09-19T16:07:41.357Z

- [Skip to main content](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#content)
- [Skip to search](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#mdn-search)

Learn frontend, backend, and AI from our course partner
[Scrimba](https://scrimba.com/learn/frontend?via=mdn)

# Using server-sent events

Baseline


Widely available

\*

This feature is well established and works across many devices and browser versions. It’s been available across browsers since January 2020.

\\* Some parts of this feature may have varying levels of support.


- [See full compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#browser_compatibility)
- [Learn more](https://developer.mozilla.org/en-US/docs/Glossary/Baseline/Compatibility)

Developing a web application that uses [server-sent events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) is straightforward. You'll need a bit of code on the server to stream events to the front-end, but the client-side code works almost identically to [websockets](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API) in part of handling incoming events. This is a one-way connection, so you can't send events from a client to a server.

## [Receiving events from the server](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#receiving_events_from_the_server)

The server-sent event API is contained in the [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) interface.

### [Creating an `EventSource` instance](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#creating_an_eventsource_instance)

To open a connection to the server to begin receiving events from it, create a new `EventSource` object with the URL of a script that generates the events. For example:

jsCopy

```
const evtSource = new EventSource("sse-demo.php");
```

If the event generator script is hosted on a different origin, a new `EventSource` object should be created with both the URL and an options dictionary. For example, assuming the client script is on `example.com`:

jsCopy

```
const evtSource = new EventSource("//api.example.com/sse-demo.php", {
  withCredentials: true,
});
```

### [Listening for `message` events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#listening_for_message_events)

Messages sent from the server that don't have an [`event`](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event) field are received as `message` events. To receive message events, attach a handler for the [`message`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/message_event "message") event:

jsCopy

```
evtSource.onmessage = (event) => {
  const newElement = document.createElement("li");
  const eventList = document.getElementById("list");

  newElement.textContent = `message: ${event.data}`;
  eventList.appendChild(newElement);
};
```

This code listens for incoming message events and appends the message text to a list in the document's HTML.

### [Listening for custom events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#listening_for_custom_events)

Messages from the server that do have an `event` field defined are received as events with the name given in `event`. For example:

jsCopy

```
evtSource.addEventListener("ping", (event) => {
  const newElement = document.createElement("li");
  const eventList = document.getElementById("list");
  const time = JSON.parse(event.data).time;
  newElement.textContent = `ping at ${time}`;
  eventList.appendChild(newElement);
});
```

This code will be called whenever the server sends a message with the `event` field set to `ping`; it then parses the JSON in the `data` field and outputs that information.

**Warning:**
When **not used over HTTP/2**, SSE suffers from a limitation to the maximum number of open connections, which can be especially painful when opening multiple tabs, as the limit is _per browser_ and is set to a very low number (6). The issue has been marked as "Won't fix" in [Chrome](https://crbug.com/275955 "External link (opens in new tab)") and [Firefox](https://bugzil.la/906896 "External link (opens in new tab)"). This limit is per browser + domain, which means that you can open 6 SSE connections across all of the tabs to `www.example1.com` and another 6 SSE connections to `www.example2.com` (per [Stack Overflow](https://stackoverflow.com/questions/5195452/websockets-vs-server-sent-events-eventsource/5326159 "External link (opens in new tab)")). When using HTTP/2, the maximum number of simultaneous _HTTP streams_ is negotiated between the server and the client (defaults to 100).

## [Sending events from the server](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#sending_events_from_the_server)

The server-side script that sends events needs to respond using the MIME type `text/event-stream`. Each notification is sent as a block of text terminated by a pair of newlines. For details on the format of the event stream, see [Event stream format](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event_stream_format).

The [PHP](https://developer.mozilla.org/en-US/docs/Glossary/PHP) code for the example we're using here follows:

phpCopy

```
date_default_timezone_set("America/New_York");
header("X-Accel-Buffering: no");
header("Content-Type: text/event-stream");
header("Cache-Control: no-cache");

$counter = rand(1, 10);
while (true) {
  // Every second, send a "ping" event.

  echo "event: ping\n";
  $curDate = date(DATE_ISO8601);
  echo 'data: {"time": "' . $curDate . '"}';
  echo "\n\n";

  // Send a simple message at random intervals.

  $counter--;

  if (!$counter) {
    echo 'data: This is a message at time ' . $curDate . "\n\n";
    $counter = rand(1, 10);
  }

  if (ob_get_contents()) {
      ob_end_flush();
  }
  flush();

  // Break the loop if the client aborted the connection (closed the page)

  if (connection_aborted()) break;

  sleep(1);
}
```

The code above generates an event every second, with the event type "ping". Each event's data is a JSON object containing the ISO 8601 timestamp corresponding to the time at which the event was generated. At random intervals, a simple message (with no event type) is sent.
The loop will keep running independent of the connection status, so a check is included
to break the loop if the connection has been closed (e.g., client closes the page).

**Note:**
You can find a full example that uses the code shown in this article on GitHub — see [Simple SSE demo using PHP](https://github.com/mdn/dom-examples/tree/main/server-sent-events "External link (opens in new tab)").

## [Error handling](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#error_handling)

If the server responds with an `error` key (e.g., `JSON.parse(event.data.error)` or another problem occurs (such as a network timeout or issues pertaining to [access control](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS)), an error event is generated. You can take action on this programmatically by implementing the `onerror` callback on the `EventSource` object:

jsCopy

```
evtSource.onerror = (err) => {
  console.error("EventSource failed:", err);
};
```

## [Closing event streams](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#closing_event_streams)

By default, if the connection between the client and server closes, the connection is restarted. The connection is terminated with the `.close()` method.

jsCopy

```
evtSource.close();
```

## [Event stream format](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#event_stream_format)

The event stream is a simple stream of text data which must be encoded using [UTF-8](https://developer.mozilla.org/en-US/docs/Glossary/UTF-8). Messages in the event stream are separated by a pair of newline characters. A colon as the first character of a line is in essence a comment, and is ignored.

**Note:**
The comment line can be used to prevent connections from timing out; a server can send a comment periodically to keep the connection alive.

Each message consists of one or more lines of text listing the fields for that message. Each field is represented by the field name, followed by a colon, followed by the text data for that field's value.

### [Fields](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#fields)

Each message received has some combination of the following fields, one per line:

[`event`](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#event)

A string identifying the type of event described. If this is specified, an event will be dispatched on the browser to the listener for the specified event name; the website source code should use `addEventListener()` to listen for named events. The `onmessage` handler is called if no event name is specified for a message.

[`data`](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#data)

The data field for the message. When the `EventSource` receives multiple consecutive lines that begin with `data:`, [it concatenates them](https://html.spec.whatwg.org/multipage/#dispatchMessage "External link (opens in new tab)"), inserting a newline character between each one. Trailing newlines are removed.

[`id`](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#id)

The event ID to set the [`EventSource`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource) object's last event ID value.

[`retry`](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events#retry)

The reconnection time. If the connection to the server is lost, the browser will wait for the specified time before attempting to reconnect. This must be an integer, specifying the reconnection time in milliseconds. If a non-integer value is specified, the field is ignored.

All other field names are ignored.

**Note:**
If a line doesn't contain a colon, the entire line is treated as the field name with an empty value string.

### [Examples](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#examples)

#### Data-only messages

In the following example, there are three messages sent. The first is just a comment, since it starts with a colon character. As mentioned previously, this can be useful as a keep-alive mechanism if messages might not be sent regularly.

The second message contains a data field with the value "some text". The third message contains a data field with the value "another message\\nwith two lines". Note the newline special character in the value.

bashCopy

```
: this is a test stream

data: some text

data: another message
data: with two lines
```

#### Named events

This example sends named events. Each has an event name specified by the `event` field, and a `data` field whose value is an appropriate JSON string with the data needed for the client to act on the event. The `data` field could, of course, have any string data; it doesn't have to be JSON.

bashCopy

```
event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}

event: userdisconnect
data: {"username": "bobby", "time": "02:34:23"}

event: usermessage
data: {"username": "sean", "time": "02:34:36", "text": "Bye, bobby."}
```

#### Mixing and matching

You don't have to use just unnamed messages or typed events; you can mix them together in a single event stream.

bashCopy

```
event: userconnect
data: {"username": "bobby", "time": "02:33:48"}

data: Here's a system message of some kind that will get used
data: to accomplish some task.

event: usermessage
data: {"username": "bobby", "time": "02:34:11", "text": "Hi everyone."}
```

## [Browser compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events\#browser_compatibility)

[Report problems with this compatibility data](https://github.com/mdn/browser-compat-data/issues/new?mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FServer-sent_events%2FUsing_server-sent_events&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EMDN+page+report+details%3C%2Fsummary%3E%0A%0A*+Query%3A+%60api.EventSource%60%0A*+Report+started%3A+2026-09-18T19%3A56%3A49.649Z%0A%0A%3C%2Fdetails%3E&title=api.EventSource+-+%3CSUMMARIZE+THE+PROBLEM%3E&template=data-problem.yml "Report an issue with this compatibility data") •
[View data on GitHub](https://github.com/mdn/browser-compat-data/tree/main/api/EventSource.json "File: api/EventSource.json")

|  | desktop | mobile | server |
| --- | --- | --- | --- |
|  | Chrome | Edge | Firefox | Opera | Safari | Chrome Android | Firefox for Android | Opera Android | Safari on iOS | Samsung Browser | WebView Android | WebView on iOS | Deno |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `EventSource` | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera11 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android11 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`EventSource()` constructor](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/EventSource) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera11 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| `options.withCredentials` parameter | Chrome – Full support<br>Chrome26 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox11 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari7 | Chrome Android – Full support<br>Chrome Android26 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS7 | Samsung Browser – Full support<br>Samsung Browser2 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS7 | Deno – Full support<br>Deno1.38 |
| [`close`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/close) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`error` event](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/error_event) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`message` event](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/message_event) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`open` event](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/open_event) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`readyState`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/readyState) | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |
| [`url`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/url) | Chrome – Full support<br>Chrome18 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari6 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS6 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS6 | Deno – Full support<br>Deno1.38 |
| [`withCredentials`](https://developer.mozilla.org/en-US/docs/Web/API/EventSource/withCredentials) | Chrome – Full support<br>Chrome26 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox6 | Opera – Full support<br>Opera12 | Safari – Full support<br>Safari7 | Chrome Android – Full support<br>Chrome Android26 | Firefox for Android – Full support<br>Firefox for Android45 | Opera Android – Full support<br>Opera Android12 | Safari on iOS – Full support<br>Safari on iOS7 | Samsung Browser – Full support<br>Samsung Browser1.5 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS7 | Deno – Full support<br>Deno1.38 |
| Available in workers | Chrome – Full support<br>Chrome6 | Edge – Full support<br>Edge79 | Firefox – Full support<br>Firefox133<br>more | Opera – Full support<br>Opera15 | Safari – Full support<br>Safari5 | Chrome Android – Full support<br>Chrome Android18 | Firefox for Android – Full support<br>Firefox for Android133<br>more | Opera Android – Full support<br>Opera Android14 | Safari on iOS – Full support<br>Safari on iOS5 | Samsung Browser – Full support<br>Samsung Browser1 | WebView Android – Full support<br>WebView Android4.4 | WebView on iOS – Full support<br>WebView on iOS5 | Deno – Full support<br>Deno1.38 |

### Legend

Tip: you can click/tap on a cell for more information.


Full supportFull support

Partial supportPartial support

Has more compatibility info.

## Help improve MDN

Was this page helpful to you?

YesNo

[Learn how to contribute](https://developer.mozilla.org/en-US/docs/MDN/Community/Getting_started)

This page was last modified on Sep 3, 2026 by [MDN contributors](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events/contributors.txt).


[View this page on GitHub](https://github.com/mdn/content/blob/main/files/en-us/web/api/server-sent_events/using_server-sent_events/index.md?plain=1 "Folder: en-us/web/api/server-sent_events/using_server-sent_events (Opens in a new tab)") • [Report a problem with this content](https://github.com/mdn/content/issues/new?template=page-report.yml&mdn-url=https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FServer-sent_events%2FUsing_server-sent_events&metadata=%3C%21--+Do+not+make+changes+below+this+line+--%3E%0A%3Cdetails%3E%0A%3Csummary%3EPage+report+details%3C%2Fsummary%3E%0A%0A*+Folder%3A+%60en-us%2Fweb%2Fapi%2Fserver-sent_events%2Fusing_server-sent_events%60%0A*+MDN+URL%3A+https%3A%2F%2Fdeveloper.mozilla.org%2Fen-US%2Fdocs%2FWeb%2FAPI%2FServer-sent_events%2FUsing_server-sent_events%0A*+GitHub+URL%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fblob%2Fmain%2Ffiles%2Fen-us%2Fweb%2Fapi%2Fserver-sent_events%2Fusing_server-sent_events%2Findex.md%0A*+Last+commit%3A+https%3A%2F%2Fgithub.com%2Fmdn%2Fcontent%2Fcommit%2F051d02b402b7f76c2078b12283aa18318c34c38b%0A*+Document+last+modified%3A+2026-09-03T09%3A20%3A06.000Z%0A%0A%3C%2Fdetails%3E "This will take you to GitHub to file a new issue.")