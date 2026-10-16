# Queue Details — WxCC Desktop Header Widget

A Webex Contact Center (WxCC) Agent Desktop header card showing the combined queue numbers for every queue the signed-in agent is allowed to see. It sits in the desktop header, so queue pressure is visible without opening a report.

## What it shows

One compact card with five numbers, each totalled across all of the agent's queues:

| Number | Meaning |
|--------|---------|
| **Waiting** | Contacts waiting right now. Turns yellow at 5 and red at 10 by default. |
| **Longest wait** | How long the longest-waiting contact has waited, as a live clock. Turns yellow at 2 minutes and red at 5 minutes by default. |
| **Offered today** | Contacts that came into the queues since midnight (local time) |
| **Handled** | Today's contacts whose Handle Type is `normal` or `sudden_disconnect`, the same as the Analyzer reports |
| **Abandoned** | Today's contacts whose Termination Type is `abandoned` |

Which queues count is decided by the agent's **desktop profile** (Control Hub → Desktop Profiles → Agent Statistics → Queue statistics: All, None or Specific). With "None" the card shows N/A. For the same numbers queue by queue, see [AgentDashboard](https://github.com/Krich5/AgentDashboard).

## How it works

The widget reads the WxCC Search API and Config API as the signed-in user. It needs only what the Desktop already has. There's no server behind it.

1. It reads the agent's desktop profile to learn which queues they may view.
2. It reads waiting contacts and today's contact counts, and adds up the allowed queues.
3. It refreshes every 15 seconds. The longest-wait clock ticks every second in between.
4. If a refresh fails, it keeps the last numbers on screen, dims the card, and shows the reason when you hover over it.

## Installation

### 1. Host the script

With GitHub Pages turned on for this repo (Settings → Pages → `main` / root), the script is served at:

```
https://krich5.github.io/QueueDetails/index.js
```

### 2. Add it to your Desktop Layout

Add `queue-scroll` to the `advancedHeader` area:

```json
"advancedHeader": [
  {
    "comp": "queue-scroll",
    "script": "https://krich5.github.io/QueueDetails/index.js",
    "attributes": {
      "token": "$STORE.auth.accessToken",
      "org-id": "$STORE.agent.orgId",
      "data-center": "$STORE.app.datacenter",
      "agent-profile-id": "$STORE.agent.agentProfileID",
      "darkmode": "$STORE.app.darkMode"
    }
  },
  "digital-outbound",
  "outdial-call",
  "notification"
]
```

> A complete sample layout is included in this repo: [`Desktop_Layout_wQueueDetails.json`](Desktop_Layout_wQueueDetails.json)

### 3. Upload the layout

In **Control Hub → Contact Center → Desktop Layouts**, upload the layout and assign it to the teams that should see the card. Agents must sign out and back in to pick it up.

## Settings

Everything can be set as an attribute, as above. The component also accepts `token`, `orgId`, `dataCenter` and `agentProfileId` as properties, so layouts written for the earlier version keep working.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `token` | Yes | The user's access token, `$STORE.auth.accessToken` |
| `org-id` | Yes | WxCC organization ID, `$STORE.agent.orgId` |
| `data-center` | Yes | From `$STORE.app.datacenter`. The region is picked out of the value (us1, eu1, eu2, anz1, ca1) |
| `agent-profile-id` | Yes | The agent's desktop profile ID, `$STORE.agent.agentProfileID`. Without it the card says queue access can't be determined. |
| `darkmode` | No | `$STORE.app.darkMode` |
| `refresh-seconds` | No | How often data is fetched. Default `15` |
| `stale-seconds` | No | How long before the card is dimmed as out of date. Default `60` |
| `lookback-hours` | No | How far back to look for waiting contacts. Default `24` |
| `waiting-warn` / `waiting-alert` | No | Waiting turns yellow and red at these counts. Defaults `5` and `10` |
| `wait-warn-seconds` / `wait-alert-seconds` | No | Longest wait turns yellow and red at these seconds. Defaults `120` and `300` |
| `offset-top` / `offset-left` | No | By default the card sits in the header's normal flow, next to the other header items. Set either one to pin it at that position instead (for example `8px` and `200px`) |
| `base-url` | No | Use this API address instead of the one built from `data-center` |

## Known limitations

- **Handled and Abandoned need contact outcome fields from the Search API.** If the API doesn't offer Handle Type, Handled falls back to contacts that ended normally and is approximate. If it offers no outcome fields at all, both show N/A.
- **Counts run from midnight, local time.**
- **Queue names must be unique.** Numbers are matched to queues by name.

## License

See [LICENSE](LICENSE).
