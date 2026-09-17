# workspaceAlberta Harness

<p align="center">
  <img src="docs/assets/women-workers-collage.png" alt="Eight photographs of Canadian women building war industries: welding, machining, drafting, and finishing munitions, 1940-1945." width="100%">
</p>

<p align="center"><em>Canadian industrial war production, via Library and Archives Canada.</em></p>

A custom, CEO-focused, enterprise-grade AI terminal for building and delivering real work. Workspace Alberta is a Warre & Vavasour product. The operator CLI is `wa`; packages ship under `@workspacealberta`. Launch instructions live in [WORKSPACE_ALBERTA.md](WORKSPACE_ALBERTA.md). Inherited MIT source and notices are recorded in [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## A place for “Wouldn't it be great if…”

Connect a supplier account and retrieve tender documents through the Cohere harness with the [local APC connector](integrations/apc/README.md).

Wouldn't it be great if the idea you've been carrying around for years had a place to become real?

That's what we're building. A physical workspace for the CEO, installed and supported by Warre & Vavasour. Keep running your business. Sit down with the thing you want to build, or the small thing you have always wished worked better. We'll work through it with you, connect the tools, and help carry it through to something your business can actually use.

Think of the **family doctor model of AI support**: someone who gets to know your business, remembers what you've tried, helps get an idea or a long-neglected paper cut moving, and brings in the right specialist tools. We look after the moving parts. You bring the “Wouldn't it be great if…” ideas.

It starts with the MCP: find real public work through CanadaBuys and Alberta Purchasing Connection. Then build on that first connection. A new product. A new service. A new line of business your people could deliver if the tools were finally there. We scope the work and the connections with you, and follow through.

**The terminal is $4,800 CAD per month**: a leased physical workspace, installation and onboarding, ongoing support, updates, and help building agreed workflows. This is a place and a working relationship for turning ambition into new business.

### Your projects. Your Pi. Help close at hand.

WorkspaceAlberta is a network of devices connected for support over Tailscale. Each locally deployed Pi runs the workspaceAlberta harness, where your ideas and the little things you wish worked better become projects. You get to think out loud, try things and keep going without an engineer sitting in on every thought.

I work as the generalist: I know the business and its toolkit, and I show up when something needs attention. My practice is a small flock of about 20 distributed devices among trusted businesses. I think this is a new layer of work: helping businesses deploy, maintain and actually use AI tooling.

I stay connected to that workspace. When you get stuck, I come in and build with you on your device. WorkspaceAlberta keeps the plates spinning locally; I help with the bits that need an engineer. The Pi is a toolkit for a forward-deployed engineer, right where the work is happening.

Bring the small things too. The fiddly document you always wished you had. The awkward step nobody has had time to fix. The idea you never started. You don't need a polished pitch or a revenue case for every request. We build quickly, try it, iterate quickly and move on when something doesn't work. The 25% new-revenue arrangement belongs to the separate million-dollar challenge, not every project in your workspace.

Support access is configured with the company. Tailscale connects the devices; it does not make every device visible to every customer, guarantee a response time, or make cloud tools local. Access, availability and data handling are agreed during setup.

### One company. One million-dollar problem. Sixty days.

We're offering **one installed and supported terminal** to one selected Canadian company with a million-dollar problem worth solving. Any Canadian company can put an idea forward.

**We have 60 days to find, fix, and deliver a solution. If we can't, we both walk away.** The selected company pays no monthly terminal fee during those 60 days. The deal we're asking for is **25% of the attributable new revenue actually earned from the solution**, agreed in writing before we start. New money, new business, new products. The share is never calculated on savings, existing revenue or a projection.

We don't cut corners. We don't cut people. We build. This is an investment in doing more. There is room here for the big ambition and the little things you have never had time to fix.

The proof will be economic activity: a delivered solution, new work, paid invoices, Canadian dollars earned. You account for your income. We account for ours. We each meet our applicable tax obligations. If we can build something valuable together, let's earn our part of it.

[Bring us your idea](mailto:hello@warreandvavasour.com?subject=Our%20million-dollar%20problem). The [offer and delivery terms](https://github.com/HarleyCoops/WorkspaceAlberta/blob/main/docs/terminal-offer.md) spell out the 60-day boundary and what we agree before starting, including how new revenue is attributed and how long the share runs.

If we cannot deliver within the agreed period, no terminal fee or success fee is due. The million-dollar problem is an ambition, not a revenue guarantee.

### The work teaches us what to build next

I'm also experimenting with the traces from the workspaceAlberta harness: what we tried, where a tool failed, what a person corrected, and what finally worked. That evidence can improve the harness, the connections and the tools. Further reinforcement-learning training is a research direction, with a separate permission and evaluation process. Customer sessions do not automatically become training data.

Cohere's model family is part of the Canadian provenance of this work. We want to build Canadian capability and help Canadian companies earn Canadian dollars. Model origin and where data is processed are separate facts, and we make the route clear for each deployment.

The conviction behind the work is simple: **AGI is here. Let's build everything.**

## Three repositories, one working relationship

- [WorkspaceAlberta](https://github.com/HarleyCoops/WorkspaceAlberta): the procurement MCP connection and shared tools.
- [workspaceAlbertaSetup](https://github.com/HarleyCoops/workspaceAlbertaSetup): installation, the physical workspace and support runbooks.
- [workspacealberta-harness](https://github.com/HarleyCoops/workspacealberta-harness): the working session, tool execution, artifacts and reviewed refinements.

The CEO brings the idea. Setup makes a place for it. The MCP connects it to real work. The harness helps carry it through. Warre & Vavasour stays alongside the business.

## What workspaceAlberta is

workspaceAlberta is two things working as one.

**A service that details industrial work available today through [CanadaBuys](https://canadabuys.canada.ca)** — delivered straight into the terminal through the workspaceAlberta MCP server, so the opportunities and the machine that acts on them are the same surface.

**A terminal that builds.** This is a tool for work: it writes code, files, and documents. It is not chatting with you. It is not your friend. Get up and get to work.

## Better procurement work through reviewed corrections

**Two files, two clocks.** The [procurement skill](.agents/skills/wa-procurement-base/SKILL.md) starts fresh for each task, checks CanadaBuys and Alberta Purchasing Connection evidence, and produces a short bid brief. The [improver skill](.agents/skills/wa-procurement-improver/SKILL.md) runs separately, checks human feedback, and proposes at most one small procedural change through a PR. A human decides whether to merge it.

- **Evidence before fit.** Verify mandatory qualifications, bonding, insurance, deadlines, and amendments. Unknown requirements mean uncertain fit; a confirmed mismatch means low fit.
- **Procedure survives sessions.** Reviewed skills and their resources live in git. Customer details and temporary feedback summaries do not become global instructions.
- **Review stays visible.** Each proposed edit includes its evidence, a corrected example, a counterexample, checks, and rollback. No automatic merge or direct target-branch write is permitted by the improver procedure; restricted credentials enforce that policy.
- **Measure useful work.** Track time to a useful brief, human label corrections, and fabricated deadlines or IDs (target zero). Improvement is measured, not promised by a daily schedule.

The skills use the existing harness discovery mechanism. [Deployment and the two clocks](WORKSPACE_ALBERTA.md#procurement-two-files-two-clocks) explain task invocation, the weekday maintenance job, credentials, and updating terminal checkouts. Scheduling and fleet rollout are separate from publishing the files.

## The principle

We want to know every "wouldn't it be great if" idea you have about your business — and we build them, with you, like a family doctor. The AI lab behind workspaceAlberta, **Warre & Vavasour**, manages all the spinning plates to keep the tools running, so the CEO works only on executing new ideas in the workspace.

We do not build apps. We do not replace employees. What this device can do will shock you — so give us your best ideas and let's build a growing pie instead of thinking about reducing people. We amplify what is already working.

## Canadian to the metal

workspaceAlberta is building Canadian capability, with the processing route made explicit:

- **Canadian LLM, only.** The default model route is Cohere — a Canadian company — with no other model provider in the deployment. The deployment selects Cohere; confirm model endpoints and processing locations for each customer.
- **Canadian cloud deployment.** The workspaceAlberta service layer is deployed on Canadian cloud infrastructure.
- **European hardware, removable Canadian data.** The terminal is a Raspberry Pi 5, manufactured in Europe, fitted with **Swissbit industrial SSD storage mounted on the bottom of the device — so your corporate files are physically resident on a drive you can remove and hold in your hand.** Local storage can be removed physically; authorized cloud model and tool calls also transmit data beyond the device.
- **The last mile: Canadian sandboxes.** Isolated execution currently depends on a non-Canadian sandbox provider; we are actively evaluating Canadian alternatives for the e2b sandbox role. When your workloads need it, that gap closes too.

## AI Ethics

**Warre & Vavasour does not replace human workers. We build a bigger pie for you.** Every capability we ship exists to amplify the people already doing the work — the same promise the photographs above made to the generation that industrialized this country. If a savings plan starts with headcount, it is not a workspaceAlberta plan.

**Warre & Vavasour does not make apps or chatbots. Don't ask.** If this is in your business plan, you are thinking about New Business wrong. We build terminals that deliver real work — code, files, documents — not conversation widgets.

**Warre & Vavasour acknowledges the astonishing resources this technology is consuming.** Training and inference carry real energy, water, and mineral costs — and nobody asked for this. No one really asked for GRPO to be released on January 20. But it was released, and that is how all models got to reasoning; and from reasoning, we have harnesses now. This is just the way the world is — and it is far too cheap not to deploy post-human-scale reasoning tools on a desktop device that genuinely accelerates ideas to revenue.

So yes: we acknowledge the cost, we say it out loud instead of hiding it, and our answer stays Canadian infrastructure, right-sized models on hardware you own, and local data retention over redundant cloud sprawl. Because it is 1834, and the railroad has been built. The tracks arrive Tuesday. The world as we know it is all changing. workspaceAlberta is the way to stay ahead of these changes.

## Architecture and docs

Workspace Alberta is a plugin runtime powered by [Cordis](https://github.com/cordiverse/cordis). Every capability is a package under `@workspacealberta`.

- Docs: [development guide](docs/development.md), [architecture](docs/architecture.md), [Web UI guide](docs/user/guide/index.md) ([中文](README.zh.md))

## Run

Use the [Workspace Alberta deployment instructions](WORKSPACE_ALBERTA.md) for the configured model and procurement connection.

### Run from source

Install dependencies with `pnpm install`, then follow the build and launch commands in the deployment instructions. See the [development guide](docs/development.md) for contributor workflows.

## License

[MIT](LICENSE). Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
