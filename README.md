# Queue Details — WxCC Desktop Header Widget

A Webex Contact Center (WxCC) Agent Desktop widget that shows a live ticker of the queues an agent can take contacts from. For each queue it shows how many contacts are waiting and how long the oldest one has waited. It sits in the desktop header, so agents can see queue pressure without opening a separate report.

<!-- Optional: add a screenshot, e.g. ![Queue Details in the header](screenshot.png) -->

## What it shows

Each queue appears as one item in the ticker:

```
Queue: Sales_Q        Queue: Support_Q        Queue: Billing_Q
Contacts: 4           Contacts: 1             Contacts: 2
Wait: 00:03:12        Wait: 00:00:45          Wait: 00:01:30
```

- **Queue**: the queue name
- **Contacts**: the number of contacts waiting (parked) in that queue right now
- **Wait**: how long the oldest waiting contact has been there (`HH:MM:SS`)

Hovering over the ticker pauses it.

## How it works

1. **Finds the agent's queues.** When the widget loads, it calls three WxCC Config API endpoints and combines the results into one queue filter:
   - Agent-based queues the agent is assigned to: `GET /organization/{orgId}/v2/contact-service-queue/by-user-id/{agentId}/agent-based-queues`
   - Skill-based queues the agent is eligible for: `GET /organization/{orgId}/v2/contact-service-queue/by-user-id/{agentId}/skill-based-queues`
   - Queues that reference the agent's team: `GET /organization/{orgId}/team/{teamId}/incoming-references`
2. **Pulls live queue stats.** It sends a GraphQL query to the WxCC Search API (`POST /search`). The query looks for active tasks with `status = parked` in those queues over the last 24 hours, grouped by `lastQueue`. For each queue it returns:
   - `count(id)`: the number of contacts waiting
   - `min(createdTime)`: when the oldest waiting contact arrived
3. **Refreshes on a schedule.**
   - Stats are fetched again every **30 seconds**.
   - The display re-renders every **1 second**, so wait times count up smoothly between fetches.
4. **Cleans up.** Both timers stop when the widget is removed from the desktop.

## Requirements

- Webex Contact Center tenant in the **US1** data center. The API base URL is hard-coded to `https://api.wxcc-us1.cisco.com`; see [Configuration](#configuration) for other regions.
- An Agent Desktop layout you can edit and upload in Control Hub.
- The agent's desktop access token must be able to read the Config and Search APIs, which the standard Agent Desktop token can.
- A host for `QueueDetails.js` that the desktop can reach over HTTPS.

## Installation

### 1. Host the script

The script is served from this repo by GitHub Pages:

```
https://krich5.github.io/WxCC_QueueDetails/QueueDetails.js
```

To host your own copy, fork this repo and turn on GitHub Pages, or upload `QueueDetails.js` to any static HTTPS host.

### 2. Add it to your Desktop Layout

Add the `queue-scroll` component to the `advancedHeader` area of your layout JSON and pass in the agent's context from `$STORE`:

```json
"advancedHeader": [
  {
    "comp": "queue-scroll",
    "script": "https://krich5.github.io/WxCC_QueueDetails/QueueDetails.js",
    "properties": {
      "orgId": "$STORE.agent.orgId",
      "token": "$STORE.auth.accessToken",
      "teamId": "$STORE.agent.teamId",
      "agentId": "$STORE.agent.agentId"
    }
  },
  "digital-outbound",
  "outdial-call",
  "notification"
]
```

> A complete sample layout is included in this repo: [`Desktop_Layout_wQueueDetails.json`](Desktop_Layout_wQueueDetails.json)

### 3. Upload the layout

In **Control Hub → Contact Center → Desktop Layouts**, upload the layout and assign it to the team(s) that should see the widget. Agents must sign out and back in to pick up the new layout.

## Properties

| Property | Store binding | Description |
|----------|---------------|-------------|
| `token`   | `$STORE.auth.accessToken` | Bearer token used for all API calls |
| `orgId`   | `$STORE.agent.orgId`      | WxCC organization ID |
| `teamId`  | `$STORE.agent.teamId`     | Agent's current team, used to find team-referenced queues |
| `agentId` | `$STORE.agent.agentId`    | Agent's user ID, used to find agent- and skill-based queues |

## Configuration

These values are compiled into the bundle. To change them, edit the source and rebuild:

| Setting | Current value | Notes |
|---------|---------------|-------|
| API base URL | `https://api.wxcc-us1.cisco.com` | Change for other regions, e.g. `api.wxcc-eu1.cisco.com`, `api.wxcc-anz1.cisco.com` |
| Stats refresh | 30 seconds | How often queue counts are fetched again |
| Display refresh | 1 second | How often wait timers update on screen |
| Lookback window | 24 hours | How far back the Search API looks for active parked tasks |
| Position | `position: fixed; top: 8px; left: 200px` | Where the ticker sits in the header |
| Width | `30vw` | Width of the ticker |

## Built with

- [Lit](https://lit.dev) 3 web components
- [Vite](https://vite.dev) for the production bundle

The bundle also contains an `admin-actions` component. It is a supervisor table that lists active telephony agents and has a **Log Out** button for each one, which calls `PUT /v1/agents/logout`. You can place it in a layout the same way, with `"comp": "admin-actions"` and a `token` property. The bundle also still has two Vite/Lit starter components, `my-element` and `hello-world`, which are not used.

## Known limitations

- **US1 only** unless you rebuild with a different API URL.
- **The scroll animation may not run.** The `scroll` keyframes are defined, but no `animation-name` is applied to the list. Only the duration is set. If the ticker sits still, add `animation-name: scroll; animation-timing-function: linear; animation-iteration-count: infinite;` to `.marquee`.
- **Console errors at startup.** The 1-second display refresh starts before the first stats call returns. Until that call finishes, `queueData` is undefined and each refresh throws an error. This clears up once the first data arrives.
- **Contacts and Wait may be swapped.** The query asks for the `contacts` aggregation first and `oldestStart` second. The template reads them in the opposite order (`aggregation[1]` for Contacts, `aggregation[0]` for Wait). Check the numbers against a known queue before rolling this out.
- **Queues with nothing waiting are hidden.** The Search API only returns queues that have parked contacts, so an empty queue doesn't appear in the ticker at all.

## License

Released under the [MIT License](LICENSE).
