Source: https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html
Title: REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies - AWS Well-Architected Framework
Fetched: 2026-09-19T16:07:39.315Z

## Select your cookie preferences

We use essential cookies and similar tools that are necessary to provide our site and services. We use performance cookies to collect anonymous statistics, so we can understand how customers use our site and make improvements. Essential cookies cannot be deactivated, but you can choose “Customize” or “Decline” to decline performance cookies.

If you agree, AWS and approved third parties will also use cookies to provide useful site features, remember your preferences, and display relevant content, including relevant advertising. To accept or decline all non-essential cookies, choose “Accept” or “Decline.” To make more detailed choices, choose “Customize.”

AcceptDeclineCustomize

## Customize cookie preferences

We use cookies and similar tools (collectively, "cookies") for the following purposes.

### Essential

Essential cookies are necessary to provide our site and services and cannot be deactivated. They are usually set in response to your actions on the site, such as setting your privacy preferences, signing in, or filling in forms.

Allowed

### Performance

Performance cookies provide anonymous statistics about how customers navigate our site so we can improve site experience and performance. Approved third parties may perform analytics on our behalf, but they cannot use the data for their own purposes.

Allowed

### Functional

Functional cookies help us provide useful site features, remember your preferences, and display relevant content. Approved third parties may set these cookies to provide certain site features. If you do not allow these cookies, then some or all of these services may not function properly.

Allowed

### Advertising

Advertising cookies may be set through our site by us or our advertising partners and help us deliver relevant marketing content. If you do not allow these cookies, you will experience less relevant advertising.

Allowed

Blocking some types of cookies may impact your experience of our sites. You may review and change your choices at any time by selecting Cookie preferences in the footer of this site. We and selected third-parties use cookies or similar technologies as specified in the [AWS Cookie Notice](https://aws.amazon.com/legal/cookies/).

CancelSave preferences

## Your privacy choices

We and our advertising partners (“we”) may use information we collect from or about you to show you ads on other websites and online services. Under certain laws, this activity is referred to as “cross-context behavioral advertising” or “targeted advertising.”

To opt out of our use of cookies or similar technologies to engage in these activities, select “Opt out of cross-context behavioral ads” and “Save preferences” below. If you clear your browser cookies or visit this site from a different device or browser, you will need to make your selection again. For more information about cookies and how we use them, read our [Cookie Notice](https://aws.amazon.com/legal/cookies/).

Allow cross-context behavioral adsOpt out of cross-context behavioral ads

To opt out of the use of other identifiers, such as contact information, for these activities, fill out the form [here](https://pulse.aws/application/ZRPLWLL6?p=0).

For more information about how AWS handles your information, read the [AWS Privacy Notice](https://aws.amazon.com/privacy/).

CancelSave preferences

## Unable to save cookie preferences

We will only store essential cookies at this time, because we were unable to save your cookie preferences.

If you want to change your cookie preferences, try again later using the link in the AWS console footer, or contact support if the problem persists.

Dismiss

# REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies

[PDF](https://docs.aws.amazon.com/pdfs/wellarchitected/latest/framework/wellarchitected-framework.pdf#rel_mitigate_interaction_failure_graceful_degradation)

[RSS](https://docs.aws.amazon.com/wellarchitected/latest/framework/wellarchitected-framework.rss)

[Markdown](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.md "Download Markdown")

Agent SetupUp-to-date AWS docs, tested procedures, and IAM guardrails via a single setup prompt in your AI coding agent.

Focus mode

REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies - AWS Well-Architected Framework

[Open PDF](https://docs.aws.amazon.com/pdfs/wellarchitected/latest/framework/wellarchitected-framework.pdf#rel_mitigate_interaction_failure_graceful_degradation "Open PDF")

[Implementation guidance](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html#implementation-guidance) [Implementation steps](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html#implementation-steps) [Resources](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_graceful_degradation.html#resources)

Application components should continue to perform their core function even if dependencies become unavailable. They might be serving slightly stale data, alternate data, or even no data. This ensures overall system function is only minimally impeded by localized failures while delivering the central business value.

**Desired outcome:** When a component's dependencies are unhealthy, the component itself can still function, although in a degraded manner. Failure modes of components should be seen as normal operation. Workflows should be designed in such a way that such failures do not lead to complete failure or at least to predictable and recoverable states.


**Common anti-patterns:**

- Not identifying the core business functionality needed. Not testing that components are functional even during dependency failures.


- Serving no data on errors or when only one out of multiple dependencies is unavailable and partial results can still be returned.


- Creating an inconsistent state when a transaction partially fails.


- Not having an alternative way to access a central parameter store.


- Invalidating or emptying local state as a result of a failed refresh without considering the consequences of doing so.



**Benefits of establishing this best practice:** Graceful degradation improves the availability of the system as a whole and maintains the functionality of the most important functions even during failures.


**Level of risk exposed if this best practice**
**is not established:** High


## Implementation guidance

Implementing graceful degradation helps minimize the impact of dependency failures on component function. Ideally, a component detects dependency failures and works around them in a way that minimally impacts other components or customers.

Architecting for graceful degradation means considering potential failure modes during dependency design. For each failure mode, have a way to deliver most or at least the most critical functionality of the component to callers or customers. These considerations can become additional requirements that can be tested and verified. Ideally, a component is able to perform its core function in an acceptable manner even when one or multiple dependencies fail.


This is as much a business discussion as a technical one. All business requirements are important and should be fulfilled if possible. However, it still makes sense to ask what should happen when not all of them can be fulfilled. A system can be designed to be available and consistent, but under circumstances where one requirement must be dropped, which one is more important? For payment processing, it might be consistency. For a real-time application, it might be availability. For a customer facing website, the answer may depend on customer expectations.


What this means depends on the requirements of the component and what should be considered its core function. For example:


- An ecommerce website might display data from multiple different systems like personalized recommendations, highest ranked products, and status of customer orders on the landing page. When one upstream system fails, it still makes sense to display everything else instead of showing an error page to a customer.


- A component performing batch writes can still continue processing a batch if one of the individual operations fails. It should be simple to implement a retry mechanism. This can be done by returning information on which operations succeeded, which failed, and why they failed to the caller, or putting failed requests into a dead letter queue to implement asynchronous retries. Information about failed operations should be logged as well.


- A system that processes transactions must verify that either all or no individual updates are executed. For distributed transactions, the saga pattern can be used to roll back previous operations in case a later operation of the same transaction fails. Here, the core function is maintaining consistency.


- Time critical systems should be able to deal with dependencies not responding in a timely manner. In these cases, the circuit breaker pattern can be used. When responses from a dependency start timing out, the system can switch to a closed state where no additional call are made.


- An application may read parameters from a parameter store. It can be useful to create container images with a default set of parameters and use these in case the parameter store is unavailable.



Note that the pathways taken in case of component failure need to be tested and should be significantly simpler than the primary pathway. Generally, [fallback strategies should be avoided](https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems/).


## Implementation steps

Identify external and internal dependencies. Consider what kinds of failures can occur in them. Think about ways that minimize negative impact on upstream and downstream systems and customers during those failures.


The following is a list of dependencies and how to degrade gracefully when they fail:


1. **Partial failure of dependencies:** A component may make multiple requests to downstream systems, either as multiple requests to one system or one request to multiple systems each. Depending on the business context, different ways of handling for this may be appropriate (for more detail, see previous examples in Implementation guidance).


2. **A downstream system is unable to process requests due to high load:** If requests to a downstream system are consistently failing, it does not make sense to continue retrying. This may create additional load on an already overloaded system and make recovery more difficult. The circuit breaker pattern can be utilized here, which monitors failing calls to a downstream system. If a high number of calls are failing, it will stop sending more requests to the downstream system and only occasionally let calls through to test whether the downstream system is available again.


3. **A parameter store is unavailable:** To transform a parameter store, soft dependency caching or sane defaults included in container or machine images may be used. Note that these defaults need to be kept up-to-date and included in test suites.


4. **A monitoring service or other non-functional dependency is unavailable:** If a component is intermittently unable to send logs, metrics, or traces to a central monitoring service, it is often best to still execute business functions as usual. Silently not logging or pushing metrics for a long time is often not acceptable. Also, some use cases may require complete auditing entries to fulfill compliance requirements.


5. **A primary instance of a relational database may be unavailable:** Amazon Relational Database Service, like almost all relational databases, can only have one primary writer instance. This creates a single point of failure for write workloads and makes scaling more difficult. This can partially be mitigated by using a Multi-AZ configuration for high availability or Amazon Aurora Serverless for better scaling. For very high availability requirements, it can make sense to not rely on the primary writer at all. For queries that only read, read replicas can be used, which provide redundancy and the ability to scale out, not just up. Writes can be buffered, for example in an Amazon Simple Queue Service queue, so that write requests from customers can still be accepted even if the primary is temporarily unavailable.



## Resources

**Related documents:**

- [Amazon API Gateway: Throttle API Requests for Better\\
Throughput](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)

- [CircuitBreaker\\
(summarizes Circuit Breaker from “Release It!” book)](https://martinfowler.com/bliki/CircuitBreaker.html)

- [Error\\
Retries and Exponential Backoff in AWS](https://docs.aws.amazon.com/general/latest/gr/api-retries.html)

- [Michael\\
Nygard “Release It! Design and Deploy Production-Ready\\
Software”](https://pragprog.com/titles/mnee2/release-it-second-edition/)

- [The\\
Amazon Builders' Library: Avoiding fallback in distributed\\
systems](https://aws.amazon.com/builders-library/avoiding-fallback-in-distributed-systems)

- [The\\
Amazon Builders' Library: Avoiding insurmountable queue\\
backlogs](https://aws.amazon.com/builders-library/avoiding-insurmountable-queue-backlogs)

- [The\\
Amazon Builders' Library: Caching challenges and\\
strategies](https://aws.amazon.com/builders-library/caching-challenges-and-strategies/)

- [The\\
Amazon Builders' Library: Timeouts, retries, and backoff with\\
jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)


**Related videos:**

- [Retry,\\
backoff, and jitter: AWS re:Invent 2019: Introducing The\\
Amazon Builders’ Library (DOP328)](https://youtu.be/sKRdemSirDM?t=1884)


[Document Conventions](https://docs.aws.amazon.com/general/latest/gr/docconventions.html)

REL 5. How do you design interactions in a distributed system to mitigate or withstand failures?

REL05-BP02 Throttle requests

Did this page help you? - Yes

Thanks for letting us know we're doing a good job!

If you've got a moment, please tell us what we did right so we can do more of it.

Did this page help you? - No

Thanks for letting us know this page needs work. We're sorry we let you down.

If you've got a moment, please tell us how we can make the documentation better.

### View related pages

Abstracts generated by AI

- 1
- 2
- 3
- 4

Wellarchitected › reliability-pillar
[REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/similar/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Creliability-pillar%7Crel_mitigate_interaction_failure_graceful_degradation.html)](https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_mitigate_interaction_failure_graceful_degradation.html)
Learn best practices for implementing graceful degradation in AWS workloads, including cell-based architecture, fault isolation, and dependency management strategies.

_August 6, 2023_

Wellarchitected › framework
[REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/similar/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7C2025-02-25%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html)](https://docs.aws.amazon.com/wellarchitected/2025-02-25/framework/rel_mitigate_interaction_failure_graceful_degradation.html)
Learn best practices for implementing graceful degradation in AWS workloads, transforming hard dependencies into soft dependencies to maintain core functionality during failures.

_April 3, 2025_

Wellarchitected › framework
[REL05-BP01 Implement graceful degradation to transform applicable hard dependencies into soft dependencies![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/similar/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7C2023-10-03%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html)](https://docs.aws.amazon.com/wellarchitected/2023-10-03/framework/rel_mitigate_interaction_failure_graceful_degradation.html)
Learn best practices for implementing graceful degradation in AWS workloads to transform hard dependencies into soft dependencies and maintain core functionality during failures.

_October 4, 2023_

- ### On this page

- Recommended tasks






















### Learn about

















[Best practices for throttling requests in AWS workloads![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/journey/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_throttle_requests.html)](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_throttle_requests.html)



[Amazon EKS use cases for various applications![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/journey/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Ceks%7Clatest%7Cuserguide%7Ccommon-use-cases.html)](https://docs.aws.amazon.com/eks/latest/userguide/common-use-cases.html)



[Amazon API Gateway throttling mechanisms explained![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/journey/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Capigateway%7Clatest%7Cdeveloperguide%7Capi-gateway-request-throttling.html)](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)



[AWS Lambda execution environment lifecycle phases![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/journey/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Clambda%7Clatest%7Cdg%7Clambda-runtime-environment.html)](https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtime-environment.html)

























### How to

















[instrument build scripts with AWS X-Ray using Python![](https://prod.us-west-2.tcx-beacon.docs.aws.dev/recommendation-beacon/journey/impressions/null/72Xiyj3P96tVlxuzIzjdvIwier2vtUsCovALYFX3zZFytGw4iTjxVA==/https:%7C%7Cdocs.aws.amazon.com%7Cwellarchitected%7Clatest%7Cframework%7Crel_mitigate_interaction_failure_graceful_degradation.html/https:%7C%7Cdocs.aws.amazon.com%7Cxray%7Clatest%7Cdevguide%7Cscorekeep-scripts.html)](https://docs.aws.amazon.com/xray/latest/devguide/scorekeep-scripts.html)

- Did this page help you?








Yes



No













[Provide feedback](https://docs.aws.amazon.com/feedback/doc-feedback.html?feedback_destination_id=897c6ffe-3c12-4691-9c85-dc23b20eabd4&topic_url=https%3A%2F%2Fdocs.aws.amazon.com%2Fwellarchitected%2Flatest%2Fframework%2Frel_mitigate_interaction_failure_graceful_degradation.html)


#### Next topic:

[REL05-BP02 Throttle requests](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel_mitigate_interaction_failure_throttle_requests.html)

#### Previous topic:

[REL 5. How do you design interactions in a distributed system to mitigate or withstand failures?](https://docs.aws.amazon.com/wellarchitected/latest/framework/rel-05.html)