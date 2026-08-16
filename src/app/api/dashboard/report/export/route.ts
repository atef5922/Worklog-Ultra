import { NextRequest, NextResponse } from "next/server";
import { requireEmployee } from "@/lib/auth/server";
import { buildReportSummary } from "@/lib/report-summary";
import { getHistoryData } from "@/lib/worklog";
import { formatDateTimeInDhaka, formatMinutes, toDateOnly } from "@/lib/utils";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRangeDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00+06:00`));
}

function formatRangeLabel(from: string, to: string) {
  if (from === to) {
    return formatRangeDate(from);
  }

  return `${formatRangeDate(from)} to ${formatRangeDate(to)}`;
}

function statusLabel(status: "done" | "in_progress" | "pending") {
  if (status === "done") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "employee"
  );
}

export async function GET(request: NextRequest) {
  const user = await requireEmployee();
  const requestedFrom = request.nextUrl.searchParams.get("from") || toDateOnly();
  const requestedTo = request.nextUrl.searchParams.get("to") || requestedFrom;
  const from = requestedFrom <= requestedTo ? requestedFrom : requestedTo;
  const to = requestedFrom <= requestedTo ? requestedTo : requestedFrom;
  const historyTasks = await getHistoryData(user.id, from, to);
  const summary = buildReportSummary(historyTasks);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Work Report · ${escapeHtml(user.name)} · ${escapeHtml(formatRangeLabel(from, to))}</title>
    <style>
      :root {
        color-scheme: light;
        --ink: #14213d;
        --muted: #64748b;
        --line: #dbe4ff;
        --line-soft: #e8eefc;
        --brand: #4f5ef7;
        --mono: ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace;
      }
      * {
        box-sizing: border-box;
      }
      body {
        margin: 0;
        font-family: "Segoe UI", Arial, sans-serif;
        background: #eef3ff;
        color: var(--ink);
      }
      .page {
        max-width: 1080px;
        margin: 32px auto;
        background: #ffffff;
        border-radius: 28px;
        overflow: hidden;
        box-shadow: 0 24px 60px rgba(20, 33, 61, 0.12);
      }
      .hero {
        padding: 30px 32px;
        background: linear-gradient(135deg, #001f66 0%, #2b3fd8 55%, #6d5df6 100%);
        color: #ffffff;
      }
      .hero-grid {
        display: grid;
        grid-template-columns: 1.6fr 1fr;
        gap: 24px;
      }
      .eyebrow {
        font-family: var(--mono);
        font-size: 11px;
        letter-spacing: 0.2em;
        text-transform: uppercase;
        opacity: 0.82;
      }
      h1 {
        margin: 10px 0 8px;
        font-size: 32px;
        letter-spacing: -0.02em;
      }
      .hero p {
        margin: 0;
        line-height: 1.6;
      }
      .hero .person {
        font-weight: 600;
      }
      .hero .range {
        font-family: var(--mono);
        font-size: 13px;
        opacity: 0.9;
        margin-top: 4px;
      }
      .hero-card {
        padding: 16px 18px;
        border-radius: 18px;
        background: rgba(255, 255, 255, 0.12);
        box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.18);
      }
      .hero-card strong {
        display: block;
        margin-top: 6px;
        font-family: var(--mono);
        font-size: 15px;
      }
      .hero-card p {
        margin-top: 10px;
        font-size: 12.5px;
        opacity: 0.85;
      }
      .content {
        padding: 26px 32px 32px;
      }
      .toolbar {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 16px;
      }
      .print-btn {
        font: inherit;
        font-size: 13px;
        font-weight: 600;
        color: #ffffff;
        background: var(--brand);
        border: 0;
        border-radius: 12px;
        padding: 10px 16px;
        cursor: pointer;
        box-shadow: 0 10px 22px rgba(79, 94, 247, 0.24);
      }
      .print-btn:hover {
        background: #4453eb;
      }
      .stats {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 12px;
        margin-bottom: 22px;
      }
      .stat {
        position: relative;
        padding: 16px 16px 14px;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: #f8faff;
        overflow: hidden;
      }
      .stat::before {
        content: "";
        position: absolute;
        inset: 0 0 auto 0;
        height: 3px;
        background: linear-gradient(90deg, var(--a), var(--b));
      }
      .stat-tasks { --a: #4f5ef7; --b: #8b9dff; }
      .stat-done { --a: #059669; --b: #6ee7b7; }
      .stat-progress { --a: #0284c7; --b: #7dd3fc; }
      .stat-time { --a: #7c3aed; --b: #c084fc; }
      .stat-label {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
      }
      .stat-value {
        margin-top: 8px;
        font-size: 26px;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
      }
      .stat-done .stat-value { color: #0f8f68; }
      .stat-progress .stat-value { color: #1d6fd0; }
      /*
       * The frame lives on the wrapper, not the table: a collapsed-border table
       * does not reliably keep its own outer border once a radius is applied,
       * which is why the left and right edges went missing.
       */
      .table-wrap {
        overflow-x: auto;
        border: 1px solid var(--line);
        border-radius: 16px;
      }
      table {
        width: 100%;
        min-width: 620px;
        border-collapse: collapse;
        table-layout: fixed;
      }
      thead {
        background: #eaf0ff;
      }
      th,
      td {
        padding: 11px 12px;
        text-align: left;
        vertical-align: top;
        border-right: 1px solid var(--line-soft);
        border-bottom: 1px solid var(--line-soft);
      }
      th:last-child,
      td:last-child {
        border-right: 0;
      }
      th {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: #47597c;
        border-bottom: 2px solid var(--line);
        border-right-color: var(--line);
      }
      td {
        font-size: 13.5px;
        word-break: break-word;
      }
      tbody tr:nth-child(even) {
        background: #fafbff;
      }
      .col-index {
        text-align: right;
        font-family: var(--mono);
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: var(--muted);
      }
      .col-num {
        text-align: right;
        white-space: nowrap;
        font-family: var(--mono);
        font-variant-numeric: tabular-nums;
      }
      .col-date {
        white-space: nowrap;
        font-family: var(--mono);
        font-size: 12.5px;
        color: var(--muted);
      }
      .task-title {
        font-weight: 700;
        color: var(--ink);
      }
      .task-meta {
        margin-top: 5px;
        color: var(--muted);
        line-height: 1.5;
        font-size: 12.5px;
      }
      tbody tr:last-child td {
        border-bottom: 0;
      }
      tfoot td {
        border-top: 2px solid var(--line);
        border-bottom: 0;
        background: #f8faff;
        font-weight: 700;
        font-size: 13px;
      }
      .status {
        display: inline-flex;
        padding: 5px 10px;
        border-radius: 999px;
        font-size: 11.5px;
        font-weight: 700;
        white-space: nowrap;
      }
      .status-done {
        background: #e8fff3;
        color: #0f8f68;
      }
      .status-in_progress {
        background: #edf4ff;
        color: #295fd6;
      }
      .status-pending {
        background: #fff7e8;
        color: #b7791f;
      }
      .empty {
        padding: 34px 16px;
        text-align: center;
        color: var(--muted);
      }
      .footer {
        margin-top: 18px;
        display: flex;
        justify-content: space-between;
        gap: 16px;
        color: var(--muted);
        font-size: 12.5px;
      }
      @page {
        size: A4;
        margin: 12mm;
      }
      @media print {
        body {
          background: #ffffff;
        }
        .page {
          margin: 0;
          max-width: none;
          box-shadow: none;
          border-radius: 0;
        }
        .hero {
          border-radius: 0;
        }
        .toolbar {
          display: none;
        }
        /* Repeat the header on every printed page and never split a row. */
        thead {
          display: table-header-group;
        }
        tr,
        .stat {
          break-inside: avoid;
        }
        .hero,
        .stat,
        .status,
        thead,
        tbody tr,
        tfoot td {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .table-wrap {
          overflow: visible;
        }
        table {
          min-width: 0;
        }
      }
      @media (max-width: 720px) {
        .page {
          margin: 0;
          border-radius: 0;
        }
        .hero,
        .content {
          padding: 20px;
        }
        .hero-grid,
        .stats {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div class="hero-grid">
          <div>
            <div class="eyebrow">WorkLog Ultra</div>
            <h1>Employee Work Report</h1>
            <p class="person">${escapeHtml(user.name)} · ${escapeHtml(user.designation ?? user.role)}</p>
            <p class="range">${escapeHtml(formatRangeLabel(from, to))}</p>
          </div>
          <div class="hero-card">
            <div class="eyebrow">Generated</div>
            <strong>${escapeHtml(formatDateTimeInDhaka(new Date()))}</strong>
            <p>Keep, share, or print this statement. Use Print and choose "Save as PDF" for a PDF copy.</p>
          </div>
        </div>
      </section>

      <section class="content">
        <div class="toolbar">
          <button class="print-btn" onclick="window.print()" type="button">Print / Save as PDF</button>
        </div>

        <div class="stats">
          <div class="stat stat-tasks">
            <div class="stat-label">Total Tasks</div>
            <div class="stat-value">${summary.totals.totalTasks}</div>
          </div>
          <div class="stat stat-done">
            <div class="stat-label">Completed</div>
            <div class="stat-value">${summary.totals.completedTasks}</div>
          </div>
          <div class="stat stat-progress">
            <div class="stat-label">In Progress</div>
            <div class="stat-value">${summary.totals.inProgressTasks}</div>
          </div>
          <div class="stat stat-time">
            <div class="stat-label">Tracked Time</div>
            <div class="stat-value">${escapeHtml(summary.totals.totalTrackedLabel)}</div>
          </div>
        </div>

        <div class="table-wrap">
        <table>
          <colgroup>
            <col style="width: 42px" />
            <col style="width: 104px" />
            <col />
            <col style="width: 116px" />
            <col style="width: 84px" />
            <col style="width: 82px" />
          </colgroup>
          <thead>
            <tr>
              <th class="col-index">#</th>
              <th>Date</th>
              <th>Task Details</th>
              <th>Status</th>
              <th class="col-num">Time</th>
              <th class="col-num">Progress</th>
            </tr>
          </thead>
          <tbody>
            ${
              summary.items.length
                ? summary.items
                    .map(
                      (item, index) => `<tr>
                <td class="col-index">${index + 1}</td>
                <td class="col-date">${escapeHtml(item.date)}</td>
                <td>
                  <div class="task-title">${escapeHtml(item.title)}</div>
                  <div class="task-meta">${escapeHtml(item.departmentName)}</div>
                  ${
                    item.description
                      ? `<div class="task-meta">${escapeHtml(item.description)}</div>`
                      : item.note
                        ? `<div class="task-meta">${escapeHtml(item.note)}</div>`
                        : ""
                  }
                </td>
                <td><span class="status status-${item.status}">${escapeHtml(statusLabel(item.status))}</span></td>
                <td class="col-num">${escapeHtml(formatMinutes(item.trackedMinutes))}</td>
                <td class="col-num">${item.completionPercent}%</td>
              </tr>`,
                    )
                    .join("")
                : `<tr><td class="empty" colspan="6">No report data found for ${escapeHtml(formatRangeLabel(from, to))}.</td></tr>`
            }
          </tbody>
          ${
            summary.items.length
              ? `<tfoot>
            <tr>
              <td colspan="4">Total · ${summary.items.length} ${summary.items.length === 1 ? "entry" : "entries"}</td>
              <td class="col-num">${escapeHtml(summary.totals.totalTrackedLabel)}</td>
              <td class="col-num"></td>
            </tr>
          </tfoot>`
              : ""
          }
        </table>
        </div>

        <div class="footer">
          <span>Range: ${escapeHtml(formatRangeLabel(from, to))}</span>
          <span>Generated from WorkLog Ultra</span>
        </div>
      </section>
    </div>
  </body>
</html>`;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="worklog-report-${slugify(user.name)}-${from}-to-${to}.html"`,
    },
  });
}
