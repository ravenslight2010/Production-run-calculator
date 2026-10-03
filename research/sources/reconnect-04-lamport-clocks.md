Source: https://www.cs.cornell.edu/courses/cs614/2002sp/Clocks.Lamport.1.pdf
Title: 
Fetched: 2026-09-19T16:08:06.284Z

## Time, Clocks, and the Ordering of Events in a Distributed System Leslie Lamport Time, Clocks, and the Ordering of Events in a Distributed System – p.1/32

ANDRÉ ALLAVENA
Cornell University

---

## Motivations

Time is part of our world
But time is difficult for computers
It cannot be send via messages
Time is closely linked to “before” and “after”,
but there are a lot of issues with those words
Time, Clocks, and the Ordering of Events in a Distributed System – p.2/32

---

Time, Clocks, and the Ordering of Events in a Distributed System – p.3/32

A system is distributed if the message
transmission delay is not negligible (eg: spatially
separated, multiprocessor, etc.)
Sometime, we cannot say which event
happened first, if any. This rises a lot of
difficulties, for synchronisation among others.
Also, one must be careful that algorithms to
create total ordering of events might not always
give the same ordering as the one perceived by

---

## The Partial Ordering

happened at an
What if clocks not perfectly accurate?
without clocks.
Time, Clocks, and the Ordering of Events in a Distributed System – p.4/32

if
Must have physical clocks!
happened before

---

## Definitions

The system is constituted of a collection of
Subprogram, single machine instruction,
Events form a sequence in a process (total
is an event in a process
Time, Clocks, and the Ordering of Events in a Distributed System – p.5/32

a sequence of event
is another event

receiving a message:
sending a message:

---

is the

and
and
Time, Clocks, and the Ordering of Events in a Distributed System – p.6/32

) iff
are events in the same process
is the sending of message
then
This is a irreflexive partial ordering on the set of

$$
a\rightarrow c
$$

comes before
then
and

$$
a\not\to b
$$

$$
b\not\sim a
$$

$$
a\not\to a
$$

happened before
and
and
receiving of that message
and
concurrent: if
concurrent
We assume
events

---

## Space Time Diagram

---

to
could
Time, Clocks, and the Ordering of Events in a Distributed System – p.8/32

means that it is possible for event
causally affect event
Events are concurrent if neither can causally
affect the other. Only the messages which
been sent are considered.
The theory of relativity (and space-time invariant)
actually consider the messages that
been sent as well. This is more powerful, but
requires know delivery time on the messages.
We shall regain this power (good total ordering)

---

## Logical Clocks

## This is just a way of assigning a number is a function from occurs in No relation between clocks and physical time Time, Clocks, and the Ordering of Events in a Distributed System – p.9/32

events to (non-negative) integers.
when

$$
C_{i}
$$

$$
P_{i}
$$

for process
as for Counter

$$
C\langle a\rangle
$$

$$
C_{i}\langle a\rangle
$$

$$
P_{i}
$$

is defined to be

---

## Clock Condition

Time, Clocks, and the Ordering of Events in a Distributed System – p.10/32

$$
a,b,
$$

$$
a\rightarrow b
$$

$$
C\langle a\rangle<C\langle b\rangle
$$

then
then

$$
P_{i}
$$

$$
C_{i}\langle a\rangle<C_{i}\langle b\rangle
$$

, if
The reverse doesn’t hold.
The Clock Condition is satisfied if
events in
is the sending of a message by
is the receiving of that message by
A clock ticks through every number,
The clicks happen between the events

$$
P_{i}
$$

$$
P_{j}
$$

$$
C_{i}\langle a\rangle<C_{j}\langle b\rangle
$$

,

For any event

---

## Space Time Diagram

process P
process Q
process R
p₄
p₃
p₂
p₁
q₇
q₆
q₅
q₄
q₃
q₂
q₁
r₄
r₃
r₂
r₁

---

## Time, Clocks, and the Ordering of Events in a Distributed System – p.12/32

| Process | Series | Value (relative position on axis) |
| --- | --- | --- |
| P | p₁ | 0.00 |
| P | p₂ | 0.25 |
| P | p₃ | 0.50 |
| P | p₄ | 0.75 |
| Q | q₁ | 0.00 |
| Q | q₂ | 0.25 |
| Q | q₃ | 0.50 |
| Q | q₄ | 0.60 |
| Q | q₅ | 0.75 |
| Q | q₂ (second) | 0.85 |
| R | r₁ | 0.00 |
| R | r₂ | 0.50 |
| R | r₃ | 0.75 |
| R | r₄ | 0.90 |

---

## ,

by

between any
Time, Clocks, and the Ordering of Events in a Distributed System – p.13/32

$$
P_{i}
$$

$$
C_{i}
$$

contains a time-stamp
, it increases its clock to

$$
T_{m}
$$

increments

$$
P_{i}
$$

$$
T_{m}=C_{i}\langle a\rangle
$$

Consider the events to be steps in algorithms
Each process
two consecutive events
Each message
containing the current time of the sender
is the sending of message
receives
be strictly greater than the time-stamp in

$$
P_{j}
$$

$$
m_{5}
$$

$$
C_{j}\langle b\rangle:=\max(T_{m}+1,C_{j}\langle b\rangle)
$$

---

All the events have a time, so let’s order the
events by the time they occur. Break ties by
choosing an arbitrary order on the processes.
ordering, and is far from being
).
Time, Clocks, and the Ordering of Events in a Distributed System – p.14/32

$$
b(a\Rightarrow b)
$$

$$
C_{i}\langle a\rangle<C_{i}\langle b\rangle
$$

$$
C_{i}\langle a\rangle=C_{i}\langle b\rangle
$$

$$
P_{i}\prec P_{j}
$$

) iff
and
arbitrary
unique (depends on the choice of the

$$
C_{i})
$$

---

## Ex: Distributed Mutual Exclusion

Time, Clocks, and the Ordering of Events in a Distributed System – p.15/32

Some processes are sharing a single resource.
Only one process at a time can use the resource
A process which has been granted the
resource must release it before another one
If every process which is granted the
resource eventually release it, then every
request is eventually granted
Different requests must be serviced in
the order they are made

can grab it

---

(responsible for granting the ressource)
Request 1
Request 2
My turn now
A central scheduling system doesn’t work!
Time, Clocks, and the Ordering of Events in a Distributed System – p.16/32

Hi!

---

## Solution: Idea

FIFO,but

Distributed

Force a synchronisation of the clocks
Time, Clocks, and the Ordering of Events in a Distributed System – p.17/32 are received in the
Time, Clocks, and the Ordering of Events in a Distributed System – p.18/32

to

order they were sent
all messages are eventually received
This can be enforced by acks
each process has its own request queue,
has the resource at the beginning
is smaller than the initial value of the clocks

$$
T_{0}:P_{0}
$$

messages sent from

$$
P_{0}
$$

initialised to

$$
T_{0}
$$

---

## Solution: Algorithm

(aka, my
), and put it in its
acknowledges it and puts it in its queue
(time-stamped?) message, and erases the
receives the release message, it
Time, Clocks, and the Ordering of Events in a Distributed System – p.19/32

$$
P_{i}
$$

$$
T_{m}:P_{i}
$$

$$
T_{m}
$$

$$
P_{i})
$$

$$
P_{j}
$$

broadcasts
, I am
receives the request, it
broadcasts a release
request from its queue
erases the request from its queue

$$
P_{i}
$$

To request,
current time is
own queue
To release,

$$
P_{j}
$$

---

## Algorithm, continued

$$
P_{i}
$$

at the top of the request
on request messages)
has received a message from every other
This guarantees exclusion, no locking and
This is a distributed algorithm, each process
Time, Clocks, and the Ordering of Events in a Distributed System – p.20/32

$$
T_{m}:P_{i}
$$

process, time-stamped later than

$$
P_{i}
$$

$$
T_{m}
$$

is granted the resource when
queue (ordering is
follows the rules on it own.

---

## Generalisation

The previous method can be used to implement
any kind of synchronisation for a distributed
Synchronisation is specified in terms of a State
Set of possible commands (request and
Time, Clocks, and the Ordering of Events in a Distributed System – p.21/32

Machine (wait for lecture 2/21)
release in the previous example),
Set of possible sates

---

Time, Clocks, and the Ordering of Events in a Distributed System – p.22/32

Each process independently simulates the State
Machine, using the broadcasted commands.
There is synchronisation because of the
time-stamps on all the messages and the wait to
be sure everybody has a later time than the
Note that this requires all processes to be alive

and part of the algorithm...

---

## Request 2

| Element | Description | Line type | Direction | Notes |
| --- | --- | --- | --- | --- |
| P0 timeline | Process P0's timeline | Black solid | Rightward (horizontal) |  |
| P1 timeline | Process P1's timeline | Black solid | Rightward (horizontal) |  |
| P2 timeline | Process P2's timeline | Black solid | Rightward (horizontal) |  |
| Request 1 (P1 → P0) | Request from P1 to P0 | Black solid | Upward (P1 → P0) | Has T1 |
| Request 2 (P2 → P1) | Request from P2 to P1 | Black solid | Upward (P2 → P1) | Has T2; T2 < T1 |
| T1 > T2 (P0 → P0) | Arrow from P0's T1 to P0's T2 | Red solid | Curved downward (P0 → P0) |  |
| P1 → P2 (P1 → P2) | Message from P1 to P2 | Blue dashed | Downward (P1 → P2) | "Hi, how are you?" |
| P2 → P1 (P2 → P1) | Message from P2 to P1 | Blue solid | Upward (P2 → P1) | "OK, I'll send your request" |

---

## Anomalous Behaviour Continued Time, Clocks, and the Ordering of Events in a Distributed System – p.24/32

- Let $ \mathcal{S} $ be the set of all events

be the set of system events
in
To avoid anomalous behaviour, one can either
ask the user to input a correct time-stamp

be the set of all events
happened before
have stronger clock guarantees

---

(now

$$
\mathcal{S}
$$

$$
a\underline{\longrightarrow}b
$$

$$
C\langle a\rangle<C\langle b\rangle
$$

in [Image: R261]
Time, Clocks, and the Ordering of Events in a Distributed System – p.25/32

$$
a\rightarrow b
$$

$$
\mathcal{S}
$$

$$
\mathcal{S}
$$

Let $ \mathcal{S} $ be the set of events in the real world

$$
\mathcal{S}
$$

For any events, in
then
This is stronger than before when we only had
happened before
be the set of events in the real world
One can construct physical clocks, running quite
independently, and having the Strong Clock
Condition, therefore eliminating anomalous

---

## Physical Clocks

## Assumptions:

and are approximatively synchronised
and verify the ordinary Clock Condition
Since they tend to drift away, we need to

$$
\forall i\exists\kappa
$$

$$
|\frac{d C_{i}(t)}{d t}-1|<\kappa
$$

approximatively at speed 1:
✠☛✡
✝✟✞

$$
\forall i,j:|C_{i}(t)-C_{j}(t)|<\varepsilon
$$

✎✍

Assumptions:
They run continuously
such that
re-synchronise them.

---

## Physical Clocks

[Image: R299] of
occur in 2
and
then occurs
Time, Clocks, and the Ordering of Events in a Distributed System – p.27/32

$$
\mathcal{P}
$$

We have to insure that the system
relevant physical events satisfies our Strong
For that we only need consider events
. So and
✁✄✂
in

$$
\mathcal{P}
$$

$$
a\not\to b
$$

Clock Condition
where
different processes
be a number such that if
and
.

$$
\mu
$$

$$
a\xrightarrow{}b
$$

$$
P_{i}
$$

$$
P_{j\neq i}
$$

$$
t+\mu
$$

---

## Physical Clocks

| Message (arrow) | Start point | End point | Label |
| --- | --- | --- | --- |
| Message 1 (top arrow) | P0 (top of axis) | P2 (top of axis) | — |
| Message 2 | P0 (top of axis) | P1 (top of axis) | — |
| Message 3 | P1 (top of axis) | P2 (top of axis) | — |
| Message 4 (bottom arrow) | P0 (bottom of axis) | P1 (top of axis) | — |
| Message 5 | P1 (bottom of axis) | P2 (top of axis) | — |
| Message 6 | P0 (bottom of axis) | P2 (top of axis) | Fastest message |
| Axis | Label |  |  |
| Vertical axis (left) | μ |  |  |
| Vertical axis (right) | Epsilon |  |  |
| Horizontal axis | P0 | P1 | P2 |

---

## Physical Clocks

Time, Clocks, and the Ordering of Events in a Distributed System – p.29/32

$$
\mu
$$

✄✆☎

$$
\mu
$$

is less than the shortest
Or else the time granularity of the physical
.
To avoid anomalous behaviour we need
, guaranteed if

$$
C_{i}(t+\mu)-C_{j}(t)>0
$$

$$
\begin{array}{l}\frac{\varepsilon}{1-\kappa}\leq\mu\end{array}
$$

---

Time, Clocks, and the Ordering of Events in a Distributed System – p.30/32

$$
\mu_{m}
$$

, it updates its clock via

$$
T_{m}
$$

$$
C_{i}(t)=\max C_{i}(t),T_{m}+\mu_{m}
$$

is the minimum delay of a message, and is
known by the processes (it is really needed?)
Only move clocks forward, and that only upon
reception of a message
When a process receives a message with
time-stamp
✎✍
This is the same as before, you move the
clock forward, and know the current time is at
least the time-stamp + the minimum delay of
receiving a message.

---

If there are enough messages with a sufficiently
small delivery delay, then there are good bounds
an upper bound on the minimum
second, a message with
is sent
[Image: R359]
Time, Clocks, and the Ordering of Events in a Distributed System – p.31/32

assuming

$$
\mu>\mu_{m}
$$

on the de-synchronisation of the clocks.
an unpredictable delay less than

$$
\exists\tau,\xi
$$

$$
\tau
$$

$$
\xi
$$

so that every
over every arc

$$
\varepsilon\approx d(2\kappa\tau+\xi)
$$

$$
\mu+\xi\ll\tau
$$

---

Time, Clocks, and the Ordering of Events in a Distributed System – p.32/32

“Happening before” only defines a partial
This partial ordering can be made total, but in
several arbitrary manner, and can lead to
anomalous behaviour because it is not
conform to the users perception
But the use of synchronised clocks can

overcome this problem