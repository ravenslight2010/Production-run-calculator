Source: https://docs.replit.com/references/publishing/autoscale-deployments
Title: Deployment types - Replit
Fetched: 2026-09-19T16:10:26.553Z

> ## Documentation Index
>
> Fetch the complete documentation index at: [/llms.txt](https://docs.replit.com/llms.txt)
>
> Use this file to discover all available pages before exploring further.

[Skip to main content](https://docs.replit.com/features/publishing/deployment-types#content-area)

The deployment type is the technology Replit uses to publish your app. You choose it in the Publishing tool under **Adjust settings**, in the **Deployment type** dropdown. **Autoscale** is the default and recommended choice, and most builders never need to change it.

## [​](https://docs.replit.com/features/publishing/deployment-types\#compare-deployment-types)  Compare deployment types

| Type | Best for | How it runs | How it bills |
| --- | --- | --- | --- |
| **Autoscale** | Web apps and APIs with variable traffic | Adds servers when busy, scales to zero when idle | You pay while requests are being served |
| **Static** | Landing pages, portfolios, documentation sites | Serves files from a cached cloud server, no backend | You pay only for the data your site serves |
| **Reserved VM** | Bots, background work, always-on APIs | One dedicated server that never sleeps | Fixed monthly cost |
| **Scheduled** | Periodic tasks like backups and notifications | Runs a command on a schedule, then stops | You pay for the duration of each run |

## [​](https://docs.replit.com/features/publishing/deployment-types\#autoscale)  Autoscale

Autoscale Deployments run on servers that scale up and down with your app’s traffic. When your app is busy, Replit adds servers to handle the load. When it’s idle, the count drops to as low as zero, so you don’t pay for quiet time.Ideal for:

- Web applications with variable traffic, such as ecommerce sites
- APIs and services

Configuration lives in **Adjust settings**: [machine power and the maximum number of servers](https://docs.replit.com/features/publishing/machine-configuration).

## [​](https://docs.replit.com/features/publishing/deployment-types\#static)  Static

Static Deployments host your app’s files, such as HTML, CSS, and JavaScript, on a cloud server that uses caching to deliver content quickly and economically. There is no backend server.Ideal for:

- Marketing landing pages
- Portfolio websites
- Product and API documentation sites

Static Deployments are not compatible with Replit Apps created using Agent. Agent builds full-stack apps that need a backend server, so use Autoscale or Reserved VM for those.

Configuration includes the public directory to serve and an optional build command. For response headers, URL rewrites, and redirects, see [advanced Static configuration](https://docs.replit.com/features/deployment-customization/static-deployments-advanced).

## [​](https://docs.replit.com/features/publishing/deployment-types\#reserved-vm)  Reserved VM

Reserved VM Deployments run your app on a dedicated virtual machine that never sleeps. You get consistent performance and a predictable, fixed monthly cost.Ideal for:

- Memory-intensive background tasks
- Chat bots that must stay connected
- Always-on API servers

Configuration includes [machine power](https://docs.replit.com/features/publishing/machine-configuration), build and run commands, port mappings, and whether the app runs as a web server or a background worker.

## [​](https://docs.replit.com/features/publishing/deployment-types\#scheduled)  Scheduled

Scheduled Deployments run a command on a schedule in your app’s environment, then stop until the next run. Enter a cron expression, such as `0 9 * * 1-5` for weekdays at 9am, and select a time zone. You get an alert if a run fails.Ideal for:

- Status checks and health reports
- Sending notifications
- Starting backups

Configuration includes the schedule, a job timeout, and build and run commands. Scheduled Deployments don’t serve a web page, so they have no public URL.

## [​](https://docs.replit.com/features/publishing/deployment-types\#next-steps)  Next steps

- [Publish your app](https://docs.replit.com/features/publishing/overview): Review the full publish flow.
- [Machine configuration](https://docs.replit.com/features/publishing/machine-configuration): Set the power and cost of your app’s servers.
- [Publishing costs](https://docs.replit.com/billing/deployment-pricing): View the costs associated with each deployment type.

Was this page helpful?

YesNo

Assistant

Responses are generated using AI and may contain mistakes.