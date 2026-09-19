Source: https://www.pgbouncer.org/usage.html
Title: PgBouncer command-line usage
Fetched: 2026-09-19T16:07:41.081Z

# pgbouncer

## Synopsis

```
pgbouncer [-d][-R][-v][-u user] <pgbouncer.ini>
pgbouncer -V|-h
```

On Windows, the options are:

```
pgbouncer.exe [-v][-u user] <pgbouncer.ini>
pgbouncer.exe -V|-h
```

Additional options for setting up a Windows service:

```
pgbouncer.exe --regservice   <pgbouncer.ini>
pgbouncer.exe --unregservice <pgbouncer.ini>
```

## Description

**pgbouncer** is a PostgreSQL connection pooler. Any target application
can be connected to **pgbouncer** as if it were a PostgreSQL server,
and **pgbouncer** will create a connection to the actual server, or it
will reuse one of its existing connections.

The aim of **pgbouncer** is to lower the performance impact of opening
new connections to PostgreSQL.

In order not to compromise transaction semantics for connection
pooling, **pgbouncer** supports several types of pooling when
rotating connections:

Session pooling

Most polite method. When a client connects, a server connection will
be assigned to it for the whole duration the client stays connected. When
the client disconnects, the server connection will be put back into the pool.
This is the default method.

Transaction pooling

A server connection is assigned to a client only during a transaction.
When PgBouncer notices that transaction is over, the server connection
will be put back into the pool.

Statement pooling

Most aggressive method. The server connection will be put back into the
pool immediately after a query completes. Multi-statement
transactions are disallowed in this mode as they would break.

The administration interface of **pgbouncer** consists of some new
`SHOW` commands available when connected to a special “virtual”
database **pgbouncer**.

## Quick-start

Basic setup and usage is as follows.

1. Create a pgbouncer.ini file. Details in **pgbouncer(5)**. Simple example:





```
    [databases]
    template1 = host=localhost port=5432 dbname=template1

    [pgbouncer]
    listen_port = 6432
    listen_addr = localhost
    auth_type = md5
    auth_file = userlist.txt
    logfile = pgbouncer.log
    pidfile = pgbouncer.pid
    admin_users = someuser
```

2. Create a `userlist.txt` file that contains the users allowed in:





```
    "someuser" "same_password_as_in_server"
```

3. Launch **pgbouncer**:





```
    $ pgbouncer -d pgbouncer.ini
```

4. Have your application (or the **psql** client) connect to
**pgbouncer** instead of directly to the PostgreSQL server:





```
    $ psql -p 6432 -U someuser template1
```

5. Manage **pgbouncer** by connecting to the special administration
database **pgbouncer** and issuing `SHOW HELP;` to begin:





```
    $ psql -p 6432 -U someuser pgbouncer
    pgbouncer=# SHOW HELP;
    NOTICE:  Console usage
    DETAIL:
      SHOW [HELP|CONFIG|DATABASES|FDS|POOLS|CLIENTS|SERVERS|SOCKETS|LISTS|VERSION|...]
      SET key = arg
      RELOAD
      PAUSE
      SUSPEND
      RESUME
      SHUTDOWN
      [...]
```

6. If you made changes to the pgbouncer.ini file, you can reload it with:





```
    pgbouncer=# RELOAD;
```


## Command line switches

`-d`, `--daemon`Run in the background. Without it, the process will run in the foreground.



In daemon mode, setting `pidfile` as well as `logfile` or `syslog`
is required. No log messages will be written to stderr after
going into the background.

Note: Does not work on Windows; **pgbouncer** need to run as service there.

`-R`, `--reboot`**DEPRECATED: Instead of this option use a rolling restart with multiple**
**pgbouncer processes listening on the same port using so\_reuseport instead**
Do an online restart. That means connecting to the running process,
loading the open sockets from it, and then using them. If there
is no active process, boot normally.
Note: Works only if OS supports Unix sockets and the `unix_socket_dir`
is not disabled in configuration. Does not work on Windows.
Does not work with TLS connections, they are dropped.`-u` _USERNAME_, `--user=` _USERNAME_Switch to the given user on startup.`-v`, `--verbose`Increase verbosity. Can be used multiple times.`-q`, `--quiet`Be quiet: do not log to stderr. This does not affect
logging verbosity, only that stderr is not to be used.
For use in init.d scripts.`-V`, `--version`Show version.`-h`, `--help`Show short help.`--regservice`Win32: Register PgBouncer to run as Windows service. The **service\_name**
configuration parameter value is used as the name to register under.`--unregservice`Win32: Unregister Windows service.

## Admin console

The console is available by connecting as normal to the
database **pgbouncer**:

```
$ psql -p 6432 pgbouncer
```

Only users listed in the configuration parameters **admin\_users** or **stats\_users**
are allowed to log in to the console. (Except when `auth_type=any`, then
any user is allowed in as a stats\_user.)

Additionally, the user name **pgbouncer** is allowed to log in without password,
if the login comes via the Unix socket and the client has same Unix user UID
as the running process.

The admin console currently only supports the simple query protocol.
Some drivers use the extended query protocol for all commands; these
drivers will not work for this.

### Show commands

The **SHOW** commands output information. Each command is described below.

#### SHOW STATS

Shows statistics. In this and related commands, the total figures are
since process start, the averages are updated every `stats_period`.

databaseStatistics are presented per database.total\_xact\_countTotal number of SQL transactions pooled by **pgbouncer**.total\_query\_countTotal number of SQL commands pooled by **pgbouncer**.total\_server\_assignment\_countTotal times a server was assigned to a clienttotal\_receivedTotal volume in bytes of network traffic received by **pgbouncer**.total\_sentTotal volume in bytes of network traffic sent by **pgbouncer**.total\_xact\_timeTotal number of microseconds spent by **pgbouncer** when connected
to PostgreSQL in a transaction, either idle in transaction or
executing queries.total\_query\_timeTotal number of microseconds spent by **pgbouncer** when actively
connected to PostgreSQL, executing queries.total\_wait\_timeTime spent by clients waiting for a server, in microseconds. Updated
when a client connection is assigned a backend connection.total\_client\_parse\_countTotal number of prepared statements created by clients. Only applicable
in named prepared statement tracking mode, see `max_prepared_statements`.total\_server\_parse\_countTotal number of prepared statements created by **pgbouncer** on a server. Only
applicable in named prepared statement tracking mode, see `max_prepared_statements`.total\_bind\_countTotal number of prepared statements readied for execution by clients and forwarded
to PostgreSQL by **pgbouncer**. Only applicable in named prepared statement tracking
mode, see `max_prepared_statements`.avg\_xact\_countAverage transactions per second in last stat period.avg\_query\_countAverage queries per second in last stat period.avg\_server\_assignment\_countAverage number of times a server as assigned to a client per second in the
last stat period.avg\_recvAverage received (from clients) bytes per second.avg\_sentAverage sent (to clients) bytes per second.avg\_xact\_timeAverage transaction duration, in microseconds.avg\_query\_timeAverage query duration, in microseconds.avg\_wait\_timeTime spent by clients waiting for a server, in microseconds (average
of the wait times for clients assigned a backend during the current
`stats_period`).avg\_client\_parse\_countAverage number of prepared statements created by clients. Only applicable
in named prepared statement tracking mode, see `max_prepared_statements`.avg\_server\_parse\_countAverage number of prepared statements created by **pgbouncer** on a server. Only
applicable in named prepared statement tracking mode, see `max_prepared_statements`.avg\_bind\_countAverage number of prepared statements readied for execution by clients and forwarded
to PostgreSQL by **pgbouncer**. Only applicable in named prepared statement tracking
mode, see `max_prepared_statements`.

#### SHOW STATS\_TOTALS

Subset of **SHOW STATS** showing the total values ( **total\_**).

#### SHOW STATS\_AVERAGES

Subset of **SHOW STATS** showing the average values ( **avg\_**).

#### SHOW TOTALS

Like **SHOW STATS** but aggregated across all databases.

#### SHOW SERVERS

typeS, for server.userUser name **pgbouncer** uses to connect to server.databaseDatabase name.replicationIf server connection uses replication. Can be **none**, **logical** or **physical**.stateState of the PgBouncer server connection, one of **active**,
**idle**, **used**, **tested**, **new**, **active\_cancel**,
**being\_canceled**.addrIP address of PostgreSQL server.portPort of PostgreSQL server.local\_addrConnection start address on local machine.local\_portConnection start port on local machine.connect\_timeWhen the connection was made.request\_timeWhen last request was issued.waitNot used for server connections.wait\_usNot used for server connections.close\_needed1 if the connection will be closed as soon as possible,
because a configuration file reload or DNS update changed the
connection information or **RECONNECT** was issued.ptrAddress of internal object for this connection.linkAddress of client connection the server is paired with.remote\_pidPID of backend server process. In case connection is made over
Unix socket and OS supports getting process ID info, its
OS PID. Otherwise it’s extracted from cancel packet the server sent,
which should be the PID in case the server is PostgreSQL, but it’s a random
number in case the server it is another PgBouncer.tlsA string with TLS connection information, or empty if not using TLS.application\_nameA string containing the `application_name` set on the linked client connection,
or empty if this is not set, or if there is no linked connection.prepared\_statementsThe amount of prepared statements that are prepared on the server. This
number is limited by the `max_prepared_statements` setting.idUnique ID for server.

#### SHOW CLIENTS

typeC, for client.userClient connected user.databaseDatabase name.replicationIf client connection uses replication. Can be **none**, **logical** or **physical**.stateState of the client connection, one of **active** (Client connections that are linked to server connections),
**idle** (Client connections with no queries waiting to be processed), **waiting**,
**active\_cancel\_req**, or **waiting\_cancel\_req**.addrIP address of client.portSource port of client.local\_addrConnection end address on local machine.local\_portConnection end port on local machine.connect\_timeTimestamp of connect time.request\_timeTimestamp of latest client request.waitCurrent waiting time in seconds.wait\_usMicrosecond part of the current waiting time.close\_needednot used for clientsptrAddress of internal object for this connection.linkAddress of server connection the client is paired with.remote\_pidProcess ID, in case client connects over Unix socket
and OS supports getting it.tlsA string with TLS connection information, or empty if not using TLS.application\_nameA string containing the `application_name` set by the client
for this connection, or empty if this was not set.prepared\_statementsThe amount of prepared statements that the client has preparedidUnique ID for client.

#### SHOW POOLS

A new pool entry is made for each couple of (database, user).

databaseDatabase name.userUser name.cl\_activeClient connections that are either linked to server connections or are idle with no queries waiting to be processed.cl\_waitingClient connections that have sent queries but have not yet got a server connection.cl\_active\_cancel\_reqClient connections that have forwarded query cancellations to the server and
are waiting for the server response.cl\_waiting\_cancel\_reqClient connections that have not forwarded query cancellations to the server yet.sv\_activeServer connections that are linked to a client.sv\_active\_cancelServer connections that are currently forwarding a cancel request.sv\_being\_canceledServers that normally could become idle but are waiting to do so until
all in-flight cancel requests have completed that were sent to cancel
a query on this server.sv\_idleServer connections that are unused and immediately usable for client queries.sv\_usedServer connections that have been idle for more than `server_check_delay`,
so they need `server_check_query` to run on them before they can be used again.sv\_testedServer connections that are currently running either `server_reset_query`
or `server_check_query`.sv\_loginServer connections currently in the process of logging in.maxwaitHow long the first (oldest) client in the queue has waited, in seconds.
If this starts increasing, then the current pool of servers does
not handle requests quickly enough. The reason may be either an overloaded
server or just too small of a **pool\_size** setting.maxwait\_usMicrosecond part of the maximum waiting time.pool\_modeThe pooling mode in use.load\_balance\_hostsThe load\_balance\_hosts in use if the pool’s host contains a comma-separated list.

#### SHOW PEER\_POOLS

A new peer\_pool entry is made for each configured peer.

databaseID of the configured peer entry.cl\_active\_cancel\_reqClient connections that have forwarded query cancellations to the server and
are waiting for the server response.cl\_waiting\_cancel\_reqClient connections that have not forwarded query cancellations to the server yet.sv\_active\_cancelServer connections that are currently forwarding a cancel request.sv\_loginServer connections currently in the process of logging in.

#### SHOW LISTS

Show following internal information, in columns (not rows):

databasesCount of databases.usersCount of users.poolsCount of pools.free\_clientsCount of free clients. These are clients that are disconnected, but
PgBouncer keeps the memory around that was allocated for them so it can be
reused for a future clients to avoid allocations.used\_clientsCount of used clients.login\_clientsCount of clients in **login** state.free\_serversCount of free servers. These are servers that are disconnected, but
PgBouncer keeps the memory around that was allocated for them so it can be
reused for a future servers to avoid allocations.used\_serversCount of used servers.dns\_namesCount of DNS names in the cache.dns\_zonesCount of DNS zones in the cache.dns\_queriesCount of in-flight DNS queries.dns\_pendingnot used

#### SHOW USERS

nameThe user namepool\_sizeThe user’s override pool\_size. or NULL if not set.reserve\_pool\_sizeThe user’s override reserve\_pool\_size. or NULL if not set.pool\_modeThe user’s override pool\_mode, or NULL if not set.max\_user\_connectionsThe user’s max\_user\_connections setting. If this setting is not set
for this specific user, then the default value will be displayed.current\_connectionsCurrent number of server connections that this user has open to all servers.max\_user\_client\_connectionsThe user’s max\_user\_client\_connections setting. If this setting is not set
for this specific user, then the default value will be displayed.current\_client\_connectionsCurrent number of client connections that this user has open to PgBouncer.

#### SHOW DATABASES

nameName of configured database entry.hostHost PgBouncer connects to.portPort PgBouncer connects to.databaseActual database name PgBouncer connects to.force\_userWhen the user is part of the connection string, the connection between
PgBouncer and PostgreSQL is forced to the given user, whatever the
client user.pool\_sizeMaximum number of server connections.min\_pool\_sizeMinimum number of server connections.reserve\_pool\_sizeMaximum number of additional connections for this database.server\_lifetimeThe maximum lifetime of a server connection for this databasepool\_modeThe database’s override pool\_mode, or NULL if the default will be used instead.load\_balance\_hostsThe database’s load\_balance\_hosts if the host contains a comma-separated list.max\_connectionsMaximum number of allowed server connections for this database, as set by
**max\_db\_connections**, either globally or per database.current\_connectionsCurrent number of server connections for this database.max\_client\_connectionsMaximum number of allowed client connections for this PgBouncer instance, as set by max\_db\_client\_connections per database.current\_client\_connectionsCurrent number of client connections for this database.paused1 if this database is currently paused, else 0.disabled1 if this database is currently disabled, else 0.

#### SHOW PEERS

peer\_idID of the configured peer entry.hostHost PgBouncer connects to.portPort PgBouncer connects to.pool\_sizeMaximum number of server connections that can be made to this peer

#### SHOW FDS

Internal command - shows list of file descriptors in use with internal state attached to them.

When the connected user has the user name “pgbouncer”, connects through the Unix socket
and has same the UID as the running process, the actual FDs are passed over the connection.
This mechanism is used to do an online restart.
Note: This does not work on Windows.

This command also blocks the internal event loop, so it should not be used
while PgBouncer is in use.

fdFile descriptor numeric value.taskOne of **pooler**, **client** or **server**.userUser of the connection using the FD.databaseDatabase of the connection using the FD.addrIP address of the connection using the FD, **unix** if a Unix socket
is used.portPort used by the connection using the FD.cancelCancel key for this connection.linkfd for corresponding server/client. NULL if idle.

#### SHOW SOCKETS, SHOW ACTIVE\_SOCKETS

Shows low-level information about sockets or only active sockets.
This includes the information shown under **SHOW CLIENTS** and **SHOW**
**SERVERS** as well as other more low-level information.

#### SHOW CONFIG

Show the current configuration settings, one per row, with the following
columns:

keyConfiguration variable namevalueConfiguration valuedefaultConfiguration default valuechangeableEither **yes** or **no**, shows if the variable can be changed while running.
If **no**, the variable can be changed only at boot time. Use
**SET** to change a variable at run time.

#### SHOW MEM

Shows low-level information about the current sizes of various
internal memory allocations. The information presented is subject to
change.

#### SHOW DNS\_HOSTS

Show host names in DNS cache.

hostnameHost name.ttlHow many seconds until next lookup.addrsComma separated list of addresses.

#### SHOW DNS\_ZONES

Show DNS zones in cache.

zonenameZone name.serialCurrent serial.countHost names belonging to this zone.

#### SHOW VERSION

Show the PgBouncer version string.

#### SHOW STATE

Show the PgBouncer state settings. Current states are active, paused and suspended.

### Process controlling commands

#### PAUSE \[db\]

PgBouncer tries to disconnect from all servers. Disconnecting each server connection
waits for that server connection to be released according to the server pool’s pooling
mode (in transaction pooling mode, the transaction must complete, in statement mode,
the statement must complete, and in session pooling mode the client must disconnect).
The command will not return before all server connections have been disconnected.
To be used at the time of database restart.

If database name is given, only that database will be paused.

New client connections to a paused database will wait until **RESUME**
is called.

#### DISABLE db

Reject all new client connections on the given database.

#### ENABLE db

Allow new client connections after a previous **DISABLE** command.

#### RECONNECT \[db\]

Close each open server connection for the given database, or all
databases, after it is released (according to the pooling mode), even
if its lifetime is not up yet. New server connections can be made
immediately and will connect as necessary according to the pool size
settings.

This command is useful when the server connection setup has changed,
for example to perform a gradual switchover to a new server. It is
_not_ necessary to run this command when the connection string in
pgbouncer.ini has been changed and reloaded (see **RELOAD**) or when
DNS resolution has changed, because then the equivalent of this
command will be run automatically. This command is only necessary if
something downstream of PgBouncer routes the connections.

After this command is run, there could be an extended period where
some server connections go to an old destination and some server
connections go to a new destination. This is likely only sensible
when switching read-only traffic between read-only replicas, or when
switching between nodes of a multimaster replication setup. If all
connections need to be switched at the same time, **PAUSE** is
recommended instead. To close server connections without waiting (for
example, in emergency failover rather than gradual switchover
scenarios), also consider **KILL**.

#### KILL \[db\]

Immediately drop all client and server connections on the given database or all
databases, excluding the admin database.

New client connections to a killed database will wait until **RESUME**
is called.

#### KILL\_CLIENT id

Immediately kill specified client connection along with any server
connections for the given client. The client to kill, is identified
by the `id` value that can be found using the `SHOW CLIENTS` command.

An example command will look something like `KILL_CLIENT 1234`.

#### SUSPEND

All socket buffers are flushed and PgBouncer stops listening for data on them.
The command will not return before all buffers are empty. To be used at the time
of PgBouncer online reboot.

New client connections to a suspended database will wait until
**RESUME** is called.

#### RESUME \[db\]

Resume work from previous **KILL**, **PAUSE**, or **SUSPEND** command.

#### SHUTDOWN

The PgBouncer process will exit.

#### SHUTDOWN WAIT\_FOR\_SERVERS

Stop accepting new connections and shutdown after all servers are released.
This is basically the same as issuing **PAUSE** and **SHUTDOWN**, except that
this also stops accepting new connections while waiting for the **PAUSE** as
well as eagerly disconnecting clients that are waiting to receive a server
connection. Please note that UNIX sockets will remain open during the shutdown
but will only accept connections to the PgBouncer admin console.

#### SHUTDOWN WAIT\_FOR\_CLIENTS

Stop accepting new connections and shutdown the process once all existing
clients have disconnected. Please note that UNIX sockets will remain open
during the shutdown but will only accept connections to the pgbouncer
admin console. This command can be used to do zero-downtime rolling
restart of two PgBouncer processes using the following procedure:

1. Have two or more PgBouncer processes running on the same port using
`so_reuseport` ( [configuring peering](https://www.pgbouncer.org/config.html#section-peers) is
recommended, but not required). To achieve zero downtime when
restarting we’ll restart these processes one-by-one, thus leaving the
others running to accept connections while one is being restarted.
2. Pick a process to restart first, let’s call it A.
3. Run `SHUTDOWN WAIT_FOR_CLIENTS` (or send `SIGTERM`) to process A.
4. Cause all clients to reconnect. Possibly by waiting some time until the
client side pooler causes reconnects due to its `server_idle_timeout`
(or similar config). Or if no client side pooler is used, possibly by
restarting the clients. Once all clients have reconnected. Process A
will exit automatically, because no clients are connected to it anymore.
5. Start process A again.
6. Repeat step 3, 4 and 5 for each of the remaining processes, one-by-one
until you restarted all processes.

#### RELOAD

The PgBouncer process will reload its configuration files and update
changeable settings. This includes the main configuration file as
well as the files specified by the settings `auth_file` and
`auth_hba_file`.

PgBouncer notices when a configuration file reload changes the
connection parameters of a database definition. An existing server
connection to the old destination will be closed when the server
connection is next released (according to the pooling mode), and new
server connections will immediately use the updated connection
parameters.

#### WAIT\_CLOSE \[db\]

Wait until all server connections, either of the specified database or
of all databases, have cleared the “close\_needed” state (see **SHOW**
**SERVERS**). This can be called after a **RECONNECT** or **RELOAD** to
wait until the respective configuration change has been fully
activated, for example in switchover scripts.

### Other commands

#### SET key = arg

Changes a configuration setting (see also **SHOW CONFIG**). For example:

```
SET log_connections = 1;
SET server_check_query = 'select 2';
```

(Note that this command is run on the PgBouncer admin console and sets
PgBouncer settings. A **SET** command run on another database will be
passed to the PostgreSQL backend like any other SQL command.)

### Signals

SIGHUPReload config. Same as issuing the command **RELOAD** on the console.SIGTERMSuper safe shutdown. Wait for all existing clients to disconnect, but don’t
accept new connections. This is the same as issuing
**SHUTDOWN WAIT\_FOR\_CLIENTS** on the console. If this signal is received while
there is already a shutdown in progress, then an “immediate shutdown” is
triggered instead of a “super safe shutdown”. In PgBouncer versions earlier
than 1.23.0, this signal would cause an “immediate shutdown”.SIGINTSafe shutdown. Same as issuing **SHUTDOWN WAIT\_FOR\_SERVERS** on the console.
If this signal is received while there is already a shutdown in progress,
then an “immediate shutdown” is triggered instead of a “safe shutdown”.SIGQUITImmediate shutdown. Same as issuing **SHUTDOWN** on the console.SIGUSR1Same as issuing **PAUSE** on the console.SIGUSR2Same as issuing **RESUME** on the console.

### Libevent settings

From the Libevent documentation:

> It is possible to disable support for epoll, kqueue, devpoll, poll
> or select by setting the environment variable EVENT\_NOEPOLL,
> EVENT\_NOKQUEUE, EVENT\_NODEVPOLL, EVENT\_NOPOLL or EVENT\_NOSELECT,
> respectively.
>
> By setting the environment variable EVENT\_SHOW\_METHOD, libevent
> displays the kernel notification method that it uses.

## See also

pgbouncer(5) - man page of configuration settings descriptions

[https://www.pgbouncer.org/](https://www.pgbouncer.org/)