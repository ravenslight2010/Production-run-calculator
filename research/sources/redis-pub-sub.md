Source: https://redis.io/docs/latest/develop/use-cases/pub-sub
Title: Redis pub/sub messaging | Docs
Fetched: 2026-11-10T02:20:50.372Z

{"categories":\["docs","develop","stack","oss","rs","rc"\],"description":"Broadcast real-time events to many consumers with Redis pub/sub.","duplicateOf":"head:data-ai-metadata","location":"body","title":"Redis pub/sub messaging","tableOfContents":{"sections":\[{"id":"when-to-use-redis-pubsub","title":"When to use Redis pub/sub"},{"id":"why-the-problem-is-hard","title":"Why the problem is hard"},{"id":"what-you-can-expect-from-a-redis-solution","title":"What you can expect from a Redis solution"},{"id":"how-redis-supports-the-solution","title":"How Redis supports the solution"},{"id":"ecosystem","title":"Ecosystem"},{"id":"code-examples-to-build-your-own-redis-pubsub-broadcaster","title":"Code examples to build your own Redis pub/sub broadcaster"}\]},"codeExamples":\[\]}

# Redis pub/sub messaging

Broadcast real-time events to many consumers with Redis pub/sub.

## When to use Redis pub/sub  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#when-to-use-redis-pubsub "Copy link to clipboard")

Use Redis pub/sub when you need to broadcast real-time events — notifications, chat messages, cache invalidation signals, UI updates — from one or more producers to many consumers without tight coupling.

## Why the problem is hard  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#why-the-problem-is-hard "Copy link to clipboard")

Point-to-point communication between services creates tight coupling that becomes brittle as
the number of producers and consumers grows. Each new subscriber means another integration.
Some of the obvious workarounds have real drawbacks:

- **In-process event buses** don't work across instances or services — every new pod or worker
starts with an empty bus.
- **Full message brokers** (Kafka, RabbitMQ) add operational overhead and latency that's
overkill when you don't need message persistence, replay, or delivery guarantees.
- **Per-pair direct connections** (one publisher, one subscriber, hard-coded URLs) don't fan
out and don't survive instance churn — adding a fourth consumer means touching the producer.

A workable broadcast layer needs sub-millisecond fan-out, no per-subscriber configuration on
the publisher side, and a way to route events through named topics so subscribers can pick what
they care about without coordinating with publishers.

If you also need persistence, replay, or at-least-once delivery, the answer is
[Redis Streams](https://redis.io/docs/latest/develop/data-types/streams/), not pub/sub — the two solve
different problems on the same infrastructure.

## What you can expect from a Redis solution  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#what-you-can-expect-from-a-redis-solution "Copy link to clipboard")

You can:

- Fan out events across microservices, pods, or edge nodes without direct service-to-service
calls.
- Broadcast cache invalidation to all application instances simultaneously.
- Push real-time updates to WebSocket clients across multiple server nodes (the
[Socket.IO](https://socket.io/) Redis adapter pattern).
- Signal user presence, typing indicators, or live dashboard updates with sub-millisecond
latency.
- Subscribe to flexible topic hierarchies with glob patterns — a single `orders:*`
subscription captures all order events without per-channel wiring.
- Keep durable state in regular Redis keys or external systems and use pub/sub purely as the
transport.

## How Redis supports the solution  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#how-redis-supports-the-solution "Copy link to clipboard")

In practice, a publisher calls `PUBLISH channel payload` and Redis fans the message out to every
client currently subscribed to that channel, in the order the messages were published.
Subscribers register interest with `SUBSCRIBE channel` (exact-match) or `PSUBSCRIBE pattern`
(glob-match), and the connection then switches into a subscribe-only mode that pushes incoming
messages over the same socket. Delivery is at-most-once: a subscriber that's offline when the
message is published misses it for good.

Redis provides the following features that make it a good fit for broadcast messaging:

- [`PUBLISH`](https://redis.io/docs/latest/commands/publish/) for fan-out from any client to every active
subscriber of a channel, with a sub-millisecond hop through Redis.
- [`SUBSCRIBE`](https://redis.io/docs/latest/commands/subscribe/) and
[`UNSUBSCRIBE`](https://redis.io/docs/latest/commands/unsubscribe/) for exact-match channel
subscriptions, the simplest topic-based routing model.
- [`PSUBSCRIBE`](https://redis.io/docs/latest/commands/psubscribe/) and
[`PUNSUBSCRIBE`](https://redis.io/docs/latest/commands/punsubscribe/) for glob-style pattern
subscriptions (`cache:invalidate:*`, `news.*.headline`), so a subscriber can listen to whole
topic hierarchies without pre-registering every channel.
- [`PUBSUB CHANNELS`](https://redis.io/docs/latest/commands/pubsub-channels/),
[`PUBSUB NUMSUB`](https://redis.io/docs/latest/commands/pubsub-numsub/), and
[`PUBSUB NUMPAT`](https://redis.io/docs/latest/commands/pubsub-numpat/) for introspection — list active
channels, count subscribers per channel, count active pattern subscriptions.
- [Sharded pub/sub](https://redis.io/docs/latest/develop/pubsub/#sharded-pubsub)
( [`SSUBSCRIBE`](https://redis.io/docs/latest/commands/ssubscribe/),
[`SPUBLISH`](https://redis.io/docs/latest/commands/spublish/)) in Redis 7.0+ so the same pattern scales
horizontally on a Redis Cluster without every message touching every node.
- No message storage overhead — messages are delivered to active subscribers and discarded
immediately, keeping the messaging path stateless and fast.
- [Keyspace notifications](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/) for
receiving events about key changes (`SET`, expiration, eviction) through the same pub/sub
transport.

## Ecosystem  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#ecosystem "Copy link to clipboard")

The following frameworks and libraries use Redis pub/sub for broadcast messaging:

- **Node.js**: [Socket.IO](https://socket.io/) Redis adapter for cross-node WebSocket fan-out
- **Python**: [`redis-py`](https://redis.readthedocs.io/) subscribers with
[FastAPI](https://redis.io/docs/latest/integrate/fastapi/) or [Django Channels](https://channels.readthedocs.io/)
for WebSocket push and event listeners
- **Java**: [Spring Data Redis](https://spring.io/projects/spring-data-redis) message listener
containers for inter-service messaging
- **Ruby**: [Action Cable](https://guides.rubyonrails.org/action_cable_overview.html) Redis
adapter for Rails WebSocket broadcasting
- **Go**: [`go-redis`](https://github.com/redis/go-redis)`PubSub` for event listeners and
cluster-wide notifications
- **Infrastructure**: [Kong](https://konghq.com/) and [NGINX](https://www.nginx.com/) event
hooks; Kubernetes cluster-wide event bus via a shared Redis instance

## Code examples to build your own Redis pub/sub broadcaster  [Copy link to clipboard](https://redis.io/docs/latest/develop/use-cases/pub-sub/\#code-examples-to-build-your-own-redis-pubsub-broadcaster "Copy link to clipboard")

The following guides show how to build a simple Redis-backed pub/sub broadcaster.
Each guide includes a runnable interactive demo for each of the following client libraries:

- [redis-py (Python)](https://redis.io/docs/latest/develop/use-cases/pub-sub/redis-py/)
- [node-redis (Node.js)](https://redis.io/docs/latest/develop/use-cases/pub-sub/nodejs/)
- [go-redis (Go)](https://redis.io/docs/latest/develop/use-cases/pub-sub/go/)
- [Jedis (Java)](https://redis.io/docs/latest/develop/use-cases/pub-sub/java-jedis/)
- [Lettuce (Java)](https://redis.io/docs/latest/develop/use-cases/pub-sub/java-lettuce/)
- [StackExchange.Redis (C#)](https://redis.io/docs/latest/develop/use-cases/pub-sub/dotnet/)
- [Predis (PHP)](https://redis.io/docs/latest/develop/use-cases/pub-sub/php/)
- [redis-rb (Ruby)](https://redis.io/docs/latest/develop/use-cases/pub-sub/ruby/)
- [redis-rs (Rust)](https://redis.io/docs/latest/develop/use-cases/pub-sub/rust/)

RATE THIS PAGE

★★★★★

[Back to top ↑](https://redis.io/docs/latest/develop/use-cases/pub-sub/#page-top)

Submit


## On this page

Qualified