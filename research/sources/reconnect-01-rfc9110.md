Source: https://www.rfc-editor.org/rfc/rfc9110.html
Title: RFC 9110: HTTP Semantics
Fetched: 2026-09-19T16:07:43.623Z
Truncated: continue from startIndex 250000

| RFC 9110 | HTTP Semantics | June 2022 |
| --- | --- | --- |
| Fielding, et al. | Standards Track | \[Page\] |

Status:Internet StandardObsoletes:[2818](https://www.rfc-editor.org/rfc/rfc2818), [7230](https://www.rfc-editor.org/rfc/rfc7230), [7231](https://www.rfc-editor.org/rfc/rfc7231), [7232](https://www.rfc-editor.org/rfc/rfc7232), [7233](https://www.rfc-editor.org/rfc/rfc7233), [7235](https://www.rfc-editor.org/rfc/rfc7235), [7538](https://www.rfc-editor.org/rfc/rfc7538), [7615](https://www.rfc-editor.org/rfc/rfc7615), [7694](https://www.rfc-editor.org/rfc/rfc7694)Updates:[3864](https://www.rfc-editor.org/rfc/rfc3864)More info:[Errata exist](https://www.rfc-editor.org/errata/rfc9110) \| [Datatracker](https://datatracker.ietf.org/doc/rfc9110) \| [IPR](https://datatracker.ietf.org/ipr/search/?rfc=9110&submit=rfc) \| [Info page](https://www.rfc-editor.org/info/rfc9110)

Stream:Internet Engineering Task Force (IETF)RFC:[9110](https://www.rfc-editor.org/rfc/rfc9110)STD:97Obsoletes:[2818](https://www.rfc-editor.org/rfc/rfc2818), [7230](https://www.rfc-editor.org/rfc/rfc7230), [7231](https://www.rfc-editor.org/rfc/rfc7231), [7232](https://www.rfc-editor.org/rfc/rfc7232), [7233](https://www.rfc-editor.org/rfc/rfc7233), [7235](https://www.rfc-editor.org/rfc/rfc7235), [7538](https://www.rfc-editor.org/rfc/rfc7538), [7615](https://www.rfc-editor.org/rfc/rfc7615), [7694](https://www.rfc-editor.org/rfc/rfc7694)Updates:[3864](https://www.rfc-editor.org/rfc/rfc3864)Category:Standards TrackPublished:June 2022ISSN:2070-1721Authors:

R. Fielding, Ed.

Adobe

M. Nottingham, Ed.

Fastly

J. Reschke, Ed.

greenbytes

# RFC 9110

# HTTP Semantics

## [Abstract](https://www.rfc-editor.org/rfc/rfc9110.html\#abstract)

The Hypertext Transfer Protocol (HTTP) is a stateless application-level
protocol for distributed, collaborative, hypertext information systems.
This document describes the overall architecture of HTTP, establishes common
terminology, and defines aspects of the protocol that are shared by all
versions. In this definition are core protocol elements, extensibility
mechanisms, and the "http" and "https" Uniform Resource Identifier (URI)
schemes. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-abstract-1)

This document updates RFC 3864 and
obsoletes RFCs 2818, 7231, 7232, 7233,
7235, 7538, 7615, 7694, and portions of 7230. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-abstract-2)

## [Status of This Memo](https://www.rfc-editor.org/rfc/rfc9110.html\#name-status-of-this-memo)

This is an Internet Standards Track document. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.1-1)

This document is a product of the Internet Engineering Task Force
(IETF). It represents the consensus of the IETF community. It has
received public review and has been approved for publication by
the Internet Engineering Steering Group (IESG). Further
information on Internet Standards is available in Section 2 of
RFC 7841. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.1-2)

Information about the current status of this document, any
errata, and how to provide feedback on it may be obtained at
[https://www.rfc-editor.org/info/rfc9110](https://www.rfc-editor.org/info/rfc9110). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.1-3)

## [Copyright Notice](https://www.rfc-editor.org/rfc/rfc9110.html\#name-copyright-notice)

Copyright (c) 2022 IETF Trust and the persons identified as the
document authors. All rights reserved. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.2-1)

This document is subject to BCP 78 and the IETF Trust's Legal
Provisions Relating to IETF Documents
([https://trustee.ietf.org/license-info](https://trustee.ietf.org/license-info)) in effect on the date of
publication of this document. Please review these documents
carefully, as they describe your rights and restrictions with
respect to this document. Code Components extracted from this
document must include Revised BSD License text as described in
Section 4.e of the Trust Legal Provisions and are provided without
warranty as described in the Revised BSD License. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.2-2)

This document may contain material from IETF Documents or IETF
Contributions published or made publicly available before November
10, 2008. The person(s) controlling the copyright in some of this
material may not have granted the IETF Trust the right to allow
modifications of such material outside the IETF Standards Process.
Without obtaining an adequate license from the person(s)
controlling the copyright in such materials, this document may not
be modified outside the IETF Standards Process, and derivative
works of it may not be created outside the IETF Standards Process,
except to format it for publication as an RFC or to translate it
into languages other than English. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-boilerplate.2-3)

[▲](https://www.rfc-editor.org/rfc/rfc9110.html#)

## [Table of Contents](https://www.rfc-editor.org/rfc/rfc9110.html\#name-table-of-contents)

## [1\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-1) [Introduction](https://www.rfc-editor.org/rfc/rfc9110.html\#name-introduction)

### [1.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-1.1) [Purpose](https://www.rfc-editor.org/rfc/rfc9110.html\#name-purpose)

The Hypertext Transfer Protocol (HTTP) is a family of stateless,
application-level, request/response protocols that share a generic interface,
extensible semantics, and self-descriptive messages to enable flexible
interaction with network-based hypertext information systems. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.1-1)

HTTP hides the details of how a service is implemented by presenting a
uniform interface to clients that is independent of the types of resources
provided. Likewise, servers do not need to be aware of each client's
purpose: a request can be considered in isolation rather than being
associated with a specific type of client or a predetermined sequence of
application steps. This allows general-purpose implementations to be used
effectively in many different contexts, reduces interaction complexity, and
enables independent evolution over time. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.1-2)

HTTP is also designed for use as an intermediation protocol, wherein
proxies and gateways can translate non-HTTP information systems into a
more generic interface. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.1-3)

One consequence of this flexibility is that the protocol cannot be
defined in terms of what occurs behind the interface. Instead, we
are limited to defining the syntax of communication, the intent
of received communication, and the expected behavior of recipients.
If the communication is considered in isolation, then successful
actions ought to be reflected in corresponding changes to the
observable interface provided by servers. However, since multiple
clients might act in parallel and perhaps at cross-purposes, we
cannot require that such changes be observable beyond the scope
of a single response. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.1-4)

### [1.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-1.2) [History and Evolution](https://www.rfc-editor.org/rfc/rfc9110.html\#name-history-and-evolution)

HTTP has been the primary information transfer protocol for the World
Wide Web since its introduction in 1990. It began as a trivial
mechanism for low-latency requests, with a single method (GET) to
request transfer of a presumed hypertext document identified by a given pathname.
As the Web grew, HTTP was extended to enclose requests and responses within
messages, transfer arbitrary data formats using MIME-like media types, and
route requests through intermediaries. These protocols were eventually
defined as HTTP/0.9 and HTTP/1.0 (see \[ [HTTP/1.0](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP10)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.2-1)

HTTP/1.1 was designed to refine the protocol's features while retaining
compatibility with the existing text-based messaging syntax, improving
its interoperability, scalability, and robustness across the Internet.
This included length-based data delimiters for both fixed and dynamic
(chunked) content, a consistent framework for content negotiation,
opaque validators for conditional requests, cache controls for better
cache consistency, range requests for partial updates, and default
persistent connections. HTTP/1.1 was introduced in 1995 and published on
the Standards Track in 1997 \[ [RFC2068](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2068)\], revised in
1999 \[ [RFC2616](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2616)\], and revised again in 2014
(\[ [RFC7230](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7230)\] through \[ [RFC7235](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7235)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.2-2)

HTTP/2 (\[ [HTTP/2](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP2)\]) introduced a multiplexed session layer
on top of the existing TLS and TCP protocols for exchanging concurrent
HTTP messages with efficient field compression and server push.
HTTP/3 (\[ [HTTP/3](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP3)\]) provides greater independence for concurrent
messages by using QUIC as a secure multiplexed transport over UDP instead of
TCP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.2-3)

All three major versions of HTTP rely on the semantics defined by
this document. They have not obsoleted each other because each one has
specific benefits and limitations depending on the context of use.
Implementations are expected to choose the most appropriate transport and
messaging syntax for their particular context. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.2-4)

This revision of HTTP separates the definition of semantics (this document)
and caching (\[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]) from the current HTTP/1.1 messaging
syntax (\[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) to allow each major protocol version
to progress independently while referring to the same core semantics. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.2-5)

### [1.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-1.3) [Core Semantics](https://www.rfc-editor.org/rfc/rfc9110.html\#name-core-semantics)

HTTP provides a uniform interface for interacting with a resource
( [Section 3.1](https://www.rfc-editor.org/rfc/rfc9110.html#resources)) \-\- regardless of its type, nature, or
implementation -- by sending messages that manipulate or transfer
representations ( [Section 3.2](https://www.rfc-editor.org/rfc/rfc9110.html#representations)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.3-1)

Each message is either a request or a response. A client constructs request
messages that communicate its intentions and routes those messages toward
an identified origin server. A server listens for requests, parses each
message received, interprets the message semantics in relation to the
identified target resource, and responds to that request with one or more
response messages. The client examines received responses to see if its
intentions were carried out, determining what to do next based on the
status codes and content received. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.3-2)

HTTP semantics include the intentions defined by each request method
( [Section 9](https://www.rfc-editor.org/rfc/rfc9110.html#methods)), extensions to those semantics that might be
described in request header fields,
status codes that describe the response ( [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes)), and
other control data and resource metadata that might be given in response
fields. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.3-3)

Semantics also include representation metadata that describe how
content is intended to be interpreted by a recipient, request header
fields that might influence content selection, and the various selection
algorithms that are collectively referred to as
"content negotiation" ( [Section 12](https://www.rfc-editor.org/rfc/rfc9110.html#content.negotiation)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.3-4)

### [1.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-1.4) [Specifications Obsoleted by This Document](https://www.rfc-editor.org/rfc/rfc9110.html\#name-specifications-obsoleted-by)

| Title | Reference | See |
| --- | --- | --- |
| HTTP Over TLS | \[ [RFC2818](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2818)\] | [B.1](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.2818) |
| HTTP/1.1 Message Syntax and Routing \[\*\] | \[ [RFC7230](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7230)\] | [B.2](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7230) |
| HTTP/1.1 Semantics and Content | \[ [RFC7231](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7231)\] | [B.3](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7231) |
| HTTP/1.1 Conditional Requests | \[ [RFC7232](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7232)\] | [B.4](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7232) |
| HTTP/1.1 Range Requests | \[ [RFC7233](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7233)\] | [B.5](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7233) |
| HTTP/1.1 Authentication | \[ [RFC7235](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7235)\] | [B.6](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7235) |
| HTTP Status Code 308 (Permanent Redirect) | \[ [RFC7538](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7538)\] | [B.7](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7538) |
| HTTP Authentication-Info and Proxy-Authentication-Info<br> Response Header Fields | \[ [RFC7615](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7615)\] | [B.8](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7615) |
| HTTP Client-Initiated Content-Encoding | \[ [RFC7694](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7694)\] | [B.9](https://www.rfc-editor.org/rfc/rfc9110.html#changes.from.rfc.7694) |

[Table 1](https://www.rfc-editor.org/rfc/rfc9110.html#table-1)

\[\*\] This document only obsoletes the portions of
[RFC 7230](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7230) that are independent of
the HTTP/1.1 messaging syntax and connection management; the remaining
bits of [RFC 7230](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7230) are
obsoleted by "HTTP/1.1" \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-1.4-2)

## [2\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2) [Conformance](https://www.rfc-editor.org/rfc/rfc9110.html\#name-conformance)

### [2.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2.1) [Syntax Notation](https://www.rfc-editor.org/rfc/rfc9110.html\#name-syntax-notation)

This specification uses the Augmented Backus-Naur Form (ABNF) notation of
\[ [RFC5234](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5234)\], extended with the notation for case-sensitivity
in strings defined in \[ [RFC7405](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7405)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-1)

It also uses a list extension, defined in [Section 5.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#abnf.extension),
that allows for compact definition of comma-separated lists using a "#"
operator (similar to how the "\*" operator indicates repetition). [Appendix A](https://www.rfc-editor.org/rfc/rfc9110.html#collected.abnf) shows the collected grammar with all list
operators expanded to standard ABNF notation. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-2)

As a convention, ABNF rule names prefixed with "obs-" denote
obsolete grammar rules that appear for historical reasons. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-3)













The following core rules are included by
reference, as defined in [Appendix B.1](https://www.rfc-editor.org/rfc/rfc5234#appendix-B.1) of \[ [RFC5234](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5234)\]:
ALPHA (letters), CR (carriage return), CRLF (CR LF), CTL (controls),
DIGIT (decimal 0-9), DQUOTE (double quote),
HEXDIG (hexadecimal 0-9/A-F/a-f), HTAB (horizontal tab), LF (line feed),
OCTET (any 8-bit sequence of data), SP (space), and
VCHAR (any visible US-ASCII character). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-4)

[Section 5.6](https://www.rfc-editor.org/rfc/rfc9110.html#fields.components) defines some generic syntactic
components for field values. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-5)

This specification uses the terms
"character",
"character encoding scheme",
"charset", and
"protocol element"
as they are defined in \[ [RFC6365](https://www.rfc-editor.org/rfc/rfc9110.html#RFC6365)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.1-6)

### [2.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2.2) [Requirements Notation](https://www.rfc-editor.org/rfc/rfc9110.html\#name-requirements-notation)

The key words "MUST", "MUST NOT",
"REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT",
"RECOMMENDED", "NOT RECOMMENDED",
"MAY", and "OPTIONAL" in this document are to be
interpreted as described in BCP 14 \[ [RFC2119](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2119)\]\[ [RFC8174](https://www.rfc-editor.org/rfc/rfc9110.html#RFC8174)\] when, and only when, they appear in all capitals, as
shown here. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-1)

This specification targets conformance criteria according to the role of
a participant in HTTP communication. Hence, requirements are placed
on senders, recipients, clients, servers, user agents, intermediaries,
origin servers, proxies, gateways, or caches, depending on what behavior
is being constrained by the requirement. Additional requirements
are placed on implementations, resource owners, and protocol element
registrations when they apply beyond the scope of a single communication. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-2)

The verb "generate" is used instead of "send" where a requirement applies
only to implementations that create the protocol element, rather than an
implementation that forwards a received element downstream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-3)

An implementation is considered conformant if it complies with all of the
requirements associated with the roles it partakes in HTTP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-4)

A sender MUST NOT generate protocol elements that do not match the grammar
defined by the corresponding ABNF rules.
Within a given message, a sender MUST NOT generate protocol elements or
syntax alternatives that are only allowed to be generated by participants in
other roles (i.e., a role that the sender does not have for that message). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-5)

Conformance to HTTP includes both conformance to the particular messaging
syntax of the protocol version in use and conformance to the semantics of
protocol elements sent. For example, a client that claims conformance to
HTTP/1.1 but fails to recognize the features required of HTTP/1.1
recipients will fail to interoperate with servers that adjust their
responses in accordance with those claims.
Features that reflect user choices, such as content negotiation and
user-selected extensions, can impact application behavior beyond the
protocol stream; sending protocol elements that inaccurately reflect a
user's choices will confuse the user and inhibit choice. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-6)

When an implementation fails semantic conformance, recipients of that
implementation's messages will eventually develop workarounds to adjust
their behavior accordingly. A recipient MAY employ such workarounds while
remaining conformant to this protocol if the workarounds are limited to the
implementations at fault. For example, servers often scan portions of the
User-Agent field value, and user agents often scan the Server field value,
to adjust their own behavior with respect to known bugs or poorly chosen
defaults. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.2-7)

### [2.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2.3) [Length Requirements](https://www.rfc-editor.org/rfc/rfc9110.html\#name-length-requirements)

A recipient SHOULD parse a received protocol element defensively, with
only marginal expectations that the element will conform to its ABNF
grammar and fit within a reasonable buffer size. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.3-1)

HTTP does not have specific length limitations for many of its protocol
elements because the lengths that might be appropriate will vary widely,
depending on the deployment context and purpose of the implementation.
Hence, interoperability between senders and recipients depends on shared
expectations regarding what is a reasonable length for each protocol
element. Furthermore, what is commonly understood to be a reasonable length
for some protocol elements has changed over the course of the past three
decades of HTTP use and is expected to continue changing in the future. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.3-2)

At a minimum, a recipient MUST be able to parse and process protocol
element lengths that are at least as long as the values that it generates
for those same protocol elements in other messages. For example, an origin
server that publishes very long URI references to its own resources needs
to be able to parse and process those same references when received as a
target URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.3-3)

Many received protocol elements are only parsed to the extent necessary to
identify and forward that element downstream. For example, an intermediary
might parse a received field into its field name and field value components,
but then forward the field without further parsing inside the field value. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.3-4)

### [2.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2.4) [Error Handling](https://www.rfc-editor.org/rfc/rfc9110.html\#name-error-handling)

A recipient MUST interpret a received protocol element according to the
semantics defined for it by this specification, including extensions to
this specification, unless the recipient has determined (through experience
or configuration) that the sender incorrectly implements what is implied by
those semantics.
For example, an origin server might disregard the contents of a received
[Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding) header field if inspection of the
[User-Agent](https://www.rfc-editor.org/rfc/rfc9110.html#field.user-agent) header field indicates a specific implementation
version that is known to fail on receipt of certain content codings. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.4-1)

Unless noted otherwise, a recipient MAY attempt to recover a usable
protocol element from an invalid construct. HTTP does not define
specific error handling mechanisms except when they have a direct impact
on security, since different applications of the protocol require
different error handling strategies. For example, a Web browser might
wish to transparently recover from a response where the
[Location](https://www.rfc-editor.org/rfc/rfc9110.html#field.location) header field doesn't parse according to the ABNF,
whereas a systems control client might consider any form of error recovery
to be dangerous. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.4-2)

Some requests can be automatically retried by a client in the event of
an underlying connection failure, as described in
[Section 9.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#idempotent.methods). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.4-3)

### [2.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-2.5) [Protocol Version](https://www.rfc-editor.org/rfc/rfc9110.html\#name-protocol-version)

HTTP's version number consists of two decimal digits separated by a "."
(period or decimal point). The first digit (major version) indicates the
messaging syntax, whereas the second digit (minor version)
indicates the highest minor version within that major version to which the
sender is conformant (able to understand for future communication). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-1)

While HTTP's core semantics don't change between protocol versions, their
expression "on the wire" can change, and so the
HTTP version number changes when incompatible changes are made to the wire
format. Additionally, HTTP allows incremental, backwards-compatible
changes to be made to the protocol without changing its version through
the use of defined extension points ( [Section 16](https://www.rfc-editor.org/rfc/rfc9110.html#extending)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-2)

The protocol version as a whole indicates the sender's conformance with
the set of requirements laid out in that version's corresponding
specification(s).
For example, the version "HTTP/1.1" is defined by the combined
specifications of this document, "HTTP Caching" \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\],
and "HTTP/1.1" \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-3)

HTTP's major version number is incremented when an incompatible message
syntax is introduced. The minor number is incremented when changes made to
the protocol have the effect of adding to the message semantics or
implying additional capabilities of the sender. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-4)

The minor version advertises the sender's communication capabilities even
when the sender is only using a backwards-compatible subset of the
protocol, thereby letting the recipient know that more advanced features
can be used in response (by servers) or in future requests (by clients). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-5)

When a major version of HTTP does not define any minor versions, the minor
version "0" is implied. The "0" is used when referring to that protocol
within elements that require a minor version identifier. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-2.5-6)

## [3\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3) [Terminology and Core Concepts](https://www.rfc-editor.org/rfc/rfc9110.html\#name-terminology-and-core-concep)

HTTP was created for the World Wide Web (WWW) architecture
and has evolved over time to support the scalability needs of a worldwide
hypertext system. Much of that architecture is reflected in the terminology
used to define HTTP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3-1)

### [3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.1) [Resources](https://www.rfc-editor.org/rfc/rfc9110.html\#name-resources)

The target of an HTTP request is called a "resource".
HTTP does not limit the nature of a resource; it merely
defines an interface that might be used to interact with resources.
Most resources are identified by a Uniform Resource Identifier (URI), as
described in [Section 4](https://www.rfc-editor.org/rfc/rfc9110.html#uri). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.1-1)

One design goal of HTTP is to separate resource identification from
request semantics, which is made possible by vesting the request
semantics in the request method ( [Section 9](https://www.rfc-editor.org/rfc/rfc9110.html#methods)) and a few
request-modifying header fields.
A resource cannot treat a request in a manner inconsistent with the
semantics of the method of the request. For example, though the URI of a
resource might imply semantics that are not safe, a client can expect the
resource to avoid actions that are unsafe when processing a request with a
safe method (see [Section 9.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#safe.methods)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.1-2)

HTTP relies upon the Uniform Resource Identifier (URI)
standard \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\] to indicate the target resource
( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)) and relationships between resources. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.1-3)

### [3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.2) [Representations](https://www.rfc-editor.org/rfc/rfc9110.html\#name-representations)

A "representation" is information
that is intended to reflect a past, current, or desired state of a given
resource, in a format that can be readily communicated via the protocol.
A representation consists of a set of representation metadata and a
potentially unbounded stream of representation data
( [Section 8](https://www.rfc-editor.org/rfc/rfc9110.html#representation.data.and.metadata)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2-1)

HTTP allows "information hiding" behind its uniform interface by defining
communication with respect to a transferable representation of the resource
state, rather than transferring the resource itself. This allows the
resource identified by a URI to be anything, including temporal functions
like "the current weather in Laguna Beach", while potentially providing
information that represents that resource at the time a message is
generated \[ [REST](https://www.rfc-editor.org/rfc/rfc9110.html#REST)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2-2)

The uniform interface is similar to a window through which one can observe
and act upon a thing only through the communication of messages to an
independent actor on the other side. A shared abstraction is needed to
represent ("take the place of") the current or desired state of that thing
in our communications. When a representation is hypertext, it can provide
both a representation of the resource state and processing instructions
that help guide the recipient's future interactions. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2-3)

A [target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) might be provided with, or be capable of
generating, multiple representations that are each intended to reflect the
resource's current state. An algorithm, usually based on
[content negotiation](https://www.rfc-editor.org/rfc/rfc9110.html#content.negotiation) ( [Section 12](https://www.rfc-editor.org/rfc/rfc9110.html#content.negotiation)),
would be used to select one of those representations as being most
applicable to a given request.
This "selected representation" provides the data and metadata
for evaluating conditional requests ( [Section 13](https://www.rfc-editor.org/rfc/rfc9110.html#conditional.requests))
and constructing the content for [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200),
[206 (Partial Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.206), and
[304 (Not Modified)](https://www.rfc-editor.org/rfc/rfc9110.html#status.304) responses to GET ( [Section 9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.2-4)

### [3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.3) [Connections, Clients, and Servers](https://www.rfc-editor.org/rfc/rfc9110.html\#name-connections-clients-and-ser)

HTTP is a client/server protocol that operates over a reliable
transport- or session-layer "connection". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3-1)

An HTTP "client" is a program that establishes a connection
to a server for the purpose of sending one or more HTTP requests.
An HTTP "server" is a program that accepts connections
in order to service HTTP requests by sending HTTP responses. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3-2)

The terms client and server refer only to the roles that
these programs perform for a particular connection. The same program
might act as a client on some connections and a server on others. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3-3)

HTTP is defined as a stateless protocol, meaning that each request message's semantics
can be understood in isolation, and that the relationship between connections
and messages on them has no impact on the interpretation of those messages.
For example, a CONNECT request ( [Section 9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#CONNECT)) or a request with
the Upgrade header field ( [Section 7.8](https://www.rfc-editor.org/rfc/rfc9110.html#field.upgrade)) can occur at any time,
not just in the first message on a connection. Many implementations depend on
HTTP's stateless design in order to reuse proxied connections or dynamically
load balance requests across multiple servers. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3-4)

As a result, a server MUST NOT
assume that two requests on the same connection are from the same user
agent unless the connection is secured and specific to that agent.
Some non-standard HTTP extensions (e.g., \[ [RFC4559](https://www.rfc-editor.org/rfc/rfc9110.html#RFC4559)\]) have
been known to violate this requirement, resulting in security and
interoperability problems. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.3-5)

### [3.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.4) [Messages](https://www.rfc-editor.org/rfc/rfc9110.html\#name-messages)

HTTP is a stateless request/response protocol for exchanging
"messages" across a [connection](https://www.rfc-editor.org/rfc/rfc9110.html#connections).
The terms "sender" and "recipient" refer to
any implementation that sends or receives a given message, respectively. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.4-1)

A client sends requests to a server in the form of a "request"
message with a method ( [Section 9](https://www.rfc-editor.org/rfc/rfc9110.html#methods)) and request target
( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). The request might also contain
header fields ( [Section 6.3](https://www.rfc-editor.org/rfc/rfc9110.html#header.fields)) for request modifiers,
client information, and representation metadata,
content ( [Section 6.4](https://www.rfc-editor.org/rfc/rfc9110.html#content)) intended for processing
in accordance with the method, and
trailer fields ( [Section 6.5](https://www.rfc-editor.org/rfc/rfc9110.html#trailer.fields)) to communicate information
collected while sending the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.4-2)

A server responds to a client's request by sending one or more
"response" messages, each including a status
code ( [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes)). The response might also contain
header fields for server information, resource metadata, and representation
metadata, content to be interpreted in accordance with the status
code, and trailer fields to communicate information
collected while sending the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.4-3)

### [3.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.5) [User Agents](https://www.rfc-editor.org/rfc/rfc9110.html\#name-user-agents)

The term "user agent" refers to any of the various
client programs that initiate a request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.5-1)

The most familiar form of user agent is the general-purpose Web browser, but
that's only a small percentage of implementations. Other common user agents
include spiders (web-traversing robots), command-line tools, billboard
screens, household appliances, scales, light bulbs, firmware update scripts,
mobile apps, and communication devices in a multitude of shapes and sizes. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.5-2)

Being a user agent does not imply that there is a human user directly
interacting with the software agent at the time of a request. In many
cases, a user agent is installed or configured to run in the background
and save its results for later inspection (or save only a subset of those
results that might be interesting or erroneous). Spiders, for example, are
typically given a start URI and configured to follow certain behavior while
crawling the Web as a hypertext graph. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.5-3)

Many user agents cannot, or choose not to,
make interactive suggestions to their user or provide adequate warning for
security or privacy concerns. In the few cases where this
specification requires reporting of errors to the user, it is acceptable
for such reporting to only be observable in an error console or log file.
Likewise, requirements that an automated action be confirmed by the user
before proceeding might be met via advance configuration choices,
run-time options, or simple avoidance of the unsafe action; confirmation
does not imply any specific user interface or interruption of normal
processing if the user has already made that choice. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.5-4)

### [3.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.6) [Origin Server](https://www.rfc-editor.org/rfc/rfc9110.html\#name-origin-server)

The term "origin server" refers to a program that can
originate authoritative responses for a given target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.6-1)

The most familiar form of origin server are large public websites.
However, like user agents being equated with browsers, it is easy to be
misled into thinking that all origin servers are alike.
Common origin servers also include home automation units, configurable
networking components, office machines, autonomous robots, news feeds,
traffic cameras, real-time ad selectors, and video-on-demand platforms. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.6-2)

Most HTTP communication consists of a retrieval request (GET) for
a representation of some resource identified by a URI. In the
simplest case, this might be accomplished via a single bidirectional
connection (===) between the user agent (UA) and the origin server (O). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.6-3)

```
         request   >
    UA ======================================= O
                                <   response
```

[Figure 1](https://www.rfc-editor.org/rfc/rfc9110.html#figure-1)

### [3.7.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.7) [Intermediaries](https://www.rfc-editor.org/rfc/rfc9110.html\#name-intermediaries)

HTTP enables the use of intermediaries to satisfy requests through
a chain of connections. There are three common forms of HTTP
"intermediary": proxy, gateway, and tunnel. In some cases,
a single intermediary might act as an origin server, proxy, gateway,
or tunnel, switching behavior based on the nature of each request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-1)

```
         >             >             >             >
    UA =========== A =========== B =========== C =========== O
               <             <             <             <
```

[Figure 2](https://www.rfc-editor.org/rfc/rfc9110.html#figure-2)

The figure above shows three intermediaries (A, B, and C) between the
user agent and origin server. A request or response message that
travels the whole chain will pass through four separate connections.
Some HTTP communication options
might apply only to the connection with the nearest, non-tunnel
neighbor, only to the endpoints of the chain, or to all connections
along the chain. Although the diagram is linear, each participant might
be engaged in multiple, simultaneous communications. For example, B
might be receiving requests from many clients other than A, and/or
forwarding requests to servers other than C, at the same time that it
is handling A's request. Likewise, later requests might be sent through a
different path of connections, often based on dynamic configuration for
load balancing. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-3)

The terms "upstream" and "downstream" are
used to describe directional requirements in relation to the message flow:
all messages flow from upstream to downstream.
The terms "inbound" and "outbound" are used to describe directional
requirements in relation to the request route:
inbound means "toward the origin server", whereas
outbound means "toward the user agent". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-4)

A "proxy" is a message-forwarding agent that is chosen by the
client, usually via local configuration rules, to receive requests
for some type(s) of absolute URI and attempt to satisfy those
requests via translation through the HTTP interface. Some translations
are minimal, such as for proxy requests for "http" URIs, whereas
other requests might require translation to and from entirely different
application-level protocols. Proxies are often used to group an
organization's HTTP requests through a common intermediary for the
sake of security services, annotation services, or shared caching. Some
proxies are designed to apply transformations to selected messages or
content while they are being forwarded, as described in
[Section 7.7](https://www.rfc-editor.org/rfc/rfc9110.html#message.transformations). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-5)

A "gateway" (a.k.a. "reverse proxy") is an
intermediary that acts as an origin server for the outbound connection but
translates received requests and forwards them inbound to another server or
servers. Gateways are often used to encapsulate legacy or untrusted
information services, to improve server performance through
"accelerator" caching, and to enable partitioning or load
balancing of HTTP services across multiple machines. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-6)

All HTTP requirements applicable to an origin server
also apply to the outbound communication of a gateway.
A gateway communicates with inbound servers using any protocol that
it desires, including private extensions to HTTP that are outside
the scope of this specification. However, an HTTP-to-HTTP gateway
that wishes to interoperate with third-party HTTP servers needs to conform
to user agent requirements on the gateway's inbound connection. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-7)

A "tunnel" acts as a blind relay between two connections
without changing the messages. Once active, a tunnel is not
considered a party to the HTTP communication, though the tunnel might
have been initiated by an HTTP request. A tunnel ceases to exist when
both ends of the relayed connection are closed. Tunnels are used to
extend a virtual connection through an intermediary, such as when
Transport Layer Security (TLS, \[ [TLS13](https://www.rfc-editor.org/rfc/rfc9110.html#TLS13)\]) is used to
establish confidential communication through a shared firewall proxy. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-8)

The above categories for intermediary only consider those acting as
participants in the HTTP communication. There are also intermediaries
that can act on lower layers of the network protocol stack, filtering or
redirecting HTTP traffic without the knowledge or permission of message
senders. Network intermediaries are indistinguishable (at a protocol level)
from an on-path attacker, often introducing security flaws or
interoperability problems due to mistakenly violating HTTP semantics. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-9)

For example, an "interception proxy" \[ [RFC3040](https://www.rfc-editor.org/rfc/rfc9110.html#RFC3040)\] (also commonly
known as a "transparent proxy" \[ [RFC1919](https://www.rfc-editor.org/rfc/rfc9110.html#RFC1919)\])
differs from an HTTP proxy because it is not chosen by the client.
Instead, an interception proxy filters or redirects outgoing TCP port 80
packets (and occasionally other common port traffic).
Interception proxies are commonly found on public network access points,
as a means of enforcing account subscription prior to allowing use of
non-local Internet services, and within corporate firewalls to enforce
network usage policies. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.7-10)

### [3.8.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.8) [Caches](https://www.rfc-editor.org/rfc/rfc9110.html\#name-caches)

A "cache" is a local store of previous response messages and the
subsystem that controls its message storage, retrieval, and deletion.
A cache stores cacheable responses in order to reduce the response
time and network bandwidth consumption on future, equivalent
requests. Any client or server MAY employ a cache, though a cache
cannot be used while acting as a tunnel. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.8-1)

The effect of a cache is that the request/response chain is shortened
if one of the participants along the chain has a cached response
applicable to that request. The following illustrates the resulting
chain if B has a cached copy of an earlier response from O (via C)
for a request that has not been cached by UA or A. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.8-2)

```
            >             >
       UA =========== A =========== B - - - - - - C - - - - - - O
                  <             <
```

[Figure 3](https://www.rfc-editor.org/rfc/rfc9110.html#figure-3)

A response is "cacheable" if a cache is allowed to store a copy of
the response message for use in answering subsequent requests.
Even when a response is cacheable, there might be additional
constraints placed by the client or by the origin server on when
that cached response can be used for a particular request. HTTP
requirements for cache behavior and cacheable responses are
defined in \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.8-4)

There is a wide variety of architectures and configurations
of caches deployed across the World Wide Web and
inside large organizations. These include national hierarchies
of proxy caches to save bandwidth and reduce latency, content delivery
networks that use gateway caching to optimize regional and global distribution of popular sites,
collaborative systems that
broadcast or multicast cache entries, archives of pre-fetched cache
entries for use in off-line or high-latency environments, and so on. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.8-5)

### [3.9.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-3.9) [Example Message Exchange](https://www.rfc-editor.org/rfc/rfc9110.html\#name-example-message-exchange)

The following example illustrates a typical HTTP/1.1 message exchange for a
GET request ( [Section 9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET)) on the URI "http://www.example.com/hello.txt": [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.9-1)

Client request: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.9-2)

```http-message
GET /hello.txt HTTP/1.1
User-Agent: curl/7.64.1
Host: www.example.com
Accept-Language: en, mi
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.9-3)

Server response: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.9-4)

```http-message
HTTP/1.1 200 OK
Date: Mon, 27 Jul 2009 12:28:53 GMT
Server: Apache
Last-Modified: Wed, 22 Jul 2009 19:15:56 GMT
ETag: "34aa387-d-1568eb00"
Accept-Ranges: bytes
Content-Length: 51
Vary: Accept-Encoding
Content-Type: text/plain

Hello World! My content includes a trailing CRLF.
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-3.9-5)

## [4\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4) [Identifiers in HTTP](https://www.rfc-editor.org/rfc/rfc9110.html\#name-identifiers-in-http)

Uniform Resource Identifiers (URIs) \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\] are used
throughout HTTP as the means for identifying resources ( [Section 3.1](https://www.rfc-editor.org/rfc/rfc9110.html#resources)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4-1)

### [4.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.1) [URI References](https://www.rfc-editor.org/rfc/rfc9110.html\#name-uri-references)

URI references are used to target requests, indicate redirects, and define
relationships. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1-1)

The definitions of "URI-reference",
"absolute-URI", "relative-part", "authority", "port", "host",
"path-abempty", "segment", and "query" are adopted from the
URI generic syntax.
An "absolute-path" rule is defined for protocol elements that can contain a
non-empty path component. (This rule differs slightly from the path-abempty
rule of RFC 3986, which allows for an empty path,
and path-absolute rule, which does not allow paths that begin with "//".)
A "partial-URI" rule is defined for protocol elements
that can contain a relative URI but not a fragment component. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1-2)

```abnf9110
  URI-reference = <URI-reference, see [URI], Section 4.1>
  absolute-URI  = <absolute-URI, see [URI], Section 4.3>
  relative-part = <relative-part, see [URI], Section 4.2>
  authority     = <authority, see [URI], Section 3.2>
  uri-host      = <host, see [URI], Section 3.2.2>
  port          = <port, see [URI], Section 3.2.3>
  path-abempty  = <path-abempty, see [URI], Section 3.3>
  segment       = <segment, see [URI], Section 3.3>
  query         = <query, see [URI], Section 3.4>

  absolute-path = 1*( "/" segment )
  partial-URI   = relative-part [ "?" query ]
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1-3)

Each protocol element in HTTP that allows a URI reference will indicate
in its ABNF production whether the element allows any form of reference
(URI-reference), only a URI in absolute form (absolute-URI), only the
path and optional query components (partial-URI),
or some combination of the above.
Unless otherwise indicated, URI references are parsed
relative to the target URI ( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1-4)

It is RECOMMENDED that all senders and recipients support, at a minimum,
URIs with lengths of 8000 octets in protocol elements. Note that this
implies some structures and on-wire representations (for example, the
request line in HTTP/1.1) will necessarily be larger in some cases. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.1-5)

### [4.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2) [HTTP-Related URI Schemes](https://www.rfc-editor.org/rfc/rfc9110.html\#name-http-related-uri-schemes)

IANA maintains the registry of URI Schemes \[ [BCP35](https://www.rfc-editor.org/rfc/rfc9110.html#BCP35)\] at
< [https://www.iana.org/assignments/uri-schemes/](https://www.iana.org/assignments/uri-schemes/) >.
Although requests might target any URI scheme, the following schemes are
inherent to HTTP servers: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2-1)

| URI Scheme | Description | Section |
| --- | --- | --- |
| http | Hypertext Transfer Protocol | [4.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#http.uri) |
| https | Hypertext Transfer Protocol Secure | [4.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#https.uri) |

[Table 2](https://www.rfc-editor.org/rfc/rfc9110.html#table-2)

Note that the presence of an "http" or "https" URI does not imply that
there is always an HTTP server at the identified origin listening for
connections. Anyone can mint a URI, whether or not a server exists and
whether or not that server currently maps that identifier to a resource.
The delegated nature of registered names and IP addresses creates a
federated namespace whether or not an HTTP server is present. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2-3)

#### [4.2.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2.1) [http URI Scheme](https://www.rfc-editor.org/rfc/rfc9110.html\#name-http-uri-scheme)

The "http" URI scheme is hereby defined for minting identifiers within the
hierarchical namespace governed by a potential HTTP origin server
listening for TCP (\[ [TCP](https://www.rfc-editor.org/rfc/rfc9110.html#TCP)\]) connections on a given port. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1-1)

```abnf9110
  http-URI = "http" "://" authority path-abempty [ "?" query ]
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1-2)

The origin server for an "http" URI is identified by the
[authority](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references) component, which includes a host identifier
(\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.2.2](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2))
and optional port number (\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.2.3](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.3)).
If the port subcomponent is empty or not given, TCP port 80 (the
reserved port for WWW services) is the default.
The origin determines who has the right to respond authoritatively to
requests that target the identified resource, as defined in
[Section 4.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#http.origin). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1-3)

A sender MUST NOT generate an "http" URI with an empty host identifier.
A recipient that processes such a URI reference MUST reject it as invalid. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1-4)

The hierarchical path component and optional query component identify the
target resource within that origin server's namespace. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.1-5)

#### [4.2.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2.2) [https URI Scheme](https://www.rfc-editor.org/rfc/rfc9110.html\#name-https-uri-scheme)

The "https" URI scheme is hereby defined for minting identifiers within the
hierarchical namespace governed by a potential origin server listening for
TCP connections on a given port and capable of establishing a TLS
(\[ [TLS13](https://www.rfc-editor.org/rfc/rfc9110.html#TLS13)\]) connection that has been secured for HTTP
communication. In this context, "secured" specifically
means that the server has been authenticated as acting on behalf of the
identified authority and all HTTP communication with that server has
confidentiality and integrity protection that is acceptable to both client
and server. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-1)

```abnf9110
  https-URI = "https" "://" authority path-abempty [ "?" query ]
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-2)

The origin server for an "https" URI is identified by the
[authority](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references) component, which includes a host identifier
(\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.2.2](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2))
and optional port number (\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.2.3](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.3)).
If the port subcomponent is empty or not given, TCP port 443
(the reserved port for HTTP over TLS) is the default.
The origin determines who has the right to respond authoritatively to
requests that target the identified resource, as defined in
[Section 4.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#https.origin). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-3)

A sender MUST NOT generate an "https" URI with an empty host identifier.
A recipient that processes such a URI reference MUST reject it as invalid. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-4)

The hierarchical path component and optional query component identify the
target resource within that origin server's namespace. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-5)

A client MUST ensure that its HTTP requests for an "https" resource are
secured, prior to being communicated, and that it only accepts secured
responses to those requests. Note that the definition of what cryptographic
mechanisms are acceptable to client and server are usually negotiated and
can change over time. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-6)

Resources made available via the "https" scheme have no shared identity
with the "http" scheme. They are distinct origins with separate namespaces.
However, extensions to HTTP that are defined as applying to all origins with
the same host, such as the Cookie protocol \[ [COOKIE](https://www.rfc-editor.org/rfc/rfc9110.html#COOKIE)\],
allow information set by one service to impact communication with other
services within a matching group of host domains. Such extensions ought to
be designed with great care to prevent information obtained from a secured
connection being inadvertently exchanged within an unsecured context. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.2-7)

#### [4.2.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2.3) [http(s) Normalization and Comparison](https://www.rfc-editor.org/rfc/rfc9110.html\#name-https-normalization-and-com)

URIs with an "http" or "https" scheme are normalized and compared according to the
methods defined in [Section 6](https://www.rfc-editor.org/rfc/rfc3986#section-6) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], using
the defaults described above for each scheme. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-1)

HTTP does not require the use of a specific method for determining
equivalence. For example, a cache key might be compared as a simple
string, after syntax-based normalization, or after scheme-based
normalization. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-2)

Scheme-based normalization ([Section 6.2.3](https://www.rfc-editor.org/rfc/rfc3986#section-6.2.3) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\]) of "http" and "https" URIs involves the following
additional rules: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-3)

- If the port is equal to the default port for a scheme, the normal form
is to omit the port subcomponent. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-4.1)
- When not being used as the target of an OPTIONS request, an empty path
component is equivalent to an absolute path of "/", so the normal form is
to provide a path of "/" instead. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-4.2)
- The scheme and host are case-insensitive and normally provided in
lowercase; all other components are compared in a case-sensitive
manner. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-4.3)
- Characters other than those in the "reserved" set are equivalent to
their percent-encoded octets: the normal form is to not encode them (see
Sections [2.1](https://www.rfc-editor.org/rfc/rfc3986#section-2.1) and [2.2](https://www.rfc-editor.org/rfc/rfc3986#section-2.2) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-4.4)

For example, the following three URIs are equivalent: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-5)

```
   http://example.com:80/~smith/home.html
   http://EXAMPLE.com/%7Esmith/home.html
   http://EXAMPLE.com:/%7esmith/home.html
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-6)

Two HTTP URIs that are equivalent after normalization (using any method)
can be assumed to identify the same resource, and any HTTP component MAY
perform normalization. As a result, distinct resources SHOULD NOT be
identified by HTTP URIs that are equivalent after normalization (using any
method defined in [Section 6.2](https://www.rfc-editor.org/rfc/rfc3986#section-6.2) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.3-7)

#### [4.2.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2.4) [Deprecation of userinfo in http(s) URIs](https://www.rfc-editor.org/rfc/rfc9110.html\#name-deprecation-of-userinfo-in-)

The URI generic syntax for authority also includes a userinfo subcomponent
(\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.2.1](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.1)) for including user
authentication information in the URI. In that subcomponent, the
use of the format "user:password" is deprecated. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.4-1)

Some implementations make use of the userinfo component for internal
configuration of authentication information, such as within command
invocation options, configuration files, or bookmark lists, even
though such usage might expose a user identifier or password. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.4-2)

A sender MUST NOT generate the userinfo subcomponent (and its "@"
delimiter) when an "http" or "https" URI reference is generated within a
message as a target URI or field value. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.4-3)

Before making use of an "http" or "https" URI reference received from an untrusted
source, a recipient SHOULD parse for userinfo and treat its presence as
an error; it is likely being used to obscure the authority for the sake of
phishing attacks. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.4-4)

#### [4.2.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.2.5) [http(s) References with Fragment Identifiers](https://www.rfc-editor.org/rfc/rfc9110.html\#name-https-references-with-fragm)

Fragment identifiers allow for indirect identification
of a secondary resource, independent of the URI scheme, as defined in
[Section 3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\].
Some protocol elements that refer to a URI allow inclusion of a fragment,
while others do not. They are distinguished by use of the ABNF rule for
elements where fragment is allowed; otherwise, a specific rule that excludes
fragments is used. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.2.5-1)

### [4.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3) [Authoritative Access](https://www.rfc-editor.org/rfc/rfc9110.html\#name-authoritative-access)

Authoritative access refers to dereferencing a given identifier,
for the sake of access to the identified resource, in a way that the client
believes is authoritative (controlled by the resource owner). The process
for determining whether access is granted is defined by the URI scheme and often uses
data within the URI components, such as the authority component when
the generic syntax is used. However, authoritative access is not limited to
the identified mechanism. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3-1)

[Section 4.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#origin) defines the concept of an origin as an aid to
such uses, and the subsequent subsections explain how to establish that a
peer has the authority to represent an origin. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3-2)

See [Section 17.1](https://www.rfc-editor.org/rfc/rfc9110.html#establishing.authority) for security considerations
related to establishing authority. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3-3)

#### [4.3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3.1) [URI Origin](https://www.rfc-editor.org/rfc/rfc9110.html\#name-uri-origin)

The "origin" for a given URI is the triple of scheme, host,
and port after normalizing the scheme and host to lowercase and
normalizing the port to remove any leading zeros. If port is elided from
the URI, the default port for that scheme is used. For example, the URI [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-1)

```
   https://Example.Com/happy.js
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-2)

would have the origin [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-3)

```
   { "https", "example.com", "443" }
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-4)

which can also be described as the normalized URI prefix with port always
present: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-5)

```
   https://example.com:443
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-6)

Each origin defines its own namespace and controls how identifiers
within that namespace are mapped to resources. In turn, how the origin
responds to valid requests, consistently over time, determines the
semantics that users will associate with a URI, and the usefulness of
those semantics is what ultimately transforms these mechanisms into a
resource for users to reference and access in the future. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-7)

Two origins are distinct if they differ in scheme, host, or port. Even
when it can be verified that the same entity controls two distinct origins,
the two namespaces under those origins are distinct unless explicitly
aliased by a server authoritative for that origin. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-8)

Origin is also used within HTML and related Web protocols, beyond the
scope of this document, as described in \[ [RFC6454](https://www.rfc-editor.org/rfc/rfc9110.html#RFC6454)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.1-9)

#### [4.3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3.2) [http Origins](https://www.rfc-editor.org/rfc/rfc9110.html\#name-http-origins)

Although HTTP is independent of the transport protocol, the "http" scheme
( [Section 4.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#http.uri)) is specific to associating authority with
whomever controls the origin
server listening for TCP connections on the indicated port of whatever
host is identified within the authority component. This is a very weak
sense of authority because it depends on both client-specific name
resolution mechanisms and communication that might not be secured from
an on-path attacker. Nevertheless, it is a sufficient minimum for
binding "http" identifiers to an origin server for consistent resolution
within a trusted environment. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.2-1)

If the host identifier is provided as an IP address, the origin server is
the listener (if any) on the indicated TCP port at that IP address.
If host is a registered name, the registered name is an indirect identifier
for use with a name resolution service, such as DNS, to find an address for
an appropriate origin server. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.2-2)

When an "http" URI is used within a context that calls for access to the
indicated resource, a client MAY attempt access by resolving the host
identifier to an IP address, establishing a TCP connection to that
address on the indicated port, and sending over that connection an HTTP
request message containing a request target that matches the client's
target URI ( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.2-3)

If the server responds to such a request with a non-interim HTTP response
message, as described in [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes), then that response
is considered an authoritative answer to the client's request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.2-4)

Note, however, that the above is not the only means for obtaining an
authoritative response, nor does it imply that an authoritative response
is always necessary (see \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]).
For example, the Alt-Svc header field \[ [ALTSVC](https://www.rfc-editor.org/rfc/rfc9110.html#ALTSVC)\] allows an
origin server to identify other services that are also authoritative for
that origin. Access to "http" identified resources might also be provided
by protocols outside the scope of this document. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.2-5)

#### [4.3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3.3) [https Origins](https://www.rfc-editor.org/rfc/rfc9110.html\#name-https-origins)

The "https" scheme ( [Section 4.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#https.uri)) associates authority based
on the ability of a server to use the private key corresponding to a
certificate that the client considers to be trustworthy for the identified
origin server. The client usually relies upon a chain of trust, conveyed
from some prearranged or configured trust anchor, to deem a certificate
trustworthy ( [Section 4.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#https.verify)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-1)

In HTTP/1.1 and earlier, a client will only attribute authority to a server
when they are communicating over a successfully established and secured
connection specifically to that URI origin's host. The connection
establishment and certificate verification are used as proof of authority. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-2)

In HTTP/2 and HTTP/3, a client will attribute authority to a server when
they are communicating over a successfully established and secured
connection if the URI origin's host matches any of the hosts present in the
server's certificate and the client believes that it could open a connection
to that host for that URI. In practice, a client will make a DNS query to
check that the origin's host contains the same server IP address as the
established connection. This restriction can be removed by the origin server
sending an equivalent ORIGIN frame \[ [RFC8336](https://www.rfc-editor.org/rfc/rfc9110.html#RFC8336)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-3)

The request target's host and port value are passed within each HTTP
request, identifying the origin and distinguishing it from other namespaces
that might be controlled by the same server ( [Section 7.2](https://www.rfc-editor.org/rfc/rfc9110.html#field.host)).
It is the origin's responsibility to ensure that any services provided with
control over its certificate's private key are equally responsible for
managing the corresponding "https" namespaces or at least prepared to
reject requests that appear to have been misdirected
( [Section 7.4](https://www.rfc-editor.org/rfc/rfc9110.html#routing.reject)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-4)

An origin server might be unwilling to process requests for certain target
URIs even when they have the authority to do so. For example, when a host
operates distinct services on different ports (e.g., 443 and 8000), checking
the target URI at the origin server is necessary (even after the connection
has been secured) because a network attacker might cause connections for one
port to be received at some other port. Failing to check the target URI
might allow such an attacker to replace a response to one target URI
(e.g., "https://example.com/foo") with a seemingly authoritative response
from the other port (e.g., "https://example.com:8000/foo"). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-5)

Note that the "https" scheme does not rely on TCP and the connected port
number for associating authority, since both are outside the secured
communication and thus cannot be trusted as definitive. Hence, the HTTP
communication might take place over any channel that has been secured,
as defined in [Section 4.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#https.uri), including protocols that don't
use TCP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-6)

When an "https" URI is used within a context that calls for access to
the indicated resource, a client MAY attempt access by resolving the
host identifier to an IP address, establishing a TCP connection to that
address on the indicated port, securing the connection end-to-end by
successfully initiating TLS over TCP with confidentiality and integrity
protection, and sending over that connection an HTTP request message
containing a request target that matches the client's target URI
( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-7)

If the server responds to such a request with a non-interim HTTP response
message, as described in [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes), then that response
is considered an authoritative answer to the client's request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-8)

Note, however, that the above is not the only means for obtaining an
authoritative response, nor does it imply that an authoritative response
is always necessary (see \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.3-9)

#### [4.3.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3.4) [https Certificate Verification](https://www.rfc-editor.org/rfc/rfc9110.html\#name-https-certificate-verificat)

To establish a [secured](https://www.rfc-editor.org/rfc/rfc9110.html#https.uri) connection to dereference a URI,
a client MUST verify that the service's identity is an acceptable
match for the URI's origin server. Certificate verification is used to
prevent server impersonation by an on-path attacker or by an attacker
that controls name resolution. This process requires that a client be
configured with a set of trust anchors. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-1)

In general, a client MUST verify the service identity using the
verification process defined in
[Section 6](https://www.rfc-editor.org/rfc/rfc6125#section-6) of \[ [RFC6125](https://www.rfc-editor.org/rfc/rfc9110.html#RFC6125)\]. The client MUST construct
a reference identity from the service's host: if the host is a literal IP address
( [Section 4.3.5](https://www.rfc-editor.org/rfc/rfc9110.html#https.ip-id)), the reference identity is an IP-ID, otherwise
the host is a name and the reference identity is a DNS-ID. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-2)

A reference identity of type CN-ID MUST NOT be used by clients. As noted
in [Section 6.2.1](https://www.rfc-editor.org/rfc/rfc6125#section-6.2.1) of \[ [RFC6125](https://www.rfc-editor.org/rfc/rfc9110.html#RFC6125)\], a reference
identity of type CN-ID might be used by older clients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-3)

A client might be specially configured to accept an alternative form of
server identity verification. For example, a client might be connecting
to a server whose address and hostname are dynamic, with an expectation that
the service will present a specific certificate (or a certificate matching
some externally defined reference identity) rather than one matching the
target URI's origin. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-4)

In special cases, it might be appropriate for
a client to simply ignore the server's identity, but it must be
understood that this leaves a connection open to active attack. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-5)

If the certificate is not valid for the target URI's origin,
a user agent MUST either obtain confirmation from the user
before proceeding (see [Section 3.5](https://www.rfc-editor.org/rfc/rfc9110.html#user.agent)) or
terminate the connection with a bad certificate error. Automated
clients MUST log the error to an appropriate audit log (if available)
and SHOULD terminate the connection (with a bad certificate error).
Automated clients MAY provide a configuration setting that disables
this check, but MUST provide a setting which enables it. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.4-6)

#### [4.3.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-4.3.5) [IP-ID Reference Identity](https://www.rfc-editor.org/rfc/rfc9110.html\#name-ip-id-reference-identity)

A server that is identified using an IP address literal in the "host" field
of an "https" URI has a reference identity of type IP-ID. An IP version 4
address uses the "IPv4address" ABNF rule, and an IP version 6 address uses
the "IP-literal" production with the "IPv6address" option; see
[Section 3.2.2](https://www.rfc-editor.org/rfc/rfc3986#section-3.2.2) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\]. A reference identity of
IP-ID contains the decoded bytes of the IP address. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.5-1)

An IP version 4 address is 4 octets, and an IP version 6 address is 16 octets.
Use of IP-ID is not defined for any other IP version. The iPAddress
choice in the certificate subjectAltName extension does not explicitly
include the IP version and so relies on the length of the address to
distinguish versions; see
[Section 4.2.1.6](https://www.rfc-editor.org/rfc/rfc5280#section-4.2.1.6) of \[ [RFC5280](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5280)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.5-2)

A reference identity of type IP-ID matches if the address is identical to
an iPAddress value of the subjectAltName extension of the certificate. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-4.3.5-3)

## [5\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5) [Fields](https://www.rfc-editor.org/rfc/rfc9110.html\#name-fields)

HTTP uses "fields" to provide data in the form of extensible
name/value pairs with a registered key namespace. Fields are sent and
received within the header and trailer sections of messages
( [Section 6](https://www.rfc-editor.org/rfc/rfc9110.html#message.abstraction)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5-1)

### [5.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.1) [Field Names](https://www.rfc-editor.org/rfc/rfc9110.html\#name-field-names)

A field name labels the corresponding field value as having the
semantics defined by that name. For example, the [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date)
header field is defined in [Section 6.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) as containing the
origination timestamp for the message in which it appears. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-1)

```abnf9110
  field-name     = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-2)

Field names are case-insensitive and ought to be registered within the
"Hypertext Transfer Protocol (HTTP) Field Name Registry"; see [Section 16.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#fields.registry). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-3)

The interpretation of a field does not change between minor
versions of the same major HTTP version, though the default behavior of a
recipient in the absence of such a field can change. Unless specified
otherwise, fields are defined for all versions of HTTP.
In particular, the [Host](https://www.rfc-editor.org/rfc/rfc9110.html#field.host) and [Connection](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection)
fields ought to be recognized by all HTTP implementations
whether or not they advertise conformance with HTTP/1.1. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-4)

New fields can be introduced without changing the protocol version if
their defined semantics allow them to be safely ignored by recipients
that do not recognize them; see [Section 16.3](https://www.rfc-editor.org/rfc/rfc9110.html#fields.extensibility). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-5)

A proxy MUST forward unrecognized header fields unless the
field name is listed in the [Connection](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection) header field
( [Section 7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection)) or the proxy is specifically
configured to block, or otherwise transform, such fields.
Other recipients SHOULD ignore unrecognized header and trailer fields.
Adhering to these requirements allows HTTP's functionality to be extended
without updating or removing deployed intermediaries. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1-6)

### [5.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.2) [Field Lines and Combined Field Value](https://www.rfc-editor.org/rfc/rfc9110.html\#name-field-lines-and-combined-fi)

Field sections are composed of any number of "field lines",
each with a "field name" (see [Section 5.1](https://www.rfc-editor.org/rfc/rfc9110.html#fields.names))
identifying the field, and a "field line value" that conveys
data for that instance of the field. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2-1)

When a field name is only present once in a section, the combined
"field value" for that field consists of the corresponding
field line value.
When a field name is repeated within a section, its combined field value
consists of the list of corresponding field line values within that section,
concatenated in order, with each field line value separated by a comma. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2-2)

For example, this section: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2-3)

```http-message
Example-Field: Foo, Bar
Example-Field: Baz
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2-4)

contains two field lines, both with the field name "Example-Field". The
first field line has a field line value of "Foo, Bar", while the second
field line value is "Baz". The field value for "Example-Field" is the list
"Foo, Bar, Baz". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2-5)

### [5.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.3) [Field Order](https://www.rfc-editor.org/rfc/rfc9110.html\#name-field-order)

A recipient MAY combine multiple field lines within a field section that
have the same field name
into one field line, without changing the semantics of the message, by
appending each subsequent field line value to the initial field line value
in order, separated by a comma (",") and optional whitespace
( [OWS](https://www.rfc-editor.org/rfc/rfc9110.html#whitespace), defined in [Section 5.6.3](https://www.rfc-editor.org/rfc/rfc9110.html#whitespace)).
For consistency, use comma SP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3-1)

The order in which field lines with the
same name are received is therefore significant to the interpretation of
the field value; a proxy MUST NOT change the order of these field line
values when forwarding a message. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3-2)

This means that, aside from the well-known exception noted below, a sender
MUST NOT generate multiple field lines with the same name in a message
(whether in the headers or trailers) or append a field line when a field
line of the same name already exists in the message, unless that field's
definition allows multiple field line values to be recombined as a
comma-separated list (i.e., at least one alternative of the field's
definition allows a comma-separated list, such as an ABNF rule of
#(values) defined in [Section 5.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#abnf.extension)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3-3)

The order in which field lines with differing field names are received in a
section is not significant. However, it is good practice to send header
fields that contain additional control data first, such as
[Host](https://www.rfc-editor.org/rfc/rfc9110.html#field.host) on requests and [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) on responses, so
that implementations can decide when not to handle a message as early as
possible. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3-5)

A server MUST NOT apply a request to the target resource until it
receives the entire request header section, since later header field lines
might include conditionals, authentication credentials, or deliberately
misleading duplicate header fields that could impact request processing. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.3-6)

### [5.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.4) [Field Limits](https://www.rfc-editor.org/rfc/rfc9110.html\#name-field-limits)

HTTP does not place a predefined limit on the length of each field line, field value,
or on the length of a header or trailer section as a whole, as described in
[Section 2](https://www.rfc-editor.org/rfc/rfc9110.html#conformance). Various ad hoc limitations on individual
lengths are found in practice, often depending on the specific
field's semantics. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.4-1)

A server that receives a request header field line, field value, or set of
fields larger than it wishes to process MUST respond with an appropriate
[4xx (Client Error)](https://www.rfc-editor.org/rfc/rfc9110.html#status.4xx) status code. Ignoring such header fields
would increase the server's vulnerability to request smuggling attacks
([Section 11.2](https://www.rfc-editor.org/rfc/rfc9112#section-11.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.4-2)

A client MAY discard or truncate received field lines that are larger
than the client wishes to process if the field semantics are such that the
dropped value(s) can be safely ignored without changing the
message framing or response semantics. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.4-3)

### [5.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.5) [Field Values](https://www.rfc-editor.org/rfc/rfc9110.html\#name-field-values)

HTTP field values consist of a sequence of characters in a format defined
by the field's grammar. Each field's grammar is usually defined using
ABNF (\[ [RFC5234](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5234)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-1)

```abnf9110
  field-value    = *field-content
  field-content  = field-vchar
                   [ 1*( SP / HTAB / field-vchar ) field-vchar ]
  field-vchar    = VCHAR / obs-text
  obs-text       = %x80-FF
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-2)

A field value does not include leading or trailing whitespace. When a
specific version of HTTP allows such whitespace to appear in a message,
a field parsing implementation MUST exclude such whitespace prior to
evaluating the field value. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-3)

Field values are usually constrained to the range of US-ASCII characters
\[ [USASCII](https://www.rfc-editor.org/rfc/rfc9110.html#USASCII)\].
Fields needing a greater range of characters can use an encoding,
such as the one defined in \[ [RFC8187](https://www.rfc-editor.org/rfc/rfc9110.html#RFC8187)\].
Historically, HTTP allowed field content with text in the ISO-8859-1
charset \[ [ISO-8859-1](https://www.rfc-editor.org/rfc/rfc9110.html#ISO-8859-1)\], supporting other charsets only
through use of \[ [RFC2047](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2047)\] encoding.
Specifications for newly defined fields SHOULD limit their values to
visible US-ASCII octets (VCHAR), SP, and HTAB.
A recipient SHOULD treat other allowed octets in field content
(i.e., [obs-text](https://www.rfc-editor.org/rfc/rfc9110.html#fields.values)) as opaque data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-4)

Field values containing CR, LF, or NUL characters are invalid and dangerous,
due to the varying ways that implementations might parse and interpret
those characters; a recipient of CR, LF, or NUL within a field value MUST
either reject the message or replace each of those characters with SP
before further processing or forwarding of that message. Field values
containing other CTL characters are also invalid; however,
recipients MAY retain such characters for the sake of robustness when
they appear within a safe context (e.g., an application-specific quoted
string that will not be processed by any downstream HTTP parser). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-5)

Fields that only anticipate a single member as the field value are
referred to as "singleton fields". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-6)

Fields that allow multiple members as the field value are referred to as
"list-based fields". The list operator extension of
[Section 5.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#abnf.extension) is used as a common notation for defining
field values that can contain multiple members. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-7)

Because commas (",") are used as the delimiter between members, they need
to be treated with care if they are allowed as data within a member. This
is true for both list-based and singleton fields, since a singleton field
might be erroneously sent with multiple members and detecting such errors
improves interoperability. Fields that expect to contain a
comma within a member, such as within an [HTTP-date](https://www.rfc-editor.org/rfc/rfc9110.html#http.date) or
[URI-reference](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references)
element, ought to be defined with delimiters around that element to
distinguish any comma within that data from potential list separators. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-8)

For example, a textual date and a URI (either of which might contain a comma)
could be safely carried in list-based field values like these: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-9)

```http-message
Example-URIs: "http://example.com/a.html,foo",
              "http://without-a-comma.example.com/"
Example-Dates: "Sat, 04 May 1996", "Wed, 14 Sep 2005"
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-10)

Note that double-quote delimiters are almost always used with the
quoted-string production ( [Section 5.6.4](https://www.rfc-editor.org/rfc/rfc9110.html#quoted.strings)); using a different syntax inside double-quotes
will likely cause unnecessary confusion. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-11)

Many fields (such as [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type), defined in
[Section 8.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type)) use a common syntax for parameters
that allows both unquoted (token) and quoted (quoted-string) syntax for
a parameter value ( [Section 5.6.6](https://www.rfc-editor.org/rfc/rfc9110.html#parameter)). Use of common syntax
allows recipients to reuse existing parser components. When allowing both
forms, the meaning of a parameter value ought to be the same whether it
was received as a token or a quoted string. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.5-12)

### [5.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6) [Common Rules for Defining Field Values](https://www.rfc-editor.org/rfc/rfc9110.html\#name-common-rules-for-defining-f)

#### [5.6.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.1) [Lists (\#rule ABNF Extension)](https://www.rfc-editor.org/rfc/rfc9110.html\#name-lists-rule-abnf-extension)

A #rule extension to the ABNF rules of \[ [RFC5234](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5234)\] is used to
improve readability in the definitions of some list-based field values. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1-1)

A construct "#" is defined, similar to "\*", for defining comma-delimited
lists of elements. The full form is "<n>#<m>element" indicating
at least <n> and at most <m> elements, each separated by a single
comma (",") and optional whitespace ( [OWS](https://www.rfc-editor.org/rfc/rfc9110.html#whitespace),
defined in [Section 5.6.3](https://www.rfc-editor.org/rfc/rfc9110.html#whitespace)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1-2)

##### [5.6.1.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.1.1) [Sender Requirements](https://www.rfc-editor.org/rfc/rfc9110.html\#name-sender-requirements)

In any production that uses the list construct, a sender MUST NOT
generate empty list elements. In other words, a sender has to generate
lists that satisfy the following syntax: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-1)

```
  1#element => element *( OWS "," OWS element )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-2)

and: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-3)

```
  #element => [ 1#element ]
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-4)

and for n >= 1 and m > 1: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-5)

```
  <n>#<m>element => element <n-1>*<m-1>( OWS "," OWS element )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-6)

[Appendix A](https://www.rfc-editor.org/rfc/rfc9110.html#collected.abnf) shows the collected ABNF for senders
after the list constructs have been expanded. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.1-7)

##### [5.6.1.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.1.2) [Recipient Requirements](https://www.rfc-editor.org/rfc/rfc9110.html\#name-recipient-requirements)

Empty elements do not contribute to the count of elements present.
A recipient MUST parse and ignore
a reasonable number of empty list elements: enough to handle common mistakes
by senders that merge values, but not so much that they could be used as a
denial-of-service mechanism. In other words, a recipient MUST accept lists
that satisfy the following syntax: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-1)

```
  #element => [ element ] *( OWS "," OWS [ element ] )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-2)

Note that because of the potential presence of empty list elements, the
RFC 5234 ABNF cannot enforce the cardinality of list elements, and
consequently all cases are mapped as if there was no cardinality specified. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-3)

For example, given these ABNF productions: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-4)

```
  example-list      = 1#example-list-elmt
  example-list-elmt = token ; see Section 5.6.2
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-5)

Then the following are valid values for example-list (not including the
double quotes, which are present for delimitation only): [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-6)

```
  "foo,bar"
  "foo ,bar,"
  "foo , ,bar,charlie"
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-7)

In contrast, the following values would be invalid, since at least one
non-empty element is required by the example-list production: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-8)

```
  ""
  ","
  ",   ,"
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.1.2-9)

#### [5.6.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.2) [Tokens](https://www.rfc-editor.org/rfc/rfc9110.html\#name-tokens)



Tokens are short textual identifiers that do not include whitespace or
delimiters. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2-1)

```abnf9110
  token          = 1*tchar

  tchar          = "!" / "#" / "$" / "%" / "&" / "'" / "*"
                 / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~"
                 / DIGIT / ALPHA
                 ; any VCHAR, except delimiters
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2-2)

Many HTTP field values are defined using common syntax
components, separated by whitespace or specific delimiting characters.
Delimiters are chosen from the set of US-ASCII visual characters not
allowed in a [token](https://www.rfc-editor.org/rfc/rfc9110.html#rule.token.separators) (DQUOTE and "(),/:;<=>?@\[\\\]{}"). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2-3)

#### [5.6.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.3) [Whitespace](https://www.rfc-editor.org/rfc/rfc9110.html\#name-whitespace)

This specification uses three rules to denote the use of linear
whitespace: OWS (optional whitespace), RWS (required whitespace), and
BWS ("bad" whitespace). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-1)

The OWS rule is used where zero or more linear whitespace octets might
appear. For protocol elements where optional whitespace is preferred to
improve readability, a sender SHOULD generate the optional whitespace
as a single SP; otherwise, a sender SHOULD NOT generate optional
whitespace except as needed to overwrite invalid or unwanted protocol
elements during in-place message filtering. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-2)

The RWS rule is used when at least one linear whitespace octet is required
to separate field tokens. A sender SHOULD generate RWS as a single SP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-3)

OWS and RWS have the same semantics as a single SP. Any content known to
be defined as OWS or RWS MAY be replaced with a single SP before
interpreting it or forwarding the message downstream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-4)

The BWS rule is used where the grammar allows optional whitespace only for
historical reasons. A sender MUST NOT generate BWS in messages.
A recipient MUST parse for such bad whitespace and remove it before
interpreting the protocol element. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-5)

BWS has no semantics. Any content known to be
defined as BWS MAY be removed before interpreting it or forwarding the
message downstream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-6)

```abnf9110
  OWS            = *( SP / HTAB )
                 ; optional whitespace
  RWS            = 1*( SP / HTAB )
                 ; required whitespace
  BWS            = OWS
                 ; "bad" whitespace
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.3-7)

#### [5.6.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.4) [Quoted Strings](https://www.rfc-editor.org/rfc/rfc9110.html\#name-quoted-strings)



A string of text is parsed as a single value if it is quoted using
double-quote marks. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4-1)

```abnf9110
  quoted-string  = DQUOTE *( qdtext / quoted-pair ) DQUOTE
  qdtext         = HTAB / SP / %x21 / %x23-5B / %x5D-7E / obs-text
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4-2)


The backslash octet ("\\") can be used as a single-octet
quoting mechanism within quoted-string and comment constructs.
Recipients that process the value of a quoted-string MUST handle a
quoted-pair as if it were replaced by the octet following the backslash. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4-3)

```abnf9110
  quoted-pair    = "\" ( HTAB / SP / VCHAR / obs-text )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4-4)

A sender SHOULD NOT generate a quoted-pair in a quoted-string except
where necessary to quote DQUOTE and backslash octets occurring within that
string.
A sender SHOULD NOT generate a quoted-pair in a comment except
where necessary to quote parentheses \["(" and ")"\] and backslash octets
occurring within that comment. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.4-5)

#### [5.6.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.5) [Comments](https://www.rfc-editor.org/rfc/rfc9110.html\#name-comments)



Comments can be included in some HTTP fields by surrounding
the comment text with parentheses. Comments are only allowed in
fields containing "comment" as part of their field value definition. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.5-1)

```abnf9110
  comment        = "(" *( ctext / quoted-pair / comment ) ")"
  ctext          = HTAB / SP / %x21-27 / %x2A-5B / %x5D-7E / obs-text
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.5-2)

#### [5.6.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.6) [Parameters](https://www.rfc-editor.org/rfc/rfc9110.html\#name-parameters)




Parameters are instances of name/value pairs; they are often used in field
values as a common syntax for appending auxiliary information to an item.
Each parameter is usually delimited by an immediately preceding semicolon. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.6-1)

```abnf9110
  parameters      = *( OWS ";" OWS [ parameter ] )
  parameter       = parameter-name "=" parameter-value
  parameter-name  = token
  parameter-value = ( token / quoted-string )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.6-2)

Parameter names are case-insensitive. Parameter values might or might
not be case-sensitive, depending on the semantics of the parameter
name. Examples of parameters and some equivalent forms can be seen in
media types ( [Section 8.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#media.type)) and the Accept header field
( [Section 12.5.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.6-3)

A parameter value that matches the [token](https://www.rfc-editor.org/rfc/rfc9110.html#rule.token.separators) production can be
transmitted either as a token or within a quoted-string. The quoted and
unquoted values are equivalent. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.6-4)

#### [5.6.7.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-5.6.7) [Date/Time Formats](https://www.rfc-editor.org/rfc/rfc9110.html\#name-date-time-formats)

Prior to 1995, there were three different formats commonly used by servers
to communicate timestamps. For compatibility with old implementations, all
three are defined here. The preferred format is a fixed-length and
single-zone subset of the date and time specification used by the
Internet Message Format \[ [RFC5322](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5322)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-1)

```abnf9110
  HTTP-date    = IMF-fixdate / obs-date
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-2)

An example of the preferred format is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-3)

```
  Sun, 06 Nov 1994 08:49:37 GMT    ; IMF-fixdate
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-4)

Examples of the two obsolete formats are [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-5)

```
  Sunday, 06-Nov-94 08:49:37 GMT   ; obsolete RFC 850 format
  Sun Nov  6 08:49:37 1994         ; ANSI C's asctime() format
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-6)

A recipient that parses a timestamp value in an HTTP field MUST
accept all three HTTP-date formats. When a sender generates a field
that contains one or more timestamps defined as HTTP-date,
the sender MUST generate those timestamps in the IMF-fixdate format. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-7)

An HTTP-date value represents time as an instance of Coordinated
Universal Time (UTC). The first two formats indicate UTC by the
three-letter abbreviation for Greenwich Mean Time, "GMT", a predecessor
of the UTC name; values in the asctime format are assumed to be in UTC. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-8)

A "clock" is an implementation capable of providing a
reasonable approximation of the current instant in UTC.
A clock implementation ought to use NTP (\[ [RFC5905](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5905)\]),
or some similar protocol, to synchronize with UTC. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-9)











Preferred format: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-10)

```abnf9110
  IMF-fixdate  = day-name "," SP date1 SP time-of-day SP GMT
  ; fixed length/zone/capitalization subset of the format
  ; see Section 3.3 of [RFC5322]

  day-name     = %s"Mon" / %s"Tue" / %s"Wed"
               / %s"Thu" / %s"Fri" / %s"Sat" / %s"Sun"

  date1        = day SP month SP year
               ; e.g., 02 Jun 1982

  day          = 2DIGIT
  month        = %s"Jan" / %s"Feb" / %s"Mar" / %s"Apr"
               / %s"May" / %s"Jun" / %s"Jul" / %s"Aug"
               / %s"Sep" / %s"Oct" / %s"Nov" / %s"Dec"
  year         = 4DIGIT

  GMT          = %s"GMT"

  time-of-day  = hour ":" minute ":" second
               ; 00:00:00 - 23:59:60 (leap second)

  hour         = 2DIGIT
  minute       = 2DIGIT
  second       = 2DIGIT
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-11)








Obsolete formats: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-12)

```abnf9110
  obs-date     = rfc850-date / asctime-date
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-13)

```abnf9110
  rfc850-date  = day-name-l "," SP date2 SP time-of-day SP GMT
  date2        = day "-" month "-" 2DIGIT
               ; e.g., 02-Jun-82

  day-name-l   = %s"Monday" / %s"Tuesday" / %s"Wednesday"
               / %s"Thursday" / %s"Friday" / %s"Saturday"
               / %s"Sunday"
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-14)

```abnf9110
  asctime-date = day-name SP date3 SP time-of-day SP year
  date3        = month SP ( 2DIGIT / ( SP 1DIGIT ))
               ; e.g., Jun  2
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-15)

HTTP-date is case sensitive. Note that [Section 4.2](https://www.rfc-editor.org/rfc/rfc9111#section-4.2) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\] relaxes this for cache recipients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-16)

A sender MUST NOT generate additional whitespace in an HTTP-date beyond
that specifically included as SP in the grammar.
The semantics of [day-name](https://www.rfc-editor.org/rfc/rfc9110.html#preferred.date.format), [day](https://www.rfc-editor.org/rfc/rfc9110.html#preferred.date.format),
[month](https://www.rfc-editor.org/rfc/rfc9110.html#preferred.date.format), [year](https://www.rfc-editor.org/rfc/rfc9110.html#preferred.date.format), and [time-of-day](https://www.rfc-editor.org/rfc/rfc9110.html#preferred.date.format)
are the same as those defined for the Internet Message Format constructs
with the corresponding name (\[ [RFC5322](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5322)\], [Section 3.3](https://www.rfc-editor.org/rfc/rfc5322#section-3.3)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-17)

Recipients of a timestamp value in rfc850-date format, which uses a
two-digit year, MUST interpret a timestamp that appears to be more
than 50 years in the future as representing the most recent year in the
past that had the same last two digits. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-18)

Recipients of timestamp values are encouraged to be robust in parsing
timestamps unless otherwise restricted by the field definition.
For example, messages are occasionally forwarded over HTTP from a non-HTTP
source that might generate any of the date and time specifications defined
by the Internet Message Format. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.7-19)

## [6\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6) [Message Abstraction](https://www.rfc-editor.org/rfc/rfc9110.html\#name-message-abstraction)

Each major version of HTTP defines its own syntax for communicating
messages. This section defines an abstract data type for HTTP messages
based on a generalization of those message characteristics, common structure,
and capacity for conveying semantics. This abstraction is used to define
requirements on senders and recipients that are independent of the HTTP
version, such that a message in one version can be relayed through other
versions without changing its meaning. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-1)

A "message" consists of the following: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-2)

- control data to describe and route the message, [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-3.1)
- a headers lookup table of name/value pairs for extending that control
data and conveying additional information about the sender, message,
content, or context, [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-3.2)
- a potentially unbounded stream of content, and [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-3.3)
- a trailers lookup table of name/value pairs for communicating information
obtained while sending the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-3.4)

Framing and control data is sent first, followed by a header section
containing fields for the headers table. When a message includes content,
the content is sent after the header section, potentially followed by a
trailer section that might contain fields for the trailers table. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-4)

Messages are expected to be processed as a stream, wherein the purpose of
that stream and its continued processing is revealed while being read.
Hence, control data describes what the recipient needs to know immediately,
header fields describe what needs to be known before receiving content,
the content (when present) presumably contains what the recipient wants or
needs to fulfill the message semantics, and trailer fields provide
optional metadata that was unknown prior to sending the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-5)

Messages are intended to be "self-descriptive":
everything a recipient needs to know about the message can be determined by
looking at the message itself, after decoding or reconstituting parts that
have been compressed or elided in transit, without requiring an
understanding of the sender's current application state (established via
prior messages). However, a client MUST retain knowledge of the request when
parsing, interpreting, or caching a corresponding response. For example,
responses to the [HEAD](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD) method look just like the beginning of a
response to [GET](https://www.rfc-editor.org/rfc/rfc9110.html#GET) but cannot be parsed in the same manner. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-6)

Note that this message abstraction is a generalization across many versions
of HTTP, including features that might not be found in some versions. For
example, trailers were introduced within the HTTP/1.1 chunked transfer
coding as a trailer section after the content. An equivalent feature is
present in HTTP/2 and HTTP/3 within the header block that terminates each
stream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6-7)

### [6.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.1) [Framing and Completeness](https://www.rfc-editor.org/rfc/rfc9110.html\#name-framing-and-completeness)

Message framing indicates how each message begins and ends, such that each
message can be distinguished from other messages or noise on the same
connection. Each major version of HTTP defines its own framing mechanism. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.1-1)

HTTP/0.9 and early deployments of HTTP/1.0 used closure of the underlying
connection to end a response. For backwards compatibility, this implicit
framing is also allowed in HTTP/1.1. However, implicit framing can fail to
distinguish an incomplete response if the connection closes early. For
that reason, almost all modern implementations use explicit framing in
the form of length-delimited sequences of message data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.1-2)

A message is considered "complete" when all of the octets
indicated by its framing are available. Note that,
when no explicit framing is used, a response message that is ended
by the underlying connection's close is considered complete even though it
might be indistinguishable from an incomplete response, unless a
transport-level error indicates that it is not complete. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.1-3)

### [6.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.2) [Control Data](https://www.rfc-editor.org/rfc/rfc9110.html\#name-control-data)

Messages start with control data that describe its primary purpose. Request
message control data includes a request method ( [Section 9](https://www.rfc-editor.org/rfc/rfc9110.html#methods)),
request target ( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)), and protocol version
( [Section 2.5](https://www.rfc-editor.org/rfc/rfc9110.html#protocol.version)). Response message control data includes
a status code ( [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes)), optional reason phrase, and
protocol version. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-1)

In HTTP/1.1 (\[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) and earlier, control data is sent
as the first line of a message. In HTTP/2 (\[ [HTTP/2](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP2)\]) and
HTTP/3 (\[ [HTTP/3](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP3)\]), control data is sent as pseudo-header
fields with a reserved name prefix (e.g., ":authority"). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-2)

Every HTTP message has a protocol version. Depending on the version in use,
it might be identified within the message explicitly or inferred by the
connection over which the message is received. Recipients use that version
information to determine limitations or potential for later communication
with that sender. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-3)

When a message is forwarded by an intermediary, the protocol version is
updated to reflect the version used by that intermediary.
The [Via](https://www.rfc-editor.org/rfc/rfc9110.html#field.via) header field ( [Section 7.6.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.via)) is used to
communicate upstream protocol information within a forwarded message. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-4)

A client SHOULD send a request version equal to the highest
version to which the client is conformant and
whose major version is no higher than the highest version supported
by the server, if this is known. A client MUST NOT send a
version to which it is not conformant. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-5)

A client MAY send a lower request version if it is known that
the server incorrectly implements the HTTP specification, but only
after the client has attempted at least one normal request and determined
from the response status code or header fields (e.g., [Server](https://www.rfc-editor.org/rfc/rfc9110.html#field.server)) that
the server improperly handles higher request versions. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-6)

A server SHOULD send a response version equal to the highest version to
which the server is conformant that has a major version less than or equal
to the one received in the request.
A server MUST NOT send a version to which it is not conformant.
A server can send a [505 (HTTP Version Not Supported)](https://www.rfc-editor.org/rfc/rfc9110.html#status.505)
response if it wishes, for any reason, to refuse service of the client's
major protocol version. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-7)

A recipient that receives a message with a major version number that it
implements and a minor version number higher than what it implements
SHOULD process the message as if it
were in the highest minor version within that major version to which the
recipient is conformant. A recipient can assume that a message with a
higher minor version, when sent to a recipient that has not yet indicated
support for that higher version, is sufficiently backwards-compatible to be
safely processed by any implementation of the same major version. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.2-8)

### [6.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.3) [Header Fields](https://www.rfc-editor.org/rfc/rfc9110.html\#name-header-fields)

Fields ( [Section 5](https://www.rfc-editor.org/rfc/rfc9110.html#fields)) that are sent or received before the content
are referred to as "header fields" (or just "headers", colloquially). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.3-1)

The "header section" of a message consists of a sequence of
header field lines. Each header field might modify or extend message
semantics, describe the sender, define the content, or provide additional
context. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.3-2)

### [6.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.4) [Content](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content)

HTTP messages often transfer a complete or partial representation as the
message "content": a stream of octets sent after the header
section, as delineated by the message framing. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4-1)

This abstract definition of content reflects the data after it has been
extracted from the message framing. For example, an HTTP/1.1 message body
([Section 6](https://www.rfc-editor.org/rfc/rfc9112#section-6) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) might consist of a stream of data encoded
with the chunked transfer coding -- a sequence of data chunks, one
zero-length chunk, and a trailer section -- whereas
the content of that same message
includes only the data stream after the transfer coding has been decoded;
it does not include the chunk lengths, chunked framing syntax, nor the
trailer fields ( [Section 6.5](https://www.rfc-editor.org/rfc/rfc9110.html#trailer.fields)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4-2)

#### [6.4.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.4.1) [Content Semantics](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-semantics)

The purpose of content in a request is defined by the method semantics
( [Section 9](https://www.rfc-editor.org/rfc/rfc9110.html#methods)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-1)

For example, a representation in the content of a PUT request
( [Section 9.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#PUT)) represents the desired state of the
[target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) after the request is successfully applied,
whereas a representation in the content of a POST request
( [Section 9.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#POST)) represents information to be processed by the
target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-2)

In a response, the content's purpose is defined by the request method,
response status code ( [Section 15](https://www.rfc-editor.org/rfc/rfc9110.html#status.codes)), and response
fields describing that content.
For example, the content of a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200) response to GET
( [Section 9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET)) represents the current state of the
[target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource), as observed at the time of the message
origination date ( [Section 6.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.date)), whereas the content of
the same status code in a response to POST might represent either the
processing result or the new state of the target resource after applying
the processing. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-3)

The content of a [206 (Partial Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.206) response to GET
contains either a single part of the selected representation or a
multipart message body containing multiple parts of that representation,
as described in [Section 15.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#status.206). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-4)

Response messages with an error status code usually contain content that
represents the error condition, such that the content describes the
error state and what steps are suggested for resolving it. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-5)

Responses to the HEAD request method ( [Section 9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD)) never include
content; the associated response header fields indicate only
what their values would have been if the request method had been GET
( [Section 9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-6)

[2xx (Successful)](https://www.rfc-editor.org/rfc/rfc9110.html#status.2xx) responses to a CONNECT request method
( [Section 9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#CONNECT)) switch the connection to tunnel mode instead of
having content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-7)

All [1xx (Informational)](https://www.rfc-editor.org/rfc/rfc9110.html#status.1xx), [204 (No Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.204), and
[304 (Not Modified)](https://www.rfc-editor.org/rfc/rfc9110.html#status.304) responses do not include content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-8)

All other responses do include content, although that content
might be of zero length. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.1-9)

#### [6.4.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.4.2) [Identifying Content](https://www.rfc-editor.org/rfc/rfc9110.html\#name-identifying-content)

When a complete or partial representation is transferred as message
content, it is often desirable for the sender to supply, or the recipient
to determine, an identifier for a resource corresponding to that specific
representation. For example, a client making a GET request on a resource
for "the current weather report" might want an identifier specific to the
content returned (e.g., "weather report for Laguna Beach at 20210720T1711").
This can be useful for sharing or bookmarking content from resources that
are expected to have changing representations over time. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-1)

For a request message: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-2)

- If the request has a [Content-Location](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-location) header field,
then the sender asserts that the content is a representation of the
resource identified by the Content-Location field value. However,
such an assertion cannot be trusted unless it can be verified by
other means (not defined by this specification). The information
might still be useful for revision history links. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-3.1)
- Otherwise, the content is unidentified by HTTP, but a more specific
identifier might be supplied within the content itself. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-3.2)

For a response message, the following rules are applied in order until a
match is found: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-4)

1. If the request method is HEAD or the response status code is
    [204 (No Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.204) or [304 (Not Modified)](https://www.rfc-editor.org/rfc/rfc9110.html#status.304),
    there is no content in the response. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.1)
2. If the request method is GET and the response status code is
    [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200),
    the content is a representation of the [target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) ( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.2)
3. If the request method is GET and the response status code is
    [203 (Non-Authoritative Information)](https://www.rfc-editor.org/rfc/rfc9110.html#status.203), the content is
    a potentially modified or enhanced representation of the
    [target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) as provided by an intermediary. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.3)
4. If the request method is GET and the response status code is
    [206 (Partial Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.206),
    the content is one or more parts of a representation of the
    target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.4)
5. If the response has a [Content-Location](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-location) header field
    and its field value is a reference to the same URI as the target URI,
    the content is a representation of the target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.5)
6. If the response has a [Content-Location](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-location) header field
    and its field value is a reference to a URI different from the
    target URI, then the sender asserts that the content is a
    representation of the resource identified by the Content-Location
    field value. However, such an assertion cannot be trusted unless
    it can be verified by other means (not defined by this specification). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.6)
7. Otherwise, the content is unidentified by HTTP, but a more specific
    identifier might be supplied within the content itself. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.4.2-5.7)

### [6.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.5) [Trailer Fields](https://www.rfc-editor.org/rfc/rfc9110.html\#name-trailer-fields)

Fields ( [Section 5](https://www.rfc-editor.org/rfc/rfc9110.html#fields)) that are located within a
"trailer section" are referred to as "trailer fields"
(or just "trailers", colloquially).
Trailer fields can be useful for supplying message integrity checks, digital
signatures, delivery metrics, or post-processing status information. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5-1)

Trailer fields ought to be processed and stored separately from the fields
in the header section to avoid contradicting message semantics known at
the time the header section was complete. The presence or absence of
certain header fields might impact choices made for the routing or
processing of the message as a whole before the trailers are received;
those choices cannot be unmade by the later discovery of trailer fields. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5-2)

#### [6.5.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.5.1) [Limitations on Use of Trailers](https://www.rfc-editor.org/rfc/rfc9110.html\#name-limitations-on-use-of-trail)

A trailer section is only possible when supported by the version
of HTTP in use and enabled by an explicit framing mechanism.
For example, the chunked transfer coding in HTTP/1.1 allows a trailer section to be
sent after the content ([Section 7.1.2](https://www.rfc-editor.org/rfc/rfc9112#section-7.1.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.1-1)

Many fields cannot be processed outside the header section because
their evaluation is necessary prior to receiving the content, such as
those that describe message framing, routing, authentication,
request modifiers, response controls, or content format.
A sender MUST NOT generate a trailer field unless the sender knows the
corresponding header field name's definition permits the field to be sent
in trailers. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.1-2)

Trailer fields can be difficult to process by intermediaries that forward
messages from one protocol version to another. If the entire message can be
buffered in transit, some intermediaries could merge trailer fields into
the header section (as appropriate) before it is forwarded. However, in
most cases, the trailers are simply discarded.
A recipient MUST NOT merge a trailer field into a header section unless
the recipient understands the corresponding header field definition and
that definition explicitly permits and defines how trailer field values
can be safely merged. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.1-3)

The presence of the keyword "trailers" in the TE header field ( [Section 10.1.4](https://www.rfc-editor.org/rfc/rfc9110.html#field.te)) of a request indicates that the client is willing to
accept trailer fields, on behalf of itself and any downstream clients. For
requests from an intermediary, this implies that all
downstream clients are willing to accept trailer fields in the forwarded
response. Note that the presence of "trailers" does not mean that the
client(s) will process any particular trailer field in the response; only
that the trailer section(s) will not be dropped by any of the clients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.1-4)

Because of the potential for trailer fields to be discarded in transit, a
server SHOULD NOT generate trailer fields that it believes are necessary
for the user agent to receive. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.1-5)

#### [6.5.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.5.2) [Processing Trailer Fields](https://www.rfc-editor.org/rfc/rfc9110.html\#name-processing-trailer-fields)

The "Trailer" header field ( [Section 6.6.2](https://www.rfc-editor.org/rfc/rfc9110.html#field.trailer)) can be sent
to indicate fields likely to be sent in the trailer section, which allows
recipients to prepare for their receipt before processing the content.
For example, this could be useful if a field name indicates that a dynamic
checksum should be calculated as the content is received and then
immediately checked upon receipt of the trailer field value. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.2-1)

Like header fields, trailer fields with the same name are processed in the
order received; multiple trailer field lines with the same name have the
equivalent semantics as appending the multiple values as a list of members.
Trailer fields that might be generated more than once during a message
MUST be defined as a list-based field even if each member value is only
processed once per field line received. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.2-2)

At the end of a message, a recipient MAY treat the set of received
trailer fields as a data structure of name/value pairs, similar to (but
separate from) the header fields. Additional processing expectations, if
any, can be defined within the field specification for a field intended
for use in trailers. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.5.2-3)

### [6.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.6) [Message Metadata](https://www.rfc-editor.org/rfc/rfc9110.html\#name-message-metadata)

Fields that describe the message itself, such as when and how the
message has been generated, can appear in both requests and responses. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6-1)

#### [6.6.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.6.1) [Date](https://www.rfc-editor.org/rfc/rfc9110.html\#name-date)

The "Date" header field represents the date and time at which
the message was originated, having the same semantics as the Origination
Date Field (orig-date) defined in [Section 3.6.1](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.1) of \[ [RFC5322](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5322)\].
The field value is an HTTP-date, as defined in [Section 5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#http.date). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-1)

```abnf9110
  Date = HTTP-date
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-2)

An example is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-3)

```http-message
Date: Tue, 15 Nov 1994 08:12:31 GMT
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-4)

A sender that generates a Date header field SHOULD generate its
field value as the best available approximation of the date and time of
message generation. In theory, the date ought to represent the moment just
before generating the message content. In practice, a sender can generate
the date value at any time during message origination. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-5)

An origin server with a clock (as defined in
[Section 5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#http.date)) MUST generate a Date header field in
all [2xx (Successful)](https://www.rfc-editor.org/rfc/rfc9110.html#status.2xx), [3xx (Redirection)](https://www.rfc-editor.org/rfc/rfc9110.html#status.3xx),
and [4xx (Client Error)](https://www.rfc-editor.org/rfc/rfc9110.html#status.4xx) responses,
and MAY generate a Date header field in
[1xx (Informational)](https://www.rfc-editor.org/rfc/rfc9110.html#status.1xx) and
[5xx (Server Error)](https://www.rfc-editor.org/rfc/rfc9110.html#status.5xx) responses. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-6)

An origin server without a clock MUST NOT generate a Date header field. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-7)

A recipient with a clock that receives a response message without a Date
header field MUST record the time it was received and append a
corresponding Date header field to the message's header section if it is
cached or forwarded downstream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-8)

A recipient with a clock that receives a response with an invalid Date
header field value MAY replace that value with the time that
response was received. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-9)

A user agent MAY send a Date header field in a request, though generally
will not do so unless it is believed to convey useful information to the
server. For example, custom applications of HTTP might convey a Date if
the server is expected to adjust its interpretation of the user's request
based on differences between the user agent and server clocks. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.1-10)

#### [6.6.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-6.6.2) [Trailer](https://www.rfc-editor.org/rfc/rfc9110.html\#name-trailer)

The "Trailer" header field provides a list of field names that the sender
anticipates sending as trailer fields within that message. This allows a
recipient to prepare for receipt of the indicated metadata before it starts
processing the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.2-1)

```abnf9110
  Trailer = #field-name
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.2-2)

For example, a sender might indicate that a signature will
be computed as the content is being streamed and provide the final
signature as a trailer field. This allows a recipient to perform the same
check on the fly as it receives the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.2-3)

A sender that intends to generate one or more trailer fields in a message
SHOULD generate a [Trailer](https://www.rfc-editor.org/rfc/rfc9110.html#field.trailer) header field in the header
section of that message to indicate which fields might be present in the
trailers. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.2-4)

If an intermediary discards the trailer section in transit, the
[Trailer](https://www.rfc-editor.org/rfc/rfc9110.html#field.trailer) field could provide a hint of what metadata
was lost, though there is no guarantee that a sender of Trailer
will always follow through by sending the named fields. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-6.6.2-5)

## [7\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7) [Routing HTTP Messages](https://www.rfc-editor.org/rfc/rfc9110.html\#name-routing-http-messages)

HTTP request message routing is determined by each client based on the
target resource, the client's proxy configuration, and
establishment or reuse of an inbound connection. The corresponding
response routing follows the same connection chain back to the client. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7-1)

### [7.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.1) [Determining the Target Resource](https://www.rfc-editor.org/rfc/rfc9110.html\#name-determining-the-target-reso)

Although HTTP is used in a wide variety of applications, most clients rely
on the same resource identification mechanism and configuration techniques
as general-purpose Web browsers. Even when communication options are
hard-coded in a client's configuration, we can think of their combined
effect as a URI reference ( [Section 4.1](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-1)

A URI reference is resolved to its absolute form in order to obtain the
"target URI". The target URI excludes the reference's
fragment component, if any, since fragment identifiers are reserved for
client-side processing (\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 3.5](https://www.rfc-editor.org/rfc/rfc3986#section-3.5)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-2)

To perform an action on a "target resource", the client sends
a request message containing enough components of its parsed target URI to
enable recipients to identify that same resource. For historical reasons,
the parsed target URI components, collectively referred to as the
"request target", are sent within the message control data
and the [Host](https://www.rfc-editor.org/rfc/rfc9110.html#field.host) header field ( [Section 7.2](https://www.rfc-editor.org/rfc/rfc9110.html#field.host)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-3)

There are two unusual cases for which the request target components are in
a method-specific form: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-4)

- For CONNECT ( [Section 9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#CONNECT)), the request target is the host
name and port number of the tunnel destination, separated by a colon. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-5.1)
- For OPTIONS ( [Section 9.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#OPTIONS)), the request target can be a
single asterisk ("\*"). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-5.2)

See the respective method definitions for details. These forms MUST NOT
be used with other methods. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-6)

Upon receipt of a client's request, a server reconstructs the target URI
from the received components in accordance with their local configuration
and incoming connection context. This reconstruction is specific to each
major protocol version. For example,
[Section 3.3](https://www.rfc-editor.org/rfc/rfc9112#section-3.3) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\] defines how a server
determines the target URI of an HTTP/1.1 request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.1-7)

### [7.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.2) [Host and :authority](https://www.rfc-editor.org/rfc/rfc9110.html\#name-host-and-authority)

The "Host" header field in a request provides the host and port
information from the target URI, enabling the origin
server to distinguish among resources while servicing requests
for multiple host names. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-1)

In HTTP/2 \[ [HTTP/2](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP2)\] and HTTP/3 \[ [HTTP/3](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP3)\], the
Host header field is, in some cases, supplanted by the ":authority"
pseudo-header field of a request's control data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-2)

```abnf9110
  Host = uri-host [ ":" port ] ; Section 4
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-3)

The target URI's authority information is critical for handling a
request. A user agent MUST generate a Host header field in a request
unless it sends that information as an ":authority" pseudo-header field.
A user agent that sends Host SHOULD send it as the first field in the
header section of a request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-4)

For example, a GET request to the origin server for
<http://www.example.org/pub/WWW/> would begin with: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-5)

```http-message
GET /pub/WWW/ HTTP/1.1
Host: www.example.org
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-6)

Since the host and port information acts as an application-level routing
mechanism, it is a frequent target for malware seeking to poison
a shared cache or redirect a request to an unintended server.
An interception proxy is particularly vulnerable if it relies on
the host and port information for redirecting requests to internal
servers, or for use as a cache key in a shared cache, without
first verifying that the intercepted connection is targeting a
valid IP address for that host. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.2-7)

### [7.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.3) [Routing Inbound Requests](https://www.rfc-editor.org/rfc/rfc9110.html\#name-routing-inbound-requests)

Once the target URI and its origin are determined, a client decides whether
a network request is necessary to accomplish the desired semantics and,
if so, where that request is to be directed. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3-1)

#### [7.3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.3.1) [To a Cache](https://www.rfc-editor.org/rfc/rfc9110.html\#name-to-a-cache)

If the client has a cache \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\] and the request can be
satisfied by it, then the request is
usually directed there first. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.1-1)

#### [7.3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.3.2) [To a Proxy](https://www.rfc-editor.org/rfc/rfc9110.html\#name-to-a-proxy)

If the request is not satisfied by a cache, then a typical client will
check its configuration to determine whether a proxy is to be used to
satisfy the request. Proxy configuration is implementation-dependent,
but is often based on URI prefix matching, selective authority matching,
or both, and the proxy itself is usually identified by an "http" or
"https" URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.2-1)

If an "http" or "https" proxy is applicable, the client connects
inbound by establishing (or reusing) a connection to that proxy and
then sending it an HTTP request message containing a request target
that matches the client's target URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.2-2)

#### [7.3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.3.3) [To the Origin](https://www.rfc-editor.org/rfc/rfc9110.html\#name-to-the-origin)

If no proxy is applicable, a typical client will invoke a handler
routine (specific to the target URI's scheme) to obtain access to the
identified resource. How that is accomplished is dependent on the
target URI scheme and defined by its associated specification. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.3-1)

[Section 4.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#http.origin) defines how to obtain access to an
"http" resource by establishing (or reusing) an inbound connection to
the identified origin server and then sending it an HTTP request message
containing a request target that matches the client's target URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.3-2)

[Section 4.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#https.origin) defines how to obtain access to an
"https" resource by establishing (or reusing) an inbound secured
connection to an origin server that is authoritative for the identified
origin and then sending it an HTTP request message containing a request
target that matches the client's target URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.3.3-3)

### [7.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.4) [Rejecting Misdirected Requests](https://www.rfc-editor.org/rfc/rfc9110.html\#name-rejecting-misdirected-reque)

Once a request is received by a server and parsed sufficiently to determine
its target URI, the server decides whether to process the request itself,
forward the request to another server, redirect the client to a different
resource, respond with an error, or drop the connection. This decision can
be influenced by anything about the request or connection context, but is
specifically directed at whether the server has been configured to process
requests for that target URI and whether the connection context is
appropriate for that request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.4-1)

For example, a request might have been misdirected,
deliberately or accidentally, such that the information within a received
[Host](https://www.rfc-editor.org/rfc/rfc9110.html#field.host) header field differs from the connection's host or port.
If the connection is from a trusted gateway, such inconsistency might
be expected; otherwise, it might indicate an attempt to bypass security
filters, trick the server into delivering non-public content, or poison a
cache. See [Section 17](https://www.rfc-editor.org/rfc/rfc9110.html#security.considerations) for security
considerations regarding message routing. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.4-2)

Unless the connection is from a trusted gateway,
an origin server MUST reject a request if any scheme-specific requirements
for the target URI are not met. In particular,
a request for an "https" resource MUST be rejected unless it has been
received over a connection that has been secured via a certificate
valid for that target URI's origin, as defined by [Section 4.2.2](https://www.rfc-editor.org/rfc/rfc9110.html#https.uri). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.4-3)

The [421 (Misdirected Request)](https://www.rfc-editor.org/rfc/rfc9110.html#status.421) status code in a response
indicates that the origin server has rejected the request because it
appears to have been misdirected ( [Section 15.5.20](https://www.rfc-editor.org/rfc/rfc9110.html#status.421)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.4-4)

### [7.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.5) [Response Correlation](https://www.rfc-editor.org/rfc/rfc9110.html\#name-response-correlation)

A connection might be used for multiple request/response exchanges. The
mechanism used to correlate between request and response messages is
version dependent; some versions of HTTP use implicit ordering of
messages, while others use an explicit identifier. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.5-1)

All responses, regardless of the status code (including [interim](https://www.rfc-editor.org/rfc/rfc9110.html#final.interim)
responses) can be sent at any time after a request is received, even if the
request is not yet complete. A response can complete before its
corresponding request is complete ( [Section 6.1](https://www.rfc-editor.org/rfc/rfc9110.html#message.framing)). Likewise, clients are not expected
to wait any specific amount of time for a response. Clients
(including intermediaries) might abandon a request if the response is not
received within a reasonable period of time. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.5-2)

A client that receives a response while it is still sending the associated
request SHOULD continue sending that request unless it receives
an explicit indication to the contrary (see, e.g., [Section 9.5](https://www.rfc-editor.org/rfc/rfc9112#section-9.5) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\] and [Section 6.4](https://www.rfc-editor.org/rfc/rfc9113#section-6.4) of \[ [HTTP/2](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP2)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.5-3)

### [7.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.6) [Message Forwarding](https://www.rfc-editor.org/rfc/rfc9110.html\#name-message-forwarding)

As described in [Section 3.7](https://www.rfc-editor.org/rfc/rfc9110.html#intermediaries), intermediaries can serve
a variety of roles in the processing of HTTP requests and responses.
Some intermediaries are used to improve performance or availability.
Others are used for access control or to filter content.
Since an HTTP stream has characteristics similar to a pipe-and-filter
architecture, there are no inherent limits to the extent an intermediary
can enhance (or interfere) with either direction of the stream. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6-1)

Intermediaries are expected to forward messages even when protocol elements
are not recognized (e.g., new methods, status codes, or field names) since that
preserves extensibility for downstream recipients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6-2)

An intermediary not acting as a tunnel MUST implement the
[Connection](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection) header field, as specified in
[Section 7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection), and exclude fields from being forwarded
that are only intended for the incoming connection. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6-3)

An intermediary MUST NOT forward a message to itself unless it is
protected from an infinite request loop. In general, an intermediary ought
to recognize its own server names, including any aliases, local variations,
or literal IP addresses, and respond to such requests directly. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6-4)

An HTTP message can be parsed as a stream for incremental processing or
forwarding downstream.
However, senders and recipients cannot rely on incremental
delivery of partial messages, since some implementations will buffer or
delay message forwarding for the sake of network efficiency, security
checks, or content transformations. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6-5)

#### [7.6.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.6.1) [Connection](https://www.rfc-editor.org/rfc/rfc9110.html\#name-connection)

The "Connection" header field allows the sender to list desired
control options for the current connection. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-1)

```abnf9110
  Connection        = #connection-option
  connection-option = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-2)

Connection options are case-insensitive. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-3)

When a field aside from Connection is used to supply control
information for or about the current connection, the sender MUST list
the corresponding field name within the Connection header field.
Note that some versions of HTTP prohibit the use of fields for such
information, and therefore do not allow the Connection field. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-4)

Intermediaries MUST parse a received Connection
header field before a message is forwarded and, for each
connection-option in this field, remove any header or trailer field(s) from
the message with the same name as the connection-option, and then
remove the Connection header field itself (or replace it with the
intermediary's own control options for the forwarded message). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-5)

Hence, the Connection header field provides a declarative way of
distinguishing fields that are only intended for the
immediate recipient ("hop-by-hop") from those fields that are
intended for all recipients on the chain ("end-to-end"), enabling the
message to be self-descriptive and allowing future connection-specific
extensions to be deployed without fear that they will be blindly
forwarded by older intermediaries. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-6)

Furthermore, intermediaries SHOULD remove or replace fields
that are known to require removal before forwarding, whether or not they appear as a
connection-option, after applying those fields' semantics. This includes but is not limited to: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-7)

- Proxy-Connection ([Appendix C.2.2](https://www.rfc-editor.org/rfc/rfc9112#appendix-C.2.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-8.1)
- Keep-Alive ([Section 19.7.1](https://www.rfc-editor.org/rfc/rfc2068#section-19.7.1) of \[ [RFC2068](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2068)\]) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-8.2)
- TE ( [Section 10.1.4](https://www.rfc-editor.org/rfc/rfc9110.html#field.te)) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-8.3)
- Transfer-Encoding ([Section 6.1](https://www.rfc-editor.org/rfc/rfc9112#section-6.1) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-8.4)
- Upgrade ( [Section 7.8](https://www.rfc-editor.org/rfc/rfc9110.html#field.upgrade)) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-8.5)

A sender MUST NOT send a connection option corresponding to a
field that is intended for all recipients of the content.
For example, Cache-Control is never appropriate as a
connection option ([Section 5.2](https://www.rfc-editor.org/rfc/rfc9111#section-5.2) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-9)

Connection options do not always correspond to a field
present in the message, since a connection-specific field
might not be needed if there are no parameters associated with a
connection option. In contrast, a connection-specific field
received without a corresponding connection option usually indicates
that the field has been improperly forwarded by an intermediary and
ought to be ignored by the recipient. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-10)

When defining a new connection option that does not correspond to a field,
specification authors ought to reserve the corresponding field name
anyway in order to avoid later collisions. Such reserved field names are
registered in the "Hypertext Transfer Protocol (HTTP) Field Name Registry"
( [Section 16.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#fields.registry)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.1-11)

#### [7.6.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.6.2) [Max-Forwards](https://www.rfc-editor.org/rfc/rfc9110.html\#name-max-forwards)

The "Max-Forwards" header field provides a mechanism with the
TRACE ( [Section 9.3.8](https://www.rfc-editor.org/rfc/rfc9110.html#TRACE)) and OPTIONS ( [Section 9.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#OPTIONS))
request methods to limit the number of times that the request is forwarded by
proxies. This can be useful when the client is attempting to
trace a request that appears to be failing or looping mid-chain. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.2-1)

```abnf9110
  Max-Forwards = 1*DIGIT
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.2-2)

The Max-Forwards value is a decimal integer indicating the remaining
number of times this request message can be forwarded. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.2-3)

Each intermediary that receives a TRACE or OPTIONS request containing a
Max-Forwards header field MUST check and update its value prior to
forwarding the request. If the received value is zero (0), the intermediary
MUST NOT forward the request; instead, the intermediary MUST respond as
the final recipient. If the received Max-Forwards value is greater than
zero, the intermediary MUST generate an updated Max-Forwards field in the
forwarded message with a field value that is the lesser of a) the received
value decremented by one (1) or b) the recipient's maximum supported value
for Max-Forwards. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.2-4)

A recipient MAY ignore a Max-Forwards header field received with any
other request methods. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.2-5)

#### [7.6.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.6.3) [Via](https://www.rfc-editor.org/rfc/rfc9110.html\#name-via)

The "Via" header field indicates the presence of intermediate protocols and
recipients between the user agent and the server (on requests) or between
the origin server and the client (on responses), similar to the
"Received" header field in email
([Section 3.6.7](https://www.rfc-editor.org/rfc/rfc5322#section-3.6.7) of \[ [RFC5322](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5322)\]).
Via can be used for tracking message forwards,
avoiding request loops, and identifying the protocol capabilities of
senders along the request/response chain. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-1)

```abnf9110
  Via = #( received-protocol RWS received-by [ RWS comment ] )

  received-protocol = [ protocol-name "/" ] protocol-version
                    ; see Section 7.8
  received-by       = pseudonym [ ":" port ]
  pseudonym         = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-2)

Each member of the Via field value represents a proxy or gateway that has
forwarded the message. Each intermediary appends its own information
about how the message was received, such that the end result is ordered
according to the sequence of forwarding recipients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-3)

A proxy MUST send an appropriate Via header field, as described below, in
each message that it forwards.
An HTTP-to-HTTP gateway MUST send an appropriate Via header field in
each inbound request message and MAY send a Via header field in
forwarded response messages. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-4)

For each intermediary, the received-protocol indicates the protocol and
protocol version used by the upstream sender of the message. Hence, the
Via field value records the advertised protocol capabilities of the
request/response chain such that they remain visible to downstream
recipients; this can be useful for determining what backwards-incompatible
features might be safe to use in response, or within a later request, as
described in [Section 2.5](https://www.rfc-editor.org/rfc/rfc9110.html#protocol.version). For brevity, the protocol-name
is omitted when the received protocol is HTTP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-5)

The received-by portion is normally the host and optional
port number of a recipient server or client that subsequently forwarded the
message.
However, if the real host is considered to be sensitive information, a
sender MAY replace it with a pseudonym. If a port is not provided,
a recipient MAY interpret that as meaning it was received on the default
port, if any, for the received-protocol. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-6)

A sender MAY generate comments to identify the
software of each recipient, analogous to the [User-Agent](https://www.rfc-editor.org/rfc/rfc9110.html#field.user-agent) and
[Server](https://www.rfc-editor.org/rfc/rfc9110.html#field.server) header fields. However, comments in Via
are optional, and a recipient MAY remove them prior to forwarding the
message. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-7)

For example, a request message could be sent from an HTTP/1.0 user
agent to an internal proxy code-named "fred", which uses HTTP/1.1 to
forward the request to a public proxy at p.example.net, which completes
the request by forwarding it to the origin server at www.example.com.
The request received by www.example.com would then have the following
Via header field: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-8)

```http-message
Via: 1.0 fred, 1.1 p.example.net
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-9)

An intermediary used as a portal through a network firewall
SHOULD NOT forward the names and ports of hosts within the firewall
region unless it is explicitly enabled to do so. If not enabled, such an
intermediary SHOULD replace each received-by host of any host behind the
firewall by an appropriate pseudonym for that host. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-10)

An intermediary MAY combine an ordered subsequence of Via header
field list members into a single member if the entries have identical
received-protocol values. For example, [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-11)

```http-message
Via: 1.0 ricky, 1.1 ethel, 1.1 fred, 1.0 lucy
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-12)

could be collapsed to [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-13)

```http-message
Via: 1.0 ricky, 1.1 mertz, 1.0 lucy
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-14)

A sender SHOULD NOT combine multiple list members unless they are all
under the same organizational control and the hosts have already been
replaced by pseudonyms. A sender MUST NOT combine members that
have different received-protocol values. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.6.3-15)

### [7.7.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.7) [Message Transformations](https://www.rfc-editor.org/rfc/rfc9110.html\#name-message-transformations)

Some intermediaries include features for transforming messages and their
content. A proxy might, for example, convert between image formats in
order to save cache space or to reduce the amount of traffic on a slow
link. However, operational problems might occur when these transformations
are applied to content intended for critical applications, such as medical
imaging or scientific data analysis, particularly when integrity checks or
digital signatures are used to ensure that the content received is
identical to the original. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-1)

An HTTP-to-HTTP proxy is called a "transforming proxy"
if it is designed or configured to modify messages in a semantically
meaningful way (i.e., modifications, beyond those required by normal
HTTP processing, that change the message in a way that would be
significant to the original sender or potentially significant to
downstream recipients). For example, a transforming proxy might be
acting as a shared annotation server (modifying responses to include
references to a local annotation database), a malware filter, a
format transcoder, or a privacy filter. Such transformations are presumed
to be desired by whichever client (or client organization) chose the
proxy. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-2)

If a proxy receives a target URI with a host name that is not a
fully qualified domain name, it MAY add its own domain to the host name
it received when forwarding the request. A proxy MUST NOT change the
host name if the target URI contains a fully qualified domain name. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-3)

A proxy MUST NOT modify the "absolute-path" and "query" parts of the
received target URI when forwarding it to the next inbound server except
as required by that forwarding protocol. For example, a proxy forwarding
a request to an origin server via HTTP/1.1 will replace an empty path with
"/" ([Section 3.2.1](https://www.rfc-editor.org/rfc/rfc9112#section-3.2.1) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]) or "\*" ([Section 3.2.4](https://www.rfc-editor.org/rfc/rfc9112#section-3.2.4) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]),
depending on the request method. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-4)

A proxy MUST NOT transform the content ( [Section 6.4](https://www.rfc-editor.org/rfc/rfc9110.html#content)) of a
response message that contains a no-transform cache directive
([Section 5.2.2.6](https://www.rfc-editor.org/rfc/rfc9111#section-5.2.2.6) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]). Note that this
does not apply to message transformations that do not change the content,
such as the addition or removal of transfer codings
([Section 7](https://www.rfc-editor.org/rfc/rfc9112#section-7) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-5)

A proxy MAY transform the content of a message
that does not contain a no-transform cache directive.
A proxy that transforms the content of a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200) response
can inform downstream recipients that a transformation has been
applied by changing the response status code to
[203 (Non-Authoritative Information)](https://www.rfc-editor.org/rfc/rfc9110.html#status.203) ( [Section 15.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#status.203)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-6)

A proxy SHOULD NOT modify header fields that provide information about
the endpoints of the communication chain, the resource state, or the
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation) (other than the content) unless the field's
definition specifically allows such modification or the modification is
deemed necessary for privacy or security. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.7-7)

### [7.8.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-7.8) [Upgrade](https://www.rfc-editor.org/rfc/rfc9110.html\#name-upgrade)

The "Upgrade" header field is intended to provide a simple mechanism
for transitioning from HTTP/1.1 to some other protocol on the same
connection. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-1)

A client MAY send a list of protocol names in the Upgrade header field
of a request to invite the server to switch to one or more of the named
protocols, in order of descending preference, before sending
the final response. A server MAY ignore a received Upgrade header field
if it wishes to continue using the current protocol on that connection.
Upgrade cannot be used to insist on a protocol change. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-2)

```abnf9110
  Upgrade          = #protocol

  protocol         = protocol-name ["/" protocol-version]
  protocol-name    = token
  protocol-version = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-3)

Although protocol names are registered with a preferred case,
recipients SHOULD use case-insensitive comparison when matching each
protocol-name to supported protocols. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-4)

A server that sends a [101 (Switching Protocols)](https://www.rfc-editor.org/rfc/rfc9110.html#status.101) response
MUST send an Upgrade header field to indicate the new protocol(s) to
which the connection is being switched; if multiple protocol layers are
being switched, the sender MUST list the protocols in layer-ascending
order. A server MUST NOT switch to a protocol that was not indicated by
the client in the corresponding request's Upgrade header field.
A server MAY choose to ignore the order of preference indicated by the
client and select the new protocol(s) based on other factors, such as the
nature of the request or the current load on the server. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-5)

A server that sends a [426 (Upgrade Required)](https://www.rfc-editor.org/rfc/rfc9110.html#status.426) response
MUST send an Upgrade header field to indicate the acceptable protocols,
in order of descending preference. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-6)

A server MAY send an Upgrade header field in any other response to
advertise that it implements support for upgrading to the listed protocols,
in order of descending preference, when appropriate for a future request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-7)

The following is a hypothetical example sent by a client: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-8)

```http-message
GET /hello HTTP/1.1
Host: www.example.com
Connection: upgrade
Upgrade: websocket, IRC/6.9, RTA/x11
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-9)

The capabilities and nature of the
application-level communication after the protocol change is entirely
dependent upon the new protocol(s) chosen. However, immediately after
sending the [101 (Switching Protocols)](https://www.rfc-editor.org/rfc/rfc9110.html#status.101) response, the server is expected to continue responding to
the original request as if it had received its equivalent within the new
protocol (i.e., the server still has an outstanding request to satisfy
after the protocol has been changed, and is expected to do so without
requiring the request to be repeated). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-10)

For example, if the Upgrade header field is received in a GET request
and the server decides to switch protocols, it first responds
with a [101 (Switching Protocols)](https://www.rfc-editor.org/rfc/rfc9110.html#status.101) message in HTTP/1.1 and
then immediately follows that with the new protocol's equivalent of a
response to a GET on the target resource. This allows a connection to be
upgraded to protocols with the same semantics as HTTP without the
latency cost of an additional round trip. A server MUST NOT switch
protocols unless the received message semantics can be honored by the new
protocol; an OPTIONS request can be honored by any protocol. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-11)

The following is an example response to the above hypothetical request: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-12)

```http-message
HTTP/1.1 101 Switching Protocols
Connection: upgrade
Upgrade: websocket

[... data stream switches to websocket with an appropriate response\
(as defined by new protocol) to the "GET /hello" request ...]
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-13)

A sender of Upgrade MUST also send an "Upgrade" connection option in the
[Connection](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection) header field ( [Section 7.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.connection))
to inform intermediaries not to forward this field.
A server that receives an Upgrade header field in an HTTP/1.0 request
MUST ignore that Upgrade field. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-14)

A client cannot begin using an upgraded protocol on the connection until
it has completely sent the request message (i.e., the client can't change
the protocol it is sending in the middle of a message).
If a server receives both an Upgrade and an [Expect](https://www.rfc-editor.org/rfc/rfc9110.html#field.expect) header field
with the "100-continue" expectation ( [Section 10.1.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.expect)), the
server MUST send a [100 (Continue)](https://www.rfc-editor.org/rfc/rfc9110.html#status.100) response before sending
a [101 (Switching Protocols)](https://www.rfc-editor.org/rfc/rfc9110.html#status.101) response. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-15)

The Upgrade header field only applies to switching protocols on top of the
existing connection; it cannot be used to switch the underlying connection
(transport) protocol, nor to switch the existing communication to a
different connection. For those purposes, it is more appropriate to use a
[3xx (Redirection)](https://www.rfc-editor.org/rfc/rfc9110.html#status.3xx) response ( [Section 15.4](https://www.rfc-editor.org/rfc/rfc9110.html#status.3xx)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-16)

This specification only defines the protocol name "HTTP" for use by
the family of Hypertext Transfer Protocols, as defined by the HTTP
version rules of [Section 2.5](https://www.rfc-editor.org/rfc/rfc9110.html#protocol.version) and future updates to this
specification. Additional protocol names ought to be registered using the
registration procedure defined in [Section 16.7](https://www.rfc-editor.org/rfc/rfc9110.html#upgrade.token.registry). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-7.8-17)

## [8\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8) [Representation Data and Metadata](https://www.rfc-editor.org/rfc/rfc9110.html\#name-representation-data-and-met)

### [8.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.1) [Representation Data](https://www.rfc-editor.org/rfc/rfc9110.html\#name-representation-data)

The representation data associated with an HTTP message is
either provided as the content of the message or
referred to by the message semantics and the target
URI. The representation data is in a format and encoding defined by
the representation metadata header fields. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.1-1)

The data type of the representation data is determined via the header fields
[Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type) and [Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding).
These define a two-layer, ordered encoding model: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.1-2)

```
  representation-data := Content-Encoding( Content-Type( data ) )
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.1-3)

### [8.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.2) [Representation Metadata](https://www.rfc-editor.org/rfc/rfc9110.html\#name-representation-metadata)

Representation header fields provide metadata about the representation.
When a message includes content, the representation header fields
describe how to interpret that data. In a response to a HEAD request, the
representation header fields describe the representation data that would
have been enclosed in the content if the same request had been a GET. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.2-1)

### [8.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.3) [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-type)

The "Content-Type" header field indicates the media type of the
associated representation: either the representation enclosed in
the message content or the [selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation), as determined by the
message semantics. The indicated media type defines both the data format
and how that data is intended to be processed by a recipient, within the
scope of the received message semantics, after any content codings
indicated by [Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding) are decoded. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-1)

```abnf9110
  Content-Type = media-type
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-2)

Media types are defined in [Section 8.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#media.type). An example of the
field is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-3)

```http-message
Content-Type: text/html; charset=ISO-8859-4
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-4)

A sender that generates a message containing content SHOULD
generate a Content-Type header field in that message unless the intended
media type of the enclosed representation is unknown to the sender.
If a Content-Type header field is not present, the recipient MAY either
assume a media type of
"application/octet-stream" (\[ [RFC2046](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2046)\], [Section 4.5.1](https://www.rfc-editor.org/rfc/rfc2046#section-4.5.1))
or examine the data to determine its type. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-5)

In practice, resource owners do not always properly configure their origin
server to provide the correct Content-Type for a given representation.
Some user agents examine the content and, in certain cases,
override the received type (for example, see \[ [Sniffing](https://www.rfc-editor.org/rfc/rfc9110.html#Sniffing)\]).
This "MIME sniffing" risks drawing incorrect conclusions about the data,
which might expose the user to additional security risks
(e.g., "privilege escalation").
Furthermore, distinct media types often share a common data format,
differing only in how the data is intended to be processed, which is
impossible to distinguish by inspecting the data alone.
When sniffing is implemented, implementers are encouraged to provide a
means for the user to disable it. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-6)

Although Content-Type is defined as a singleton field, it is
sometimes incorrectly generated multiple times, resulting in a combined
field value that appears to be a list.
Recipients often attempt to handle this error by using the last
syntactically valid member of the list, leading to potential
interoperability and security issues if different implementations
have different error handling behaviors. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3-7)

#### [8.3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.3.1) [Media Type](https://www.rfc-editor.org/rfc/rfc9110.html\#name-media-type)

HTTP uses media types \[ [RFC2046](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2046)\] in the
[Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type) ( [Section 8.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type))
and [Accept](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept) ( [Section 12.5.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept)) header fields in
order to provide open and extensible data typing and type negotiation.
Media types define both a data format and various processing models:
how to process that data in accordance with the message context. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-1)

```abnf9110
  media-type = type "/" subtype parameters
  type       = token
  subtype    = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-2)

The type and subtype tokens are case-insensitive. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-3)

The type/subtype MAY be followed by semicolon-delimited parameters
( [Section 5.6.6](https://www.rfc-editor.org/rfc/rfc9110.html#parameter)) in the form of name/value pairs.
The presence or absence of a parameter might be significant to the
processing of a media type, depending on its definition within the media
type registry.
Parameter values might or might not be case-sensitive, depending on the
semantics of the parameter name. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-4)

For example, the following media types are equivalent in describing HTML
text data encoded in the UTF-8 character encoding scheme, but the first is
preferred for consistency (the "charset" parameter value is defined as
being case-insensitive in \[ [RFC2046](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2046)\], [Section 4.1.2](https://www.rfc-editor.org/rfc/rfc2046#section-4.1.2)): [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-5)

```
  text/html;charset=utf-8
  Text/HTML;Charset="utf-8"
  text/html; charset="utf-8"
  text/html;charset=UTF-8
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-6)

Media types ought to be registered with IANA according to the
procedures defined in \[ [BCP13](https://www.rfc-editor.org/rfc/rfc9110.html#BCP13)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.1-7)

#### [8.3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.3.2) [Charset](https://www.rfc-editor.org/rfc/rfc9110.html\#name-charset)

HTTP uses "charset" names to indicate or negotiate the
character encoding scheme (\[ [RFC6365](https://www.rfc-editor.org/rfc/rfc9110.html#RFC6365)\], [Section 2](https://www.rfc-editor.org/rfc/rfc6365#section-2))
of a textual representation. In the fields defined by this document,
charset names appear either in parameters ( [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type)),
or, for [Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding), in the form of a plain [token](https://www.rfc-editor.org/rfc/rfc9110.html#rule.token.separators).
In both cases, charset names are matched case-insensitively. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.2-1)

Charset names ought to be registered in the IANA "Character Sets" registry
(< [https://www.iana.org/assignments/character-sets](https://www.iana.org/assignments/character-sets) >)
according to the procedures defined in [Section 2](https://www.rfc-editor.org/rfc/rfc2978#section-2) of \[ [RFC2978](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2978)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.2-2)

#### [8.3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.3.3) [Multipart Types](https://www.rfc-editor.org/rfc/rfc9110.html\#name-multipart-types)

MIME provides for a number of "multipart" types -- encapsulations of
one or more representations within a single message body. All multipart
types share a common syntax, as defined in [Section 5.1.1](https://www.rfc-editor.org/rfc/rfc2046#section-5.1.1) of \[ [RFC2046](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2046)\],
and include a boundary parameter as part of the media type
value. The message body is itself a protocol element; a sender MUST
generate only CRLF to represent line breaks between body parts. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.3-1)

HTTP message framing does not use the multipart boundary as an indicator
of message body length, though it might be used by implementations that
generate or process the content. For example, the "multipart/form-data"
type is often used for carrying form data in a request, as described in
\[ [RFC7578](https://www.rfc-editor.org/rfc/rfc9110.html#RFC7578)\], and the "multipart/byteranges" type is defined
by this specification for use in some [206 (Partial Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.206)
responses (see [Section 15.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#status.206)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.3.3-2)

### [8.4.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.4) [Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-encoding)

The "Content-Encoding" header field indicates what content codings
have been applied to the representation, beyond those inherent in the media
type, and thus what decoding mechanisms have to be applied in order to
obtain data in the media type referenced by the [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type)
header field.
Content-Encoding is primarily used to allow a representation's data to be
compressed without losing the identity of its underlying media type. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-1)

```abnf9110
  Content-Encoding = #content-coding
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-2)

An example of its use is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-3)

```http-message
Content-Encoding: gzip
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-4)

If one or more encodings have been applied to a representation, the sender
that applied the encodings MUST generate a Content-Encoding header field
that lists the content codings in the order in which they were applied.
Note that the coding named "identity" is reserved for its special role
in [Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding) and thus SHOULD NOT be included. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-5)

Additional information about the encoding parameters can be provided
by other header fields not defined by this specification. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-6)

Unlike Transfer-Encoding ([Section 6.1](https://www.rfc-editor.org/rfc/rfc9112#section-6.1) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]), the codings listed
in Content-Encoding are a characteristic of the representation; the
representation is defined in terms of the coded form, and all other
metadata about the representation is about the coded form unless otherwise
noted in the metadata definition. Typically, the representation is only
decoded just prior to rendering or analogous usage. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-7)

If the media type includes an inherent encoding, such as a data format
that is always compressed, then that encoding would not be restated in
Content-Encoding even if it happens to be the same algorithm as one
of the content codings. Such a content coding would only be listed if,
for some bizarre reason, it is applied a second time to form the
representation. Likewise, an origin server might choose to publish the
same data as multiple representations that differ only in whether
the coding is defined as part of [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type) or
Content-Encoding, since some user agents will behave differently in their
handling of each response (e.g., open a "Save as ..." dialog instead of
automatic decompression and rendering of content). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-8)

An origin server MAY respond with a status code of
[415 (Unsupported Media Type)](https://www.rfc-editor.org/rfc/rfc9110.html#status.415) if a representation in the
request message has a content coding that is not acceptable. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4-9)

#### [8.4.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.4.1) [Content Codings](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-codings)

Content coding values indicate an encoding transformation that has
been or can be applied to a representation. Content codings are primarily
used to allow a representation to be compressed or otherwise usefully
transformed without losing the identity of its underlying media type
and without loss of information. Frequently, the representation is stored
in coded form, transmitted directly, and only decoded by the final recipient. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1-1)

```abnf9110
  content-coding   = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1-2)

All content codings are case-insensitive and ought to be registered
within the "HTTP Content Coding Registry", as described in
[Section 16.6](https://www.rfc-editor.org/rfc/rfc9110.html#content.coding.extensibility) [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1-3)

Content-coding values are used in the
[Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding) ( [Section 12.5.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding))
and [Content-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding) ( [Section 8.4](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-encoding))
header fields. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1-4)

##### [8.4.1.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.4.1.1) [Compress Coding](https://www.rfc-editor.org/rfc/rfc9110.html\#name-compress-coding)

The "compress" coding is an adaptive Lempel-Ziv-Welch (LZW) coding
\[ [Welch](https://www.rfc-editor.org/rfc/rfc9110.html#Welch)\] that is commonly produced by the UNIX file
compression program "compress".
A recipient SHOULD consider "x-compress" to be equivalent to "compress". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1.1-1)

##### [8.4.1.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.4.1.2) [Deflate Coding](https://www.rfc-editor.org/rfc/rfc9110.html\#name-deflate-coding)

The "deflate" coding is a "zlib" data format \[ [RFC1950](https://www.rfc-editor.org/rfc/rfc9110.html#RFC1950)\]
containing a "deflate" compressed data stream \[ [RFC1951](https://www.rfc-editor.org/rfc/rfc9110.html#RFC1951)\]
that uses a combination of the Lempel-Ziv (LZ77) compression algorithm and
Huffman coding. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1.2-1)

##### [8.4.1.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.4.1.3) [Gzip Coding](https://www.rfc-editor.org/rfc/rfc9110.html\#name-gzip-coding)

The "gzip" coding is an LZ77 coding with a 32-bit Cyclic Redundancy Check
(CRC) that is commonly
produced by the gzip file compression program \[ [RFC1952](https://www.rfc-editor.org/rfc/rfc9110.html#RFC1952)\].
A recipient SHOULD consider "x-gzip" to be equivalent to "gzip". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.4.1.3-1)

### [8.5.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.5) [Content-Language](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-language)

The "Content-Language" header field describes the natural
language(s) of the intended audience for the representation. Note that this might
not be equivalent to all the languages used within the representation. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-1)

```abnf9110
  Content-Language = #language-tag
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-2)

Language tags are defined in [Section 8.5.1](https://www.rfc-editor.org/rfc/rfc9110.html#language.tags). The primary purpose of
Content-Language is to allow a user to identify and differentiate
representations according to the users' own preferred language. Thus, if the
content is intended only for a Danish-literate audience, the
appropriate field is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-3)

```http-message
Content-Language: da
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-4)

If no Content-Language is specified, the default is that the content
is intended for all language audiences. This might mean that the
sender does not consider it to be specific to any natural language,
or that the sender does not know for which language it is intended. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-5)

Multiple languages MAY be listed for content that is intended for
multiple audiences. For example, a rendition of the "Treaty of
Waitangi", presented simultaneously in the original Maori and English
versions, would call for [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-6)

```http-message
Content-Language: mi, en
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-7)

However, just because multiple languages are present within a representation
does not mean that it is intended for multiple linguistic audiences.
An example would be a beginner's language primer, such as "A First
Lesson in Latin", which is clearly intended to be used by an
English-literate audience. In this case, the Content-Language would
properly only include "en". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-8)

Content-Language MAY be applied to any media type -- it is not
limited to textual documents. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5-9)

#### [8.5.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.5.1) [Language Tags](https://www.rfc-editor.org/rfc/rfc9110.html\#name-language-tags)

A language tag, as defined in \[ [RFC5646](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5646)\], identifies a
natural language spoken, written, or otherwise conveyed by human beings for
communication of information to other human beings. Computer languages are
explicitly excluded. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-1)

HTTP uses language tags within the [Accept-Language](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-language) and
[Content-Language](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-language) header fields.
[Accept-Language](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-language) uses the broader language-range production
defined in [Section 12.5.4](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-language), whereas
[Content-Language](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-language) uses the language-tag production defined
below. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-2)

```abnf9110
  language-tag = <Language-Tag, see [RFC5646], Section 2.1>
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-3)

A language tag is a sequence of one or more case-insensitive subtags, each
separated by a hyphen character ("-", %x2D). In most cases, a language tag
consists of a primary language subtag that identifies a broad family of
related languages (e.g., "en" = English), which is optionally followed by a
series of subtags that refine or narrow that language's range (e.g.,
"en-CA" = the variety of English as communicated in Canada).
Whitespace is not allowed within a language tag.
Example tags include: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-4)

```
  fr, en-US, es-419, az-Arab, x-pig-latin, man-Nkoo-GN
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-5)

See \[ [RFC5646](https://www.rfc-editor.org/rfc/rfc9110.html#RFC5646)\] for further information. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.5.1-6)

### [8.6.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.6) [Content-Length](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-length)

The "Content-Length" header field indicates the associated representation's
data length as a decimal non-negative integer number of octets.
When transferring a representation as content, Content-Length refers
specifically to the amount of data enclosed so that it can be used to
delimit framing (e.g., [Section 6.2](https://www.rfc-editor.org/rfc/rfc9112#section-6.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]).
In other cases, Content-Length indicates the selected representation's
current length, which can be used by recipients to estimate transfer time
or to compare with previously stored representations. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-1)

```abnf9110
  Content-Length = 1*DIGIT
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-2)

An example is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-3)

```http-message
Content-Length: 3495
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-4)

A user agent SHOULD send Content-Length in a request when the method
defines a meaning for enclosed content and it is not sending
Transfer-Encoding.
For example, a user agent normally sends Content-Length in a POST request
even when the value is 0 (indicating empty content).
A user agent SHOULD NOT send a
Content-Length header field when the request message does not contain
content and the method semantics do not anticipate such data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-5)

A server MAY send a Content-Length header field in a response to a HEAD
request ( [Section 9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD)); a server MUST NOT send Content-Length in such a
response unless its field value equals the decimal number of octets that
would have been sent in the content of a response if the same
request had used the GET method. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-6)

A server MAY send a Content-Length header field in a
[304 (Not Modified)](https://www.rfc-editor.org/rfc/rfc9110.html#status.304) response to a conditional GET request
( [Section 15.4.5](https://www.rfc-editor.org/rfc/rfc9110.html#status.304)); a server MUST NOT send Content-Length in such a
response unless its field value equals the decimal number of octets that
would have been sent in the content of a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200)
response to the same request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-7)

A server MUST NOT send a Content-Length header field in any response
with a status code of
[1xx (Informational)](https://www.rfc-editor.org/rfc/rfc9110.html#status.1xx) or [204 (No Content)](https://www.rfc-editor.org/rfc/rfc9110.html#status.204).
A server MUST NOT send a Content-Length header field in any
[2xx (Successful)](https://www.rfc-editor.org/rfc/rfc9110.html#status.2xx) response to a CONNECT request ( [Section 9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#CONNECT)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-8)

Aside from the cases defined above, in the absence of Transfer-Encoding,
an origin server SHOULD send a Content-Length header field when the
content size is known prior to sending the complete header section.
This will allow downstream recipients to measure transfer progress,
know when a received message is complete, and potentially reuse the
connection for additional requests. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-9)

Any Content-Length field value greater than or equal to zero is valid.
Since there is no predefined limit to the length of content, a
recipient MUST anticipate potentially large decimal numerals and
prevent parsing errors due to integer conversion overflows
or precision loss due to integer conversion
( [Section 17.5](https://www.rfc-editor.org/rfc/rfc9110.html#attack.protocol.element.length)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-10)

Because Content-Length is used for message delimitation in HTTP/1.1,
its field value can impact how the message is parsed by downstream
recipients even when the immediate connection is not using HTTP/1.1.
If the message is forwarded by a downstream intermediary, a Content-Length
field value that is inconsistent with the received message framing might
cause a security failure due to request smuggling or response splitting. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-11)

As a result, a sender MUST NOT forward a message with a
Content-Length header field value that is known to be incorrect. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-12)

Likewise, a sender MUST NOT forward a message with a Content-Length
header field value that does not match the ABNF above, with one exception:
a recipient of a Content-Length header field value consisting of the same
decimal value repeated as a comma-separated list (e.g,
"Content-Length: 42, 42") MAY either reject the message as invalid or
replace that invalid field value with a single instance of the decimal
value, since this likely indicates that a duplicate was generated or
combined by an upstream message processor. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.6-13)

### [8.7.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.7) [Content-Location](https://www.rfc-editor.org/rfc/rfc9110.html\#name-content-location)

The "Content-Location" header field references a URI that can be used
as an identifier for a specific resource corresponding to the
representation in this message's content.
In other words, if one were to perform a GET request on this URI at the time
of this message's generation, then a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200) response would
contain the same representation that is enclosed as content in this message. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-1)

```abnf9110
  Content-Location = absolute-URI / partial-URI
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-2)

The field value is either an [absolute-URI](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references) or a
[partial-URI](https://www.rfc-editor.org/rfc/rfc9110.html#uri.references). In the latter case ( [Section 4](https://www.rfc-editor.org/rfc/rfc9110.html#uri)),
the referenced URI is relative to the target URI
(\[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\], [Section 5](https://www.rfc-editor.org/rfc/rfc3986#section-5)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-3)

The Content-Location value is not a replacement for the target URI
( [Section 7.1](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource)). It is representation metadata.
It has the same syntax and semantics as the header field of the same name
defined for MIME body parts in [Section 4](https://www.rfc-editor.org/rfc/rfc2557#section-4) of \[ [RFC2557](https://www.rfc-editor.org/rfc/rfc9110.html#RFC2557)\].
However, its appearance in an HTTP message has some special implications
for HTTP recipients. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-4)

If Content-Location is included in a [2xx (Successful)](https://www.rfc-editor.org/rfc/rfc9110.html#status.2xx)
response message and its value refers (after conversion to absolute form)
to a URI that is the same as the target URI, then
the recipient MAY consider the content to be a current representation of
that resource at the time indicated by the message origination date.
For a GET ( [Section 9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET)) or HEAD ( [Section 9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD)) request,
this is the same as the default semantics when no Content-Location is
provided by the server.
For a state-changing request like PUT ( [Section 9.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#PUT)) or
POST ( [Section 9.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#POST)), it implies that the server's response
contains the new representation of that resource, thereby distinguishing it
from representations that might only report about the action
(e.g., "It worked!").
This allows authoring applications to update their local copies without
the need for a subsequent GET request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-5)

If Content-Location is included in a [2xx (Successful)](https://www.rfc-editor.org/rfc/rfc9110.html#status.2xx)
response message and its field value refers to a URI that differs from the
target URI, then the origin server claims that the URI
is an identifier for a different resource corresponding to the enclosed
representation. Such a claim can only be trusted if both identifiers share
the same resource owner, which cannot be programmatically determined via
HTTP. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-6)

- For a response to a GET or HEAD request, this is an indication that the
target URI refers to a resource that is subject to content
negotiation and the Content-Location field value is a more specific
identifier for the [selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-7.1)
- For a [201 (Created)](https://www.rfc-editor.org/rfc/rfc9110.html#status.201) response to a state-changing method,
a Content-Location field value that is identical to the
[Location](https://www.rfc-editor.org/rfc/rfc9110.html#field.location) field value indicates that this content is a
current representation of the newly created resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-7.2)
- Otherwise, such a Content-Location indicates that this content is a
representation reporting on the requested action's status and that the
same report is available (for future access with GET) at the given URI.
For example, a purchase transaction made via a POST request might
include a receipt document as the content of the [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200)
response; the Content-Location field value provides an identifier for
retrieving a copy of that same receipt in the future. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-7.3)

A user agent that sends Content-Location in a request message is stating
that its value refers to where the user agent originally obtained the
content of the enclosed representation (prior to any modifications made by
that user agent). In other words, the user agent is providing a back link
to the source of the original representation. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-8)

An origin server that receives a Content-Location field in a request
message MUST treat the information as transitory request context rather
than as metadata to be saved verbatim as part of the representation.
An origin server MAY use that context to guide in processing the
request or to save it for other uses, such as within source links or
versioning metadata. However, an origin server MUST NOT use such context
information to alter the request semantics. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-9)

For example, if a client makes a PUT request on a negotiated resource and
the origin server accepts that PUT (without redirection), then the new
state of that resource is expected to be consistent with the one
representation supplied in that PUT; the Content-Location cannot be used as
a form of reverse content selection identifier to update only one of the
negotiated representations. If the user agent had wanted the latter
semantics, it would have applied the PUT directly to the Content-Location
URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.7-10)

### [8.8.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8) [Validator Fields](https://www.rfc-editor.org/rfc/rfc9110.html\#name-validator-fields)

Resource metadata is referred to as a "validator" if it
can be used within a precondition ( [Section 13.1](https://www.rfc-editor.org/rfc/rfc9110.html#preconditions)) to
make a conditional request ( [Section 13](https://www.rfc-editor.org/rfc/rfc9110.html#conditional.requests)).
Validator fields convey a current validator for the
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation)
( [Section 3.2](https://www.rfc-editor.org/rfc/rfc9110.html#representations)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8-1)

In responses to safe requests, validator fields describe the selected
representation chosen by the origin server while handling the response.
Note that, depending on the method and status code semantics, the
selected representation for a given response is not
necessarily the same as the representation enclosed as response content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8-2)

In a successful response to a state-changing request, validator fields
describe the new representation that has replaced the prior
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation) as a result of processing the
request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8-3)

For example, an ETag field in a [201 (Created)](https://www.rfc-editor.org/rfc/rfc9110.html#status.201) response
communicates the entity tag of the newly created resource's
representation, so that the entity tag can be used as a validator in
later conditional requests to prevent the "lost update" problem. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8-4)

This specification defines two forms of metadata that are commonly used
to observe resource state and test for preconditions: modification dates
( [Section 8.8.2](https://www.rfc-editor.org/rfc/rfc9110.html#field.last-modified)) and opaque entity tags
( [Section 8.8.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.etag)).
Additional metadata that reflects resource state
has been defined by various extensions of HTTP, such as Web Distributed
Authoring and Versioning \[ [WEBDAV](https://www.rfc-editor.org/rfc/rfc9110.html#WEBDAV)\], that are beyond the
scope of this specification. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8-5)

#### [8.8.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.1) [Weak versus Strong](https://www.rfc-editor.org/rfc/rfc9110.html\#name-weak-versus-strong)

Validators come in two flavors: strong or weak. Weak validators are easy
to generate but are far less useful for comparisons. Strong validators
are ideal for comparisons but can be very difficult (and occasionally
impossible) to generate efficiently. Rather than impose that all forms
of resource adhere to the same strength of validator, HTTP exposes the
type of validator in use and imposes restrictions on when weak validators
can be used as preconditions. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-1)

A "strong validator" is representation metadata that changes value whenever
a change occurs to the representation data that would be observable in the
content of a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200) response to GET. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-2)

A strong validator might change for reasons other than a change to the
representation data, such as when a
semantically significant part of the representation metadata is changed
(e.g., [Content-Type](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-type)), but it is in the best interests of the
origin server to only change the value when it is necessary to invalidate
the stored responses held by remote caches and authoring tools. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-3)

Cache entries might persist for arbitrarily long periods, regardless
of expiration times. Thus, a cache might attempt to validate an
entry using a validator that it obtained in the distant past.
A strong validator is unique across all versions of all
representations associated with a particular resource over time.
However, there is no implication of uniqueness across representations
of different resources (i.e., the same strong validator might be
in use for representations of multiple resources at the same time
and does not imply that those representations are equivalent). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-4)

There are a variety of strong validators used in practice. The best are
based on strict revision control, wherein each change to a representation
always results in a unique node name and revision identifier being assigned
before the representation is made accessible to GET.
A collision-resistant hash
function applied to the representation data is also sufficient if the data
is available prior to the response header fields being sent and the digest
does not need to be recalculated every time a validation request is
received. However, if a resource has distinct representations that differ
only in their metadata, such as might occur with content negotiation over
media types that happen to share the same data format, then the origin
server needs to incorporate additional information in the validator to
distinguish those representations. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-5)

In contrast, a "weak validator" is representation metadata
that might not change for every change to the representation data. This
weakness might be due to limitations in how the value is calculated
(e.g., clock resolution), an inability to ensure uniqueness for all
possible representations of the resource, or a desire of the resource
owner to group representations by some self-determined set of
equivalency rather than unique sequences of data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-6)

An origin server SHOULD change a weak entity tag whenever it
considers prior representations to be unacceptable as a substitute for
the current representation. In other words, a weak entity tag ought to
change whenever the origin server wants caches to invalidate old
responses. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-7)

For example, the representation of a weather report that changes in
content every second, based on dynamic measurements, might be grouped
into sets of equivalent representations (from the origin server's
perspective) with the same weak validator in order to allow cached
representations to be valid for a reasonable period of time (perhaps
adjusted dynamically based on server load or weather quality).
Likewise, a representation's modification time, if defined with only
one-second resolution, might be a weak validator if it is possible
for the representation to be modified twice during a single second and
retrieved between those modifications. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-8)

Likewise, a validator is weak if it is shared by two or more
representations of a given resource at the same time, unless those
representations have identical representation data. For example, if the
origin server sends the same validator for a representation with a gzip
content coding applied as it does for a representation with no content
coding, then that validator is weak. However, two simultaneous
representations might share the same strong validator if they differ only
in the representation metadata, such as when two different media types are
available for the same representation data. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-9)

Strong validators are usable for all conditional requests, including cache
validation, partial content ranges, and "lost update" avoidance.
Weak validators are only usable when the client does not require exact
equality with previously obtained representation data, such as when
validating a cache entry or limiting a web traversal to recent changes. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.1-10)

#### [8.8.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.2) [Last-Modified](https://www.rfc-editor.org/rfc/rfc9110.html\#name-last-modified)

The "Last-Modified" header field in a response provides a timestamp
indicating the date and time at which the origin server believes the
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation) was last modified, as determined at the conclusion
of handling the request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2-1)

```abnf9110
  Last-Modified = HTTP-date
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2-2)

An example of its use is [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2-3)

```http-message
Last-Modified: Tue, 15 Nov 1994 12:45:26 GMT
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2-4)

##### [8.8.2.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.2.1) [Generation](https://www.rfc-editor.org/rfc/rfc9110.html\#name-generation)

An origin server SHOULD send Last-Modified for any selected
representation for which a last modification date can be reasonably
and consistently determined, since its use in conditional requests
and evaluating cache freshness (\[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]) can
substantially reduce unnecessary transfers and significantly
improve service availability and scalability. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.1-1)

A representation is typically the sum of many parts behind the
resource interface. The last-modified time would usually be
the most recent time that any of those parts were changed.
How that value is determined for any given resource is an
implementation detail beyond the scope of this specification. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.1-2)

An origin server SHOULD obtain the Last-Modified value of the
representation as close as possible to the time that it generates the
[Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) field value for its response. This allows a recipient to
make an accurate assessment of the representation's modification time,
especially if the representation changes near the time that the
response is generated. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.1-3)

An origin server with a clock (as defined in [Section 5.6.7](https://www.rfc-editor.org/rfc/rfc9110.html#http.date))
MUST NOT generate a Last-Modified date that is later than the
server's time of message origination
( [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date), [Section 6.6.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.date)).
If the last modification time is derived from implementation-specific
metadata that evaluates to some time in the future, according to the
origin server's clock, then the origin server MUST replace that
value with the message origination date. This prevents a future
modification date from having an adverse impact on cache validation. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.1-4)

An origin server without a clock MUST NOT generate a Last-Modified
date for a response unless that date value was assigned to the resource
by some other system (presumably one with a clock). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.1-5)

##### [8.8.2.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.2.2) [Comparison](https://www.rfc-editor.org/rfc/rfc9110.html\#name-comparison)

A Last-Modified time, when used as a validator in a request, is
implicitly weak unless it is possible to deduce that it is strong,
using the following rules: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-1)

- The validator is being compared by an origin server to the
actual current validator for the representation and, [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-2.1)
- That origin server reliably knows that the associated representation did
not change twice during the second covered by the presented
validator; [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-2.2)

or [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-3)

- The validator is about to be used by a client in an
[If-Modified-Since](https://www.rfc-editor.org/rfc/rfc9110.html#field.if-modified-since),
[If-Unmodified-Since](https://www.rfc-editor.org/rfc/rfc9110.html#field.if-unmodified-since), or [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#field.if-range) header
field, because the client has a cache entry for the associated
representation, and [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-4.1)
- That cache entry includes a [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) value which is
at least one second after the Last-Modified value and
the client has reason to believe that they were generated by the
same clock or that there is enough difference between the Last-Modified
and Date values to make clock synchronization issues unlikely; [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-4.2)

or [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-5)

- The validator is being compared by an intermediate cache to the
validator stored in its cache entry for the representation, and [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-6.1)
- That cache entry includes a [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) value which is
at least one second after the Last-Modified value and
the cache has reason to believe that they were generated by the
same clock or that there is enough difference between the Last-Modified
and Date values to make clock synchronization issues unlikely. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-6.2)

This method relies on the fact that if two different responses were
sent by the origin server during the same second, but both had the
same Last-Modified time, then at least one of those responses would
have a [Date](https://www.rfc-editor.org/rfc/rfc9110.html#field.date) value equal to its Last-Modified time. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2-7)

#### [8.8.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.3) [ETag](https://www.rfc-editor.org/rfc/rfc9110.html\#name-etag)

The "ETag" field in a response provides the current entity tag for
the [selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation), as determined at the conclusion of handling
the request.
An entity tag is an opaque validator for differentiating between
multiple representations of the same resource, regardless of whether
those multiple representations are due to resource state changes over
time, content negotiation resulting in multiple representations being
valid at the same time, or both. An entity tag consists of an opaque
quoted string, possibly prefixed by a weakness indicator. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-1)

```abnf9110
  ETag       = entity-tag

  entity-tag = [ weak ] opaque-tag
  weak       = %s"W/"
  opaque-tag = DQUOTE *etagc DQUOTE
  etagc      = %x21 / %x23-7E / obs-text
             ; VCHAR except double quotes, plus obs-text
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-2)

An entity tag can be more reliable for validation than a modification
date in situations where it is inconvenient to store modification
dates, where the one-second resolution of HTTP-date values is not
sufficient, or where modification dates are not consistently maintained. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-4)

Examples: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-5)

```http-message
ETag: "xyzzy"
ETag: W/"xyzzy"
ETag: ""
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-6)

An entity tag can be either a weak or strong validator, with
strong being the default. If an origin server provides an entity tag
for a representation and the generation of that entity tag does not satisfy
all of the characteristics of a strong validator
( [Section 8.8.1](https://www.rfc-editor.org/rfc/rfc9110.html#weak.and.strong.validators)), then the origin server
MUST mark the entity tag as weak by prefixing its opaque value
with "W/" (case-sensitive). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-7)

A sender MAY send the ETag field in a trailer section (see
[Section 6.5](https://www.rfc-editor.org/rfc/rfc9110.html#trailer.fields)). However, since trailers are often
ignored, it is preferable to send ETag as a header field unless the
entity tag is generated while sending the content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3-8)

##### [8.8.3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.3.1) [Generation](https://www.rfc-editor.org/rfc/rfc9110.html\#name-generation-2)

The principle behind entity tags is that only the service author
knows the implementation of a resource well enough to select the
most accurate and efficient validation mechanism for that resource,
and that any such mechanism can be mapped to a simple sequence of
octets for easy comparison. Since the value is opaque, there is no
need for the client to be aware of how each entity tag is constructed. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.1-1)

For example, a resource that has implementation-specific versioning
applied to all changes might use an internal revision number, perhaps
combined with a variance identifier for content negotiation, to
accurately differentiate between representations.
Other implementations might use a collision-resistant hash of
representation content, a combination of various file attributes, or
a modification timestamp that has sub-second resolution. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.1-2)

An origin server SHOULD send an ETag for any selected representation
for which detection of changes can be reasonably and consistently
determined, since the entity tag's use in conditional requests and
evaluating cache freshness (\[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]) can
substantially reduce unnecessary transfers and significantly
improve service availability, scalability, and reliability. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.1-3)

##### [8.8.3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.3.2) [Comparison](https://www.rfc-editor.org/rfc/rfc9110.html\#name-comparison-2)

There are two entity tag comparison functions, depending on whether or not
the comparison context allows the use of weak validators: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2-1)

"Strong comparison":

two entity tags are equivalent if both are not weak and their opaque-tags
match character-by-character. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2-2.2)
"Weak comparison":

two entity tags are equivalent if their opaque-tags match
character-by-character, regardless of either or both being tagged as "weak". [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2-2.4)

The example below shows the results for a set of entity tag pairs and both
the weak and strong comparison function results: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.2-3)

| ETag 1 | ETag 2 | Strong Comparison | Weak Comparison |
| --- | --- | --- | --- |
| W/"1" | W/"1" | no match | match |
| W/"1" | W/"2" | no match | no match |
| W/"1" | "1" | no match | match |
| "1" | "1" | match | match |

[Table 3](https://www.rfc-editor.org/rfc/rfc9110.html#table-3)

##### [8.8.3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-8.8.3.3) [Example: Entity Tags Varying on Content-Negotiated Resources](https://www.rfc-editor.org/rfc/rfc9110.html\#name-example-entity-tags-varying)

Consider a resource that is subject to content negotiation
( [Section 12](https://www.rfc-editor.org/rfc/rfc9110.html#content.negotiation)), and where the representations sent in response to
a GET request vary based on the [Accept-Encoding](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding) request
header field ( [Section 12.5.3](https://www.rfc-editor.org/rfc/rfc9110.html#field.accept-encoding)): [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-1)

>\> Request: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-2)

```http-message
GET /index HTTP/1.1
Host: www.example.com
Accept-Encoding: gzip
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-3)

In this case, the response might or might not use the gzip content coding.
If it does not, the response might look like: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-4)

>\> Response: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-5)

```http-message
HTTP/1.1 200 OK
Date: Fri, 26 Mar 2010 00:05:00 GMT
ETag: "123-a"
Content-Length: 70
Vary: Accept-Encoding
Content-Type: text/plain

Hello World!
Hello World!
Hello World!
Hello World!
Hello World!
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-6)

An alternative representation that does use gzip content coding would be: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-7)

>\> Response: [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-8)

```http-message
HTTP/1.1 200 OK
Date: Fri, 26 Mar 2010 00:05:00 GMT
ETag: "123-b"
Content-Length: 43
Vary: Accept-Encoding
Content-Type: text/plain
Content-Encoding: gzip

...binary data...
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3.3-9)

## [9\.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9) [Methods](https://www.rfc-editor.org/rfc/rfc9110.html\#name-methods)

### [9.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.1) [Overview](https://www.rfc-editor.org/rfc/rfc9110.html\#name-overview)

The request method token is the primary source of request semantics;
it indicates the purpose for which the client has made this request
and what is expected by the client as a successful result. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-1)

The request method's semantics might be further specialized by the
semantics of some header fields when present in a request
if those additional semantics do not conflict with the method.
For example, a client can send conditional request header fields
( [Section 13.1](https://www.rfc-editor.org/rfc/rfc9110.html#preconditions)) to make the requested
action conditional on the current state of the target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-2)

HTTP is designed to be usable as an interface to distributed
object systems. The request method invokes an action to be applied to
a [target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource) in much the same way that a remote
method invocation can be sent to an identified object. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-3)

```abnf9110
  method = token
```

[¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-4)

The method token is case-sensitive because it might be used as a gateway
to object-based systems with case-sensitive method names. By convention,
standardized methods are defined in all-uppercase US-ASCII letters. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-5)

Unlike distributed objects, the standardized request methods in HTTP are
not resource-specific, since uniform interfaces provide for better
visibility and reuse in network-based systems \[ [REST](https://www.rfc-editor.org/rfc/rfc9110.html#REST)\].
Once defined, a standardized method ought to have the same semantics when
applied to any resource, though each resource determines for itself
whether those semantics are implemented or allowed. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-6)

This specification defines a number of standardized methods that are
commonly used in HTTP, as outlined by the following table. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-7)

| Method Name | Description | Section |
| --- | --- | --- |
| GET | Transfer a current representation of the target resource. | [9.3.1](https://www.rfc-editor.org/rfc/rfc9110.html#GET) |
| HEAD | Same as GET, but do not transfer the response content. | [9.3.2](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD) |
| POST | Perform resource-specific processing on the request content. | [9.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#POST) |
| PUT | Replace all current representations of the target resource with<br> the request content. | [9.3.4](https://www.rfc-editor.org/rfc/rfc9110.html#PUT) |
| DELETE | Remove all current representations of the target resource. | [9.3.5](https://www.rfc-editor.org/rfc/rfc9110.html#DELETE) |
| CONNECT | Establish a tunnel to the server identified by the target resource. | [9.3.6](https://www.rfc-editor.org/rfc/rfc9110.html#CONNECT) |
| OPTIONS | Describe the communication options for the target resource. | [9.3.7](https://www.rfc-editor.org/rfc/rfc9110.html#OPTIONS) |
| TRACE | Perform a message loop-back test along the path to the target resource. | [9.3.8](https://www.rfc-editor.org/rfc/rfc9110.html#TRACE) |

[Table 4](https://www.rfc-editor.org/rfc/rfc9110.html#table-4)

All general-purpose servers MUST support the methods GET and HEAD.
All other methods are OPTIONAL. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-9)

The set of methods allowed by a target resource can be listed in an
[Allow](https://www.rfc-editor.org/rfc/rfc9110.html#field.allow) header field ( [Section 10.2.1](https://www.rfc-editor.org/rfc/rfc9110.html#field.allow)).
However, the set of allowed methods can change dynamically.
An origin server that receives a request method that is unrecognized or
not implemented SHOULD respond with the
[501 (Not Implemented)](https://www.rfc-editor.org/rfc/rfc9110.html#status.501) status code.
An origin server that receives a request method that is recognized and
implemented, but not allowed for the target resource, SHOULD respond
with the [405 (Method Not Allowed)](https://www.rfc-editor.org/rfc/rfc9110.html#status.405) status code. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-10)

Additional methods, outside the scope of this specification, have been
specified for use in HTTP. All such methods ought to be registered
within the "Hypertext Transfer Protocol (HTTP) Method Registry",
as described in [Section 16.1](https://www.rfc-editor.org/rfc/rfc9110.html#method.extensibility). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.1-11)

### [9.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.2) [Common Method Properties](https://www.rfc-editor.org/rfc/rfc9110.html\#name-common-method-properties)

#### [9.2.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.2.1) [Safe Methods](https://www.rfc-editor.org/rfc/rfc9110.html\#name-safe-methods)

Request methods are considered "safe" if
their defined semantics are essentially read-only; i.e., the client does
not request, and does not expect, any state change on the origin server
as a result of applying a safe method to a target resource. Likewise,
reasonable use of a safe method is not expected to cause any harm,
loss of property, or unusual burden on the origin server. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-1)

This definition of safe methods does not prevent an implementation from
including behavior that is potentially harmful, that is not entirely read-only,
or that causes side effects while invoking a safe method. What is
important, however, is that the client did not request that additional
behavior and cannot be held accountable for it. For example,
most servers append request information to access log files at the
completion of every response, regardless of the method, and that is
considered safe even though the log storage might become full and cause
the server to fail. Likewise, a safe request initiated by selecting an
advertisement on the Web will often have the side effect of charging an
advertising account. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-2)

Of the request methods defined by this specification, the
[GET](https://www.rfc-editor.org/rfc/rfc9110.html#GET), [HEAD](https://www.rfc-editor.org/rfc/rfc9110.html#HEAD), [OPTIONS](https://www.rfc-editor.org/rfc/rfc9110.html#OPTIONS), and
[TRACE](https://www.rfc-editor.org/rfc/rfc9110.html#TRACE) methods are defined to be safe. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-3)

The purpose of distinguishing between safe and unsafe methods is to
allow automated retrieval processes (spiders) and cache performance
optimization (pre-fetching) to work without fear of causing harm.
In addition, it allows a user agent to apply appropriate constraints
on the automated use of unsafe methods when processing potentially
untrusted content. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-4)

A user agent SHOULD distinguish between safe and unsafe methods when
presenting potential actions to a user, such that the user can be made
aware of an unsafe action before it is requested. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-5)

When a resource is constructed such that parameters within the target URI
have the effect of selecting an action, it is the resource
owner's responsibility to ensure that the action is consistent with the
request method semantics.
For example, it is common for Web-based content editing software
to use actions within query parameters, such as "page?do=delete".
If the purpose of such a resource is to perform an unsafe action, then
the resource owner MUST disable or disallow that action when it is
accessed using a safe request method. Failure to do so will result in
unfortunate side effects when automated processes perform a GET on
every URI reference for the sake of link maintenance, pre-fetching,
building a search index, etc. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.1-6)

#### [9.2.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.2.2) [Idempotent Methods](https://www.rfc-editor.org/rfc/rfc9110.html\#name-idempotent-methods)

A request method is considered "idempotent"
if the intended effect on the server of multiple identical requests with
that method is the same as the effect for a single such request.
Of the request methods defined by this
specification, [PUT](https://www.rfc-editor.org/rfc/rfc9110.html#PUT), [DELETE](https://www.rfc-editor.org/rfc/rfc9110.html#DELETE), and safe request
methods are idempotent. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-1)

Like the definition of safe, the idempotent property only applies to
what has been requested by the user; a server is free to log each request
separately, retain a revision control history, or implement other
non-idempotent side effects for each idempotent request. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-2)

Idempotent methods are distinguished because the request can be repeated
automatically if a communication failure occurs before the client is
able to read the server's response. For example, if a client sends a PUT
request and the underlying connection is closed before any response is
received, then the client can establish a new connection and retry the
idempotent request. It knows that repeating the request will have
the same intended effect, even if the original request succeeded, though
the response might differ. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-3)

A client SHOULD NOT automatically retry a request with a non-idempotent
method unless it has some means to know that the request semantics are
actually idempotent, regardless of the method, or some means to detect that
the original request was never applied. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-4)

For example, a user agent can repeat a POST request automatically if it
knows (through design or configuration) that the request is safe for that
resource. Likewise, a user agent designed specifically to operate on
a version control repository might be able to recover from partial failure
conditions by checking the target resource revision(s) after a failed
connection, reverting or fixing any changes that were partially applied,
and then automatically retrying the requests that failed. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-5)

Some clients take a riskier approach and attempt to guess when an
automatic retry is possible. For example, a client might automatically
retry a POST request if the underlying transport connection closed before
any part of a response is received, particularly if an idle persistent
connection was used. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-6)

A proxy MUST NOT automatically retry non-idempotent requests.
A client SHOULD NOT automatically retry a failed automatic retry. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2-7)

#### [9.2.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.2.3) [Methods and Caching](https://www.rfc-editor.org/rfc/rfc9110.html\#name-methods-and-caching)

For a cache to store and use a response, the associated method needs to
explicitly allow caching and to detail under what conditions a response can
be used to satisfy subsequent requests; a method definition that does not
do so cannot be cached. For additional requirements see \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.3-1)

This specification defines caching semantics for GET, HEAD, and POST,
although the overwhelming majority of cache implementations only support
GET and HEAD. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.3-2)

### [9.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.3) [Method Definitions](https://www.rfc-editor.org/rfc/rfc9110.html\#name-method-definitions)

#### [9.3.1.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.3.1) [GET](https://www.rfc-editor.org/rfc/rfc9110.html\#name-get)

The GET method requests transfer of a current
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation) for the
[target resource](https://www.rfc-editor.org/rfc/rfc9110.html#target.resource).
A successful response reflects the quality of "sameness" identified by
the target URI ([Section 1.2.2](https://www.rfc-editor.org/rfc/rfc3986#section-1.2.2) of \[ [URI](https://www.rfc-editor.org/rfc/rfc9110.html#URI)\]). Hence,
retrieving identifiable information via HTTP is usually performed by
making a GET request on an identifier associated with the potential for
providing that information in a [200 (OK)](https://www.rfc-editor.org/rfc/rfc9110.html#status.200) response. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-1)

GET is the primary mechanism of information retrieval and the focus of
almost all performance optimizations. Applications that produce a URI for
each important resource can benefit from those optimizations while enabling
their reuse by other applications, creating a network effect that promotes
further expansion of the Web. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-2)

It is tempting to think of resource identifiers as remote file system
pathnames and of representations as being a copy of the contents of such
files. In fact, that is how many resources are implemented (see
[Section 17.3](https://www.rfc-editor.org/rfc/rfc9110.html#attack.pathname) for related security considerations).
However, there are no such limitations in practice. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-3)

The HTTP interface for
a resource is just as likely to be implemented as a tree of content
objects, a programmatic view on various database records, or a gateway to
other information systems. Even when the URI mapping mechanism is tied to a
file system, an origin server might be configured to execute the files with
the request as input and send the output as the representation rather than
transfer the files directly. Regardless, only the origin server needs to
know how each resource identifier corresponds to an implementation
and how that implementation manages to select and send a current
representation of the target resource. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-4)

A client can alter the semantics of GET to be a "range request", requesting
transfer of only some part(s) of the selected representation, by sending a
[Range](https://www.rfc-editor.org/rfc/rfc9110.html#field.range) header field in the request ( [Section 14.2](https://www.rfc-editor.org/rfc/rfc9110.html#field.range)). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-5)

Although request message framing is independent of the method used,
content received in a GET request has no generally defined semantics,
cannot alter the meaning or target of the request, and might lead some
implementations to reject the request and close the connection because of
its potential as a request smuggling attack
([Section 11.2](https://www.rfc-editor.org/rfc/rfc9112#section-11.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]).
A client SHOULD NOT generate content in a GET request unless it is
made directly to an origin server that has previously indicated,
in or out of band, that such a request has a purpose and will be adequately
supported. An origin server SHOULD NOT rely on private agreements to
receive content, since participants in HTTP communication are often
unaware of intermediaries along the request chain. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-6)

The response to a GET request is cacheable; a cache MAY use it to satisfy
subsequent GET and HEAD requests unless otherwise indicated by the
Cache-Control header field ([Section 5.2](https://www.rfc-editor.org/rfc/rfc9111#section-5.2) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]). [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-7)

When information retrieval is performed with a mechanism that constructs a
target URI from user-provided information, such as the query fields of a
form using GET, potentially sensitive data might be provided that would not
be appropriate for disclosure within a URI
(see [Section 17.9](https://www.rfc-editor.org/rfc/rfc9110.html#sensitive.information.in.uris)). In some cases, the
data can be filtered or transformed such that it would not reveal such
information. In others, particularly when there is no benefit from caching
a response, using the POST method ( [Section 9.3.3](https://www.rfc-editor.org/rfc/rfc9110.html#POST)) instead of GET
can transmit such information in the request content rather than within
the target URI. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.1-8)

#### [9.3.2.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.3.2) [HEAD](https://www.rfc-editor.org/rfc/rfc9110.html\#name-head)

The HEAD method is identical to GET except that the server MUST NOT
send content in the response. HEAD is used to obtain metadata about the
[selected representation](https://www.rfc-editor.org/rfc/rfc9110.html#selected.representation) without transferring its
representation data, often for the sake of testing hypertext links or
finding recent modifications. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2-1)

The server SHOULD send the same header fields in response to a HEAD
request as it would have sent if the request method had been GET.
However, a server MAY omit header fields for which a value is determined
only while generating the content. For example, some servers buffer a
dynamic response to GET until a minimum amount of data is generated so
that they can more efficiently delimit small responses or make late
decisions with regard to content selection. Such a response to GET might
contain [Content-Length](https://www.rfc-editor.org/rfc/rfc9110.html#field.content-length) and [Vary](https://www.rfc-editor.org/rfc/rfc9110.html#field.vary) fields, for
example, that are not generated within a HEAD response. These minor
inconsistencies are considered preferable to generating and discarding the
content for a HEAD request, since HEAD is usually requested for the
sake of efficiency. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2-2)

Although request message framing is independent of the method used,
content received in a HEAD request has no generally defined semantics,
cannot alter the meaning or target of the request, and might lead some
implementations to reject the request and close the connection because of
its potential as a request smuggling attack
([Section 11.2](https://www.rfc-editor.org/rfc/rfc9112#section-11.2) of \[ [HTTP/1.1](https://www.rfc-editor.org/rfc/rfc9110.html#HTTP11)\]).
A client SHOULD NOT generate content in a HEAD request unless it is
made directly to an origin server that has previously indicated,
in or out of band, that such a request has a purpose and will be adequately
supported. An origin server SHOULD NOT rely on private agreements to
receive content, since participants in HTTP communication are often
unaware of intermediaries along the request chain. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2-3)

The response to a HEAD request is cacheable; a cache MAY use it to
satisfy subsequent HEAD requests unless otherwise indicated by the
Cache-Control header field ([Section 5.2](https://www.rfc-editor.org/rfc/rfc9111#section-5.2) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]).
A HEAD response might also affect previously cached responses to GET;
see [Section 4.3.5](https://www.rfc-editor.org/rfc/rfc9111#section-4.3.5) of \[ [CACHING](https://www.rfc-editor.org/rfc/rfc9110.html#CACHING)\]. [¶](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.2-4)

#### [9.3.3.](https://www.rfc-editor.org/rfc/rfc9110.html\#section-9.3.3) [POST](https://www.rfc-editor.org/rfc/rfc9110.html\#name-pos
…[truncated]