# Query Copilot — test prompts (natural language → KQL)

A ready-to-use battery of prompts for exercising the Query Copilot's
natural-language → KQL conversion, plus the KQL each prompt should produce and
the result you can expect.

Every KQL snippet here was validated against the live `fosstlsoc-logs-*` data
(IIT-B TrustLab SOC dataset, ~16.8M docs), so a correct generation should return
the indicated rows when run.

All file paths are relative to the plugin root (`plugins/query_copilot/`).

---

## How to use this doc

1. Start Kibana with the plugin and open **Query Copilot**.
2. Set the **Index** to `fosstlsoc-logs-*` and the **time range** to **This year**
   (the dataset spans Feb–Jun 2026; "Last 24 hours" also works for live sources
   such as `roundcube_login` / `mail_auth`).
3. Type a prompt from the tables below into the chat, read the generated KQL,
   then press **Refresh / Run** to execute it.
4. Compare the generated KQL against the "Expected KQL" column.

> **Clear the cache between generation tests.** Identical prompt + index hits the
> Redis cache and returns the previous result. To force a fresh generation:
> ```bash
> redis-cli --scan --pattern 'qc:v1:*' | xargs -r redis-cli DEL
> ```
> (or just reword the prompt slightly — a different prompt is a different cache key).

---

## The dataset at a glance

These are web/security logs, **not** generic ECS security events. Two different
field families carry "failure" information depending on the log source:

| Concept | Field family | Lives in |
| --- | --- | --- |
| Login / auth events | `event.outcome`, `event.action`, `user.name` | `roundcube_login`, `*_auth` |
| HTTP request outcome | `http.response.status_code`, `http.request.method`, `url.path` | `*_apache_access`, `waf-nginx-access` |
| Source of traffic | `source.ip` | all |

Available `service_name` values (use to scope a query to one log type):
`postfix`, `waf-nginx-access`, `mail_apache_access`, `web_apache_access`,
`suricata_mail`, `modsec_audit_log`, `mail_auth`, `waf_auth`, `roundcube_login`,
`web_auth`, `openvas_report`, `ml_stats`.

> ⚠️ **`event.category : "authentication"` does not exist in this data** (→ 0 hits),
> and a failed-login doc has no `event.category` at all. A query that ANDs
> `event.outcome : "failure"` with `event.category : "authentication"` returns
> **zero** rows even though the fields look reasonable. This is the canonical
> mismatch the prompts below are designed to catch.

---

## 1. Authentication / login failures (the auth logs)

| Prompt | Expected KQL | Expect |
| --- | --- | --- |
| show me all failed login attempts | `event.outcome : "failure" and event.action : "login"` | ~50,017 |
| all login events, successful or failed | `event.action : "login"` | ~53,483 |
| failed logins from source IP 10.130.171.190 | `event.outcome : "failure" and event.action : "login" and source.ip : "10.130.171.190"` | subset |
| failed logins for user 009@gmail.com | `event.outcome : "failure" and event.action : "login" and user.name : "009@gmail.com"` | subset |
| only Roundcube webmail login activity | `service_name : "roundcube_login"` | ~13,095 |

---

## 2. HTTP / web request failures

| Prompt | Expected KQL | Expect |
| --- | --- | --- |
| show all failed HTTP requests | `http.response.status_code >= 400` | ~6,027,510 |
| show unauthorized and forbidden responses | `http.response.status_code : 401 or http.response.status_code : 403` | ~2,055,108 |
| show 404 not found errors | `http.response.status_code : 404` | ~2,460,943 |
| show server errors | `http.response.status_code : 500` | ~12,805 |
| requests that hit a login page | `url.path : *login*` | ~349,843 |
| forbidden requests from 10.130.171.190 | `http.response.status_code : 403 and source.ip : "10.130.171.190"` | subset |

---

## 3. Scoping, IPs, and combinations

| Prompt | Expected KQL | Expect |
| --- | --- | --- |
| everything from source IP 10.130.171.190 | `source.ip : "10.130.171.190"` | ~3,754 |
| WAF nginx access logs only | `service_name : "waf-nginx-access"` | ~3,295,127 |
| 401 or 403 responses in the WAF logs | `service_name : "waf-nginx-access" and (http.response.status_code : 401 or http.response.status_code : 403)` | subset |
| failed logins OR forbidden web requests | `(event.outcome : "failure" and event.action : "login") or http.response.status_code : 403` | large |

---

## 4. Negative / mismatch checks (should return 0 — and ideally NOT be generated)

These confirm the copilot is grounding on the **real index mapping** instead of
guessing generic ECS fields. A correctly-grounded copilot should **avoid**
generating the first column; if it does generate it, you've reproduced the
field-mismatch bug.

| Prompt | Wrong KQL (0 hits) | Correct KQL |
| --- | --- | --- |
| show me all failed login attempts in the last 24 hours | `event.outcome : "failure" and event.category : "authentication"` | `event.outcome : "failure" and event.action : "login"` |
| authentication failures | `event.category : "authentication"` | `event.outcome : "failure" and event.action : "login"` |

---

## What "good" looks like

A correct conversion:

- references only fields that exist in `fosstlsoc-logs-*`
  (`event.outcome`, `event.action`, `http.response.status_code`, `source.ip`,
  `url.path`, `user.name`, `service_name`, …);
- never pairs `event.outcome : "failure"` with `event.category : "authentication"`;
- passes the in-editor **Syntax Passed** check; and
- returns a non-empty **Query Output** when run with the time range set to **This year**.

If a generation still picks a non-existent field, capture the prompt + generated
KQL — that is the signal for further prompt-grounding tuning in
`server/services/prompt/` (see `system.prompts.ts` and `prompt.builder.ts`).
