# 🏟️ ATHLETE 360 — Master Project Bible
> **For Claude:** Read this entire document before writing any code or making any decision.
> Every architectural choice, feature, and convention is documented here.
> Never assume — if it's not in this document, ask the owner before proceeding.
>
> **For the owner:** At the start of every new Claude session, paste this file and say:
> *"Read this PROJECT_NOTES.md carefully. This is our ongoing project.
> Today I want to work on [specific page or feature]."*
> Always ask Claude to update this file at the end of each session.

---

# PART 1 — PROJECT FOUNDATION

## 1.1 Overview

| Field | Detail |
|---|---|
| **Project Name** | Athlete 360 |
| **Type** | SaaS Sports Institute Record Management Platform |
| **Scope** | All sports — general, not limited to one sport |
| **Current Status** | 🟢 Planning Complete — Ready to build |
| **Owner profile** | Non-technical founder. Can deploy backend, configure servers, connect databases. Needs clean, correct code. All code is Claude-assisted. |
| **Core principle** | Fully functional and reliable over feature-rich and broken. When in doubt, build it properly or don't build it yet. |

**What is Athlete 360?**
A SaaS web platform where sports institutes pay a subscription to manage everything about their athletes — enrollment, attendance, performance tracking, competition results, leaderboards, and communications — through role-specific dashboards for four user types.

---

## 1.2 Tech Stack

| Layer | Technology | Status |
|---|---|---|
| Frontend | HTML / CSS / JavaScript (plain, no framework) | ✅ Confirmed |
| Backend | Node.js + Express | ✅ Confirmed |
| Database | PostgreSQL | ✅ Confirmed |
| Authentication | JWT tokens (role-aware, plan-aware) | ✅ Confirmed |
| Payments | Stripe (subscriptions, webhooks, proration) | ✅ Confirmed |
| Email service | To be selected (options: SendGrid, Resend, Mailgun) | 🔲 Decide before backend |
| Hosting | To be decided (Render / Railway / VPS) | 🔲 Decide before deploy |
| Domain | Already purchased | ✅ Done |
| GitHub | Already set up | ✅ Done |

**Architecture rules:**
- Modular code from day one — new pages and features must never require rewriting existing ones
- RBAC (Role-Based Access Control) enforced on every backend API route, not just the frontend
- Plan-gating enforced in two layers: backend (real lock) + frontend (visual lock)
- RESTful API — frontend and backend are fully separated
- One HTML file per page — no frontend framework, clean and portable

---

## 1.3 Folder Structure

```
athlete-360/
│
├── frontend/
│   ├── public/                         # No login required
│   │   ├── index.html                  # Landing page
│   │   ├── pricing.html                # Plans & Stripe purchase
│   │   ├── blog.html                   # Blog listing (public)
│   │   ├── blog-post.html              # Individual blog post
│   │   ├── login.html                  # Single login entry point
│   │   └── about.html                  # About & contact
│   │
│   ├── app/                            # Login required (protected)
│   │   ├── superadmin/
│   │   │   ├── dashboard.html
│   │   │   ├── institutes.html
│   │   │   ├── users.html
│   │   │   ├── revenue.html
│   │   │   ├── plans.html
│   │   │   ├── blog-manager.html
│   │   │   ├── announcements.html
│   │   │   ├── sports-library.html
│   │   │   ├── settings.html
│   │   │   └── audit-log.html
│   │   │
│   │   ├── admin/
│   │   │   ├── dashboard.html
│   │   │   ├── coaches.html
│   │   │   ├── athletes.html
│   │   │   ├── attendance.html
│   │   │   ├── performance.html
│   │   │   ├── events.html
│   │   │   ├── announcements.html
│   │   │   ├── reports.html
│   │   │   └── settings.html
│   │   │
│   │   ├── coach/
│   │   │   ├── dashboard.html
│   │   │   ├── athletes.html
│   │   │   ├── attendance.html
│   │   │   ├── performance.html
│   │   │   ├── events.html
│   │   │   ├── leaderboard.html
│   │   │   └── announcements.html
│   │   │
│   │   └── athlete/
│   │       ├── dashboard.html
│   │       ├── profile.html
│   │       ├── attendance.html
│   │       ├── performance.html
│   │       ├── events.html
│   │       ├── leaderboard.html
│   │       └── announcements.html
│   │
│   ├── css/
│   │   ├── global.css                  # Design tokens, shared styles
│   │   ├── public.css                  # Public pages only
│   │   └── app.css                     # Dashboard / app pages
│   │
│   ├── js/
│   │   ├── auth.js                     # Login, JWT handling, role routing
│   │   ├── api.js                      # All fetch calls to backend
│   │   └── utils.js                    # Shared helper functions
│   │
│   └── assets/
│       ├── images/
│       └── icons/
│
├── backend/
│   ├── server.js                       # Entry point
│   ├── config/
│   │   ├── db.js                       # PostgreSQL connection
│   │   └── stripe.js                   # Stripe configuration
│   ├── routes/
│   │   ├── auth.js                     # Login, logout, password reset
│   │   ├── superadmin.js               # Super admin only routes
│   │   ├── admin.js                    # Institute admin routes
│   │   ├── coach.js                    # Coach routes
│   │   ├── athlete.js                  # Athlete routes
│   │   ├── blog.js                     # Blog CRUD (public read, owner write)
│   │   ├── announcements.js            # Announcements (role-scoped)
│   │   └── billing.js                  # Stripe webhooks & billing
│   ├── models/
│   │   ├── User.js
│   │   ├── Institute.js
│   │   ├── Subscription.js
│   │   ├── Athlete.js
│   │   ├── Performance.js
│   │   ├── Attendance.js
│   │   ├── Event.js
│   │   ├── Competition.js
│   │   ├── CompetitionResult.js
│   │   ├── Leaderboard.js
│   │   ├── Badge.js
│   │   ├── Discipline.js
│   │   ├── Announcement.js
│   │   ├── BlogPost.js
│   │   └── Sport.js
│   ├── middleware/
│   │   ├── auth.js                     # JWT verification
│   │   ├── roleCheck.js                # RBAC enforcement
│   │   └── planCheck.js                # Plan feature gating
│   └── utils/
│       ├── emailService.js             # All automated emails
│       ├── badgeTrigger.js             # Automated badge logic
│       └── leaderboardCalc.js          # Leaderboard calculation logic
│
├── database/
│   └── schema.sql                      # Full PostgreSQL schema (to be written)
│
├── PROJECT_NOTES.md                    # ← THIS FILE
└── README.md                           # Public-facing project readme
```

---

## 1.4 Design Direction

- **Aesthetic:** Dark, high-performance, premium sports analytics
- **Color palette:** Deep navy / charcoal base + bold accent color (chosen during frontend build)
- **Typography:** Strong display font for headings, clean sans-serif for data
- **Athlete dashboard feel:** Personal and motivating — not a spreadsheet
- **Responsive:** Desktop primary, tablet secondary
- **UI principle:** The coach's daily routine (attendance + performance log) must be completable in under 5 minutes. Speed and clarity are non-negotiable for daily-use screens.

---

# PART 2 — BUSINESS MODEL & PRICING

## 2.1 Model

- **Type:** SaaS subscription
- **Who pays:** Institute Admin purchases a plan for their institute
- **Who doesn't pay:** Coaches and athletes receive login credentials from their admin — free to them
- **Payment processor:** Stripe
- **Trial:** 14 days free, no credit card required at signup, card collected before trial ends

## 2.2 Subscription Plans

### 🥉 Starter — $24/month or $18/month billed annually ($216/year) — Save 25%
**For:** Small local academies, single-sport clubs, institutes just starting out

| Limit | Value |
|---|---|
| Athletes | Up to 50 |
| Coaches | Up to 5 |
| Sport categories | 1 |

**Features included:**
- Athlete profiles & enrollment
- Attendance management
- Performance tracking (basic)
- Events calendar
- Leaderboard & badges
- Basic reports (PDF export)
- Announcements (receive only from platform)
- Email support

**Not included:** Advanced reports, competition panel, institute branding, bulk import, full analytics

---

### 🥈 Pro — $59/month or $44/month billed annually ($528/year) — Save 25%
**For:** Growing institutes, multi-sport academies, regional training centers

| Limit | Value |
|---|---|
| Athletes | Up to 200 |
| Coaches | Up to 20 |
| Sport categories | Multiple |

**Features included:** Everything in Starter, plus:
- Multiple sport categories + custom metrics
- Advanced reports (CSV + PDF, custom date ranges)
- Competition panel + full event calendar
- Attendance threshold alerts
- Institute branding (logo on reports)
- Priority email support

**Not included:** Bulk CSV import, full analytics dashboard, dedicated support

---

### 🥇 Elite — $129/month or $97/month billed annually ($1,164/year) — Save 25%
**For:** Large national institutes, professional academies, sports boards

| Limit | Value |
|---|---|
| Athletes | Unlimited |
| Coaches | Unlimited |
| Sport categories | Unlimited |

**Features included:** Everything in Pro, plus:
- Full analytics dashboard
- Bulk data import via CSV
- Dedicated support (faster response, direct contact)
- Early access to new features
- Full data export / backup anytime

---

## 2.3 Billing Rules

| Rule | Detail |
|---|---|
| Trial | 14 days free, card held but not charged |
| Trial reminder | Email sent 3 days before trial ends |
| Grace period | 7 days if payment fails before suspension |
| Upgrade | Takes effect immediately, Stripe prorates charge |
| Downgrade | Takes effect at next renewal date, not immediately |
| Annual refund | No refunds — access continues until period ends |
| Cancellation | Access until end of billing period |
| Data after cancellation | Preserved 60 days, then permanently deleted |
| Pre-deletion warning | Email sent 7 days before permanent deletion |
| Athlete limit alert | At 80% capacity: in-app alert + email to admin |
| Athlete limit reached | Coach cannot enroll new athletes, upgrade prompt shown |

## 2.4 Revenue Projection

| Stage | Institutes | Mix | Monthly Revenue |
|---|---|---|---|
| Early | 10 | 7 Starter, 2 Pro, 1 Elite | ~$355/mo |
| Growing | 30 | 15 Starter, 10 Pro, 5 Elite | ~$1,310/mo |
| Established | 100 | 40 Starter, 40 Pro, 20 Elite | ~$5,500/mo |

Platform running costs: ~$50–100/month fixed. Profitable from ~5 paying institutes.

---

# PART 3 — USER ROLES & DASHBOARDS

## 3.1 Role Hierarchy

```
Super Admin (Platform Owner — You)
            ↓
    Institute Admin
    (purchases plan, manages one institute)
            ↓
    Coach / Trainer
    (enrolled by Admin, manages assigned athletes)
            ↓
    Athlete / Player
    (enrolled by Coach, views own data only)
```

**Key rules:**
- One coach belongs to one institute only — no cross-institute coaching
- Institute Admins see their institute only
- Athletes see their own data only
- Super Admin sees everything
- RBAC enforced on every backend route
- Plan limits enforced in backend middleware (planCheck.js)

---

## 3.2 Super Admin Dashboard (Platform Owner)

### Home
- Stats strip: total active institutes, total athletes, total coaches, MRR, new institutes this month, churned institutes this month
- Revenue chart: MRR over 12 months + breakdown by plan type
- Upcoming renewals this week
- Activity feed: new signups, plan changes, support flags, blog posts, announcements
- Quick actions: Create Blog Post, Send Announcement, View Institutes, Manage Plans
- Alerts: failed payments, institutes near athlete limit, inactive institutes (30+ days)

### Institute Management
- All institutes list: name, plan, athlete count, coach count, signup date, last active, payment status
- Institute detail view: full info, plan details, usage stats, user list, payment history
- Actions per institute: message admin, manually change plan, suspend, ban, delete
- Suspend = locked but data preserved, ban = full revocation, delete = permanent (with typed confirmation + data export offer)

### User Management
- Platform-wide user search by name or email
- View role, institute, last login, status
- Suspend or ban any individual user
- Manually create institute admin account (for demos or special cases)

### Revenue & Billing
- MRR, ARR, revenue by plan, trend chart
- Upcoming renewals (7 and 30 day views)
- Failed payments list
- All subscriptions with status, filter by plan / payment / renewal date
- Manually upgrade / downgrade any institute
- Issue refunds via Stripe
- Apply discounts / coupons
- Full invoice history across all institutes

### Plan Management
- View, edit, create, deprecate subscription plans
- Edit: name, price, athlete limit, features
- Deprecate: existing subscribers stay on old plan, new signups see new
- Coupon management: create discount codes, set expiry and usage limits, track usage
- All changes sync to Stripe automatically

### Blog Management
- Post list: title, date, status (published / draft)
- Create / edit: title, body (rich text), category/tags, featured image, SEO fields
- Schedule publish for future date or publish immediately
- Soft delete (trash, recoverable 30 days)

### Announcements
- Send to: everyone / all admins / all coaches / all athletes / specific institute
- Types: General / Platform Update / Maintenance / Urgent
- Full sent history

### Sports & Metrics Library
- View all predefined sports and their metrics
- Add new sport to platform library
- Edit existing sport metrics
- Deprecate sport (existing institutes keep it, new ones don't see it)

### Platform Settings
- Platform name, logo, support email
- Default attendance threshold (institutes can override)
- Default grade system: numeric 1–10 (confirmed — institutes cannot change this)
- Email sender configuration
- Security: force platform-wide password reset, login attempt logs, session timeout
- Maintenance mode toggle (custom message shown, super admin still accessible)

### Audit Log
- Every significant platform action logged: who, what, when, which institute/user
- Filterable by date, action type, user
- Permanent — cannot be edited or deleted

---

## 3.3 Institute Admin Dashboard

### Home
- Stats: total athletes, total coaches, today's attendance rate, upcoming events this month
- Activity feed: recent enrollments, performance entries, upcoming competitions, announcements
- Quick actions: Add Coach, View Athletes, Send Announcement, Generate Report
- Alerts: poor attendance athletes, plan limit approaching (80%+), inactive coaches, upcoming events

### Coach & Trainer Management
- List: name, sport specialty, assigned athlete count, last active, status
- Coach profile: details, assigned athletes, activity log, athletes' performance summary
- Enroll new coach: form → credentials auto-generated → welcome email sent
- Assign / reassign athletes between coaches

### Athlete Overview (read-only for admin)
- All athletes: name, sport, assigned coach, enrollment date, attendance %, status
- Individual athlete view: full profile, attendance, performance, competition history
- Can reassign athletes, change status (Active / Inactive / Suspended)

### Attendance Overview
- Institute-wide summary by date / week / month
- Filter by sport, coach, date range
- Flag athletes below attendance threshold
- Export reports

### Performance Overview (monitoring only — coaches log)
- Aggregate view, filter by sport / coach / athlete / date range
- Top performers per sport, improving vs declining

### Events & Competitions
- All upcoming and past events institute-wide
- Add institute-level events (tournaments, trials, selection camps)
- Export event history

### Announcements
- Send to: all institute / coaches only / athletes only / specific sport group
- Types: General / Urgent / Event / Reminder
- Inbox: from Super Admin | Full sent history

### Reports
- Individual athlete / full institute / coach activity / sport-specific
- Date ranges: custom / monthly / quarterly / annual
- Export: PDF and CSV

### Institute Settings
- Name, logo, address, contact
- Active sport categories
- Custom performance metrics per sport
- Attendance threshold
- Notification preferences

### Subscription & Billing
- Current plan, renewal date, usage vs limit
- Upgrade / downgrade / cancel (Stripe portal)
- Billing history and invoices

**Cannot:** see other institutes, access Super Admin panel, publish blog, log performance entries, execute removal without discipline trail

---

## 3.4 Coach / Trainer Dashboard

### Home
- Stats: my athletes, today's attendance, sessions this week, upcoming events, active warnings, open competitions
- Today's panel: quick attendance widget (mark present/absent/late/excused without leaving dashboard) + session notes field
- Athletes snapshot: mini cards — name, photo, attendance %, performance trend, discipline status
- Alerts: warned athletes, athletes nearing suspension, events within 7 days, declining performance

### My Athletes
- List: name, photo, sport, attendance %, performance trend, discipline status, grade average, leaderboard rank
- Quick actions: View Profile, Log Performance, Mark Attendance, Issue Warning
- Enroll new athlete: full form → unique ID assigned → welcome email sent to athlete

### Individual Athlete Profile (full coach access)
- Personal details (editable by coach)
- Attendance history, streak, percentage
- Performance log with charts
- Fitness test grades history
- Competition history & results
- Discipline record (full trail of warnings, suspensions, reasons, dates)
- Medical notes (coach + admin only — athletes can view their own)
- Full chronological activity timeline
- Current leaderboard rank (class + institute)

### Discipline System
```
Level 1 — Warning
  → Mandatory reason field
  → Athlete notified automatically
  → Visible on profile and dashboard
  → Expires after set period OR escalates to suspension

Level 2 — Suspension
  → Mandatory reason + supporting notes
  → Institute Admin notified automatically
  → Athlete restricted (can log in, sees suspension notice)
  → Set end date — auto-reinstated or manual

Removal (Admin only)
  → Coach submits REQUEST with full documented trail
  → Only Institute Admin executes permanent removal
  → Requires documented warning + suspension history
```

### Attendance Management
- Daily: select date → mark each athlete (present/late/absent/excused) → session notes → submit
- Locked after submission — admin can override only
- Suspended athletes auto-marked as suspended (not absent)
- History: calendar view, per-athlete breakdown, streak tracking, export

### Performance Tracking
- Log entry: select athlete → sport auto-filled → sport-specific metrics appear → submit
- Entry types: Training Session / Time Trial / Fitness Test / Assessment
- Fitness test grading: numeric 1–10, feeds leaderboard grade score
- Bulk entry mode: select multiple athletes → enter values → submit all at once
- Performance history: charts per metric, filter by date / entry type
- Side-by-side athlete comparison view

### Events & Competition Calendar
- Calendar view: monthly / weekly / list toggle
- Color coded: Training (blue) / Competition (gold) / Fitness Test (green) / Other (grey)
- Create event: name, type, date, time, location, description, assign athletes → athletes auto-notified
- Competition Panel (dedicated):
  - Tabs: Upcoming / Past
  - Click any → detail view: participants, results, winner highlighted 🏆
  - Coach marks winner and positions from detail view
  - Results feed leaderboard automatically

### Leaderboard
**Two scope toggle:**
- Class Board — within this coach's group only
- Institute Board — within their sport across whole institute

**Five types:**

| Type | Basis |
|---|---|
| 🏆 Competition | Wins, podium finishes, points |
| 📈 Performance | Metric improvement % over time |
| ✅ Attendance | Percentage and streaks |
| 📋 Fitness Grades | Average numeric grade (1–10) |
| ⭐ Overall | Weighted composite of all four |

- Settings: reset period (monthly/seasonal/cumulative), score weightings, option to hide from athletes temporarily

### Announcements
- Inbox: from Super Admin and Institute Admin, urgent flagged
- Send to athletes: all or specific, types: General / Training / Event / Discipline / Urgent
- Full sent history

**Cannot:** see other coaches' athletes, execute permanent removal, edit submitted attendance, access billing, send institute-wide announcements

---

## 3.5 Athlete / Player Dashboard

### Home
- Header: photo, name, sport, coach, institute, enrollment date, athlete ID, current status
- Stats: attendance % this month, current streak, performance entries this month, upcoming events, leaderboard rank (class + institute switchable)
- Today's panel: scheduled session/event, latest announcement, improvement indicator (improving/stable/declining)
- Snapshot cards: last performance entry, last grade, next competition, latest announcement
- Progress visual: overall standing across all four pillars shown as color zones (green/amber/red) — motivational

### My Profile
- View: all personal details, enrollment info, emergency contact, own medical notes
- Edit: profile photo and contact number only — everything else coach-managed

### My Attendance
- Summary: attendance %, current streak, longest streak, breakdown (present/absent/late/excused)
- Calendar: color coded per day — click day → session details + coach notes
- Full history table, filterable

### My Performance
- Metric cards: current value, personal best, trend arrow — per sport metric
- Time range toggle: this week / month / season / all time
- Progress charts: line chart per metric, personal bests marked as milestones
- Full performance log with filters
- Fitness grades: all grades listed, trend over time, grade average displayed
- Personal Bests Board: all-time bests per metric — displayed as trophy shelf

### Competitions & Events
- Upcoming: calendar view, color coded, countdown to next event
- Competition history: click any → full detail (their result, winner, all participants)
- Personal record: total competitions, wins, podium finishes
- Achievements panel: all earned badges displayed

### Leaderboard (read-only)
- Same two-scope toggle: Class / Institute
- Same five types
- Top 3 highlighted in podium style
- Own row always visible and highlighted regardless of rank
- Motivation layer: gap indicator ("3 points behind 2nd place"), rank trend

### Announcements (inbox only)
- From coach, admin, super admin — urgent flagged, unread count shown

### My Reports
- Generate personal PDF: profile + attendance + performance + grades + competitions
- Date range selectable — useful for scholarship applications, selection trials

### Settings
- Update profile photo and contact number
- Change password
- Notification preferences

**Cannot:** edit performance or attendance, see others' profiles or medical notes, send announcements, access management tools or billing

---

# PART 4 — FEATURES & SYSTEMS

## 4.1 Badge & Achievement System

### Automated Badges (system-triggered)
| Badge | Trigger |
|---|---|
| 1 Week Perfect Attendance | 7 consecutive sessions present |
| 1 Month Perfect Attendance | Full month, no absences |
| 3 Months Perfect Attendance | Full quarter, no absences |
| Personal Best Achieved | Any metric beats previous best |
| First Competition Win | First 1st place result logged |
| Podium Finish | Any top 3 competition result |
| Grade Improvement | Significant grade score improvement |
| 10 Sessions Completed | Milestone |
| 25 / 50 / 100 Sessions | Further milestones |

### Coach-Awarded Badges (manually assigned by coach)
- Most Improved
- Perfect Attendance (seasonal, coach-confirmed)
- Champion
- Team Player
- Outstanding Performance
- Coach's Pick

Both types displayed on athlete profile and achievements panel.

---

## 4.2 Performance Metrics System (Hybrid)

**How it works:**
- Platform ships with predefined metrics for common sports (ready to use immediately)
- Institute Admin can define custom metrics for any unlisted sport
- General Fitness metrics available to all athletes regardless of sport
- Entry types: Training Session / Time Trial / Fitness Test / Assessment
- Grading system: **Numeric 1–10** (confirmed, platform-wide, not overridable)
- All metrics feed into the Performance leaderboard (improvement % over time)

**When a coach logs performance:**
Select athlete → sport auto-fills → only that sport's metrics appear as input fields

---

## 4.3 Leaderboard System

**Scopes (athlete can toggle between both):**
- Class Board: ranked within their coach's group only
- Institute Board: ranked within their sport across the whole institute

**Types:** Competition / Performance / Attendance / Grades / Overall (weighted composite)

**Settings (coach-controlled):**
- Reset period: monthly / seasonal / cumulative
- Overall score weightings (e.g. Performance 40%, Attendance 30%, Competition 20%, Grades 10%)
- Option to hide leaderboard from athletes temporarily (e.g. during selection)

**Motivation layer on athlete dashboard:**
- Gap indicator: "You are 3 points behind 2nd place"
- Rank trend: "Your attendance rank improved by 2 this week"

---

## 4.4 Plan Feature Gating (Technical Implementation)

**Enforced in two layers — both required:**

Layer 1 — Backend (real lock):
- Every JWT token carries institute's current plan
- planCheck.js middleware runs before every restricted route
- If plan doesn't include the feature → 403 response, request rejected
- Cannot be bypassed from frontend

Layer 2 — Frontend (visual lock):
- Restricted features hidden or shown with upgrade prompt
- On upgrade: token refreshed with new plan → features unlock immediately, no logout needed

**Real-time limit tracking:**
- Athlete count tracked against plan limit in real time
- At 80%: in-app alert + email to admin
- At 100%: enrollment blocked, upgrade prompt shown

---

## 4.5 Public-Facing Pages

| Page | Purpose |
|---|---|
| Landing Page | Hero, features overview, social proof, CTA to pricing |
| Pricing Page | Plan comparison + Stripe 14-day trial signup |
| Blog | Public articles, sports knowledge, SEO — owner-published only |
| Login Page | Single entry point, routes to correct dashboard by role |
| About / Contact | Trust-building for institutes considering purchase |

---

# PART 5 — SPORTS LIBRARY

## 5.1 Predefined Sports & Metrics

All sports below are available to every institute from day one.
General Fitness metrics are available to all athletes regardless of sport.

---

### ⚽ Football (Soccer)
| Metric | Unit |
|---|---|
| Goals Scored | count |
| Assists | count |
| Passes Completed | count |
| Pass Accuracy | % |
| Shots on Target | count |
| Distance Covered | km |
| Sprint Speed (max) | km/h |
| Tackles Won | count |
| Saves Made (GK) | count |

### 🏏 Cricket
| Metric | Unit |
|---|---|
| Runs Scored | count |
| Balls Faced | count |
| Batting Average | number |
| Strike Rate | number |
| Wickets Taken | count |
| Bowling Average | number |
| Economy Rate | number |
| Catches Taken | count |
| Stumpings | count |

### 🏊 Swimming
| Metric | Unit |
|---|---|
| Lap Time | seconds |
| Race Time | seconds |
| Distance | meters |
| Stroke Count | count |
| Split Times | seconds |
| Turns Completed | count |
| Personal Best Time | seconds |

### 🏃 Athletics (Track & Field)
**Running:**
| Metric | Unit |
|---|---|
| Race Time | seconds |
| Distance | meters |
| Pace | min/km |
| Split Times | seconds |

**Jumps:**
| Metric | Unit |
|---|---|
| Jump Distance / Height | meters |
| Approach Speed | km/h |

**Throws:**
| Metric | Unit |
|---|---|
| Throw Distance | meters |

### 🏀 Basketball
| Metric | Unit |
|---|---|
| Points Scored | count |
| Rebounds | count |
| Assists | count |
| Steals | count |
| Blocks | count |
| Turnovers | count |
| Free Throw % | % |
| Three Pointers Made | count |
| Minutes Played | minutes |

### 🎾 Tennis
| Metric | Unit |
|---|---|
| Aces | count |
| Double Faults | count |
| First Serve % | % |
| Winners | count |
| Unforced Errors | count |
| Break Points Won | count |
| Match Result | win/loss |
| Sets Won | count |

### 🏋️ Weightlifting / Strength Training
| Metric | Unit |
|---|---|
| Weight Lifted | kg |
| Repetitions | count |
| Sets Completed | count |
| Exercise Name | text |
| One Rep Max (1RM) | kg |

### 🥊 Boxing / Martial Arts
| Metric | Unit |
|---|---|
| Punches Landed | count |
| Punch Accuracy | % |
| Rounds Completed | count |
| Sparring Result | win/loss/draw |
| Reaction Time | seconds |
| Weight Category | kg |
| Competition Result | win/loss/draw |

### 🏐 Volleyball
| Metric | Unit |
|---|---|
| Spikes Successful | count |
| Serves Won | count |
| Blocks | count |
| Digs | count |
| Assists | count |
| Reception Accuracy | % |
| Sets Won | count |

### 🤸 Gymnastics
| Metric | Unit |
|---|---|
| Routine Score | points |
| Difficulty Score | points |
| Execution Score | points |
| Judge Score | points |
| Apparatus | text |
| Competition Placement | position |

### 🚴 Cycling
| Metric | Unit |
|---|---|
| Distance | km |
| Time | minutes |
| Average Speed | km/h |
| Max Speed | km/h |
| Elevation Gained | meters |
| Power Output | watts |
| Heart Rate (avg) | bpm |

### 🏑 Field Hockey
| Metric | Unit |
|---|---|
| Goals Scored | count |
| Assists | count |
| Shots on Goal | count |
| Tackles Won | count |
| Interceptions | count |
| Distance Covered | km |
| Saves (GK) | count |

### 🏸 Badminton
| Metric | Unit |
|---|---|
| Points Won | count |
| Smashes Successful | count |
| Service Accuracy | % |
| Rallies Won | count |
| Match Result | win/loss |
| Sets Won | count |
| Unforced Errors | count |

### 🤼 Kabaddi
| Metric | Unit |
|---|---|
| Raid Points | count |
| Tackle Points | count |
| Successful Raids | count |
| Failed Raids | count |
| Bonus Points | count |
| Super Raids | count |
| Match Result | win/loss |

### 🏃 General Fitness (All Sports)
Available to every athlete regardless of sport:

| Metric | Unit |
|---|---|
| Resting Heart Rate | bpm |
| VO2 Max | ml/kg/min |
| Body Weight | kg |
| Sprint Time (30m) | seconds |
| Beep Test Level | level |
| Push-ups (max) | count |
| Pull-ups (max) | count |
| Plank Duration | seconds |
| Vertical Jump | cm |
| Flexibility (sit & reach) | cm |

---

# PART 6 — ENROLLMENT & USER FLOWS

## 6.1 Journey 1 — New Institute Onboarding

```
Lands on Athlete 360 → Pricing Page
    ↓
Selects plan + billing cycle (monthly / annual)
    ↓
Clicks "Start 14-Day Free Trial"
    ↓
Registration form:
  - Institute name
  - Admin full name
  - Admin email
  - Password
  - Country / region
  - Primary sport (optional)
  - Agree to terms
    ↓
Stripe form: card details collected (not charged yet)
    ↓
Account created instantly
    ↓
Welcome email sent to admin:
  - Login credentials confirmed
  - Trial end date
  - Login link + quick start guide
    ↓
Admin logs in → Institute Admin Dashboard
    ↓
Onboarding checklist shown on first login:
  ☐ Complete institute profile
  ☐ Add sport categories
  ☐ Enroll first coach
  ☐ Explore dashboard
    ↓
After 14 days → Stripe charges automatically
  → 3-day warning email sent before trial ends
  → Payment success: full access continues
  → Payment fail: 7-day grace period → suspend if unresolved
```

## 6.2 Journey 2 — Coach Enrollment

```
Admin → Coach Management → "Add New Coach"
    ↓
Form: name, email, phone, sport specialty, role (Coach/Trainer), notes
    ↓
Clicks "Enroll Coach"
    ↓
System:
  → Creates coach account
  → Generates secure temporary password
  → Sends welcome email to coach:
      - Login email + temporary password
      - Login link
      - Instruction to change password on first login
  → Coach appears in admin's list immediately
    ↓
Coach logs in → prompted to set permanent password
    ↓
Coach Dashboard with onboarding prompt:
  ☐ Complete your profile
  ☐ Explore dashboard
  ☐ Enroll your first athlete
```

## 6.3 Journey 3 — Athlete Enrollment

```
Coach → My Athletes → "Enroll New Athlete"
    ↓
Form:
  - Full name
  - Email address
  - Date of birth
  - Gender
  - Sport
  - Phone (optional)
  - Parent/guardian contact (optional — for minors)
  - Emergency contact name & number
  - Medical notes (internal only — coach + admin view)
  - Profile photo (optional at enrollment)
    ↓
Clicks "Enroll Athlete"
    ↓
System:
  → Creates athlete account
  → Assigns unique Athlete ID (format: ATH-YYYY-00001)
  → Generates secure temporary password
  → Sends welcome email to athlete:
      - Name, Athlete ID
      - Login email + temporary password
      - Login link + change password instruction
  → Athlete appears in coach's list immediately
  → Institute athlete count updates in real time against plan limit
    ↓
Athlete logs in → set permanent password
    ↓
Optional: upload photo, update contact
    ↓
Athlete Dashboard
```

## 6.4 Journey 4 — Plan Upgrade

```
Admin receives 80% capacity alert (in-app + email)
    ↓
Admin → Subscription & Billing → "Upgrade Plan"
    ↓
Plan comparison shown with current plan highlighted
    ↓
Admin selects new plan → Stripe processes prorated charge
    ↓
System:
  → Plan updated instantly in database
  → JWT refreshed on next request → new features unlock immediately
  → Athlete limit increased instantly
  → Confirmation email sent to admin
  → No logout required
```

## 6.5 Supporting Flows

**Password Reset**
```
Login page → "Forgot Password" → enter email
→ Reset link emailed (expires in 1 hour)
→ Click link → set new password → redirected to login
```

**Coach Removed by Admin**
```
Admin removes coach
→ Coach account deactivated (not deleted)
→ Their athletes remain in system
→ Admin reassigns those athletes to another coach
→ All data fully preserved
```

**Athlete Suspended**
```
Coach issues suspension
→ Athlete can log in but sees suspension notice
→ Features restricted during suspension
→ Auto-reinstated on end date OR manually by coach
→ Full discipline record preserved permanently
```

**Institute Subscription Cancelled**
```
Admin cancels
→ Access continues until end of billing period
→ 7 days before expiry: reminder email
→ On expiry: dashboard locked, data preserved 60 days
→ Returns within 60 days: full data restored on resubscription
→ After 60 days: permanent deletion (warned 7 days before)
```

---

## 6.6 Automated Email Touchpoints

| Trigger | Recipient | Content |
|---|---|---|
| New institute signup | Admin | Welcome + trial details + login link |
| Trial ending in 3 days | Admin | Reminder + subscribe CTA |
| Trial expired | Admin | Access notice + subscribe CTA |
| Payment successful | Admin | Receipt + next renewal date |
| Payment failed | Admin | Alert + update card CTA |
| Grace period warning | Admin | 7-day suspension warning |
| Plan upgraded | Admin | Confirmation + new features unlocked |
| Coach enrolled | Coach | Welcome + credentials + login link |
| Athlete enrolled | Athlete | Welcome + athlete ID + credentials + login link |
| Password reset | Any user | Reset link (expires 1 hour) |
| Warning issued | Athlete | Discipline notice + reason |
| Suspension issued | Athlete + Admin | Suspension notice + duration + reason |
| Suspension lifted | Athlete | Reinstatement notice |
| Institute suspended | Admin | Suspension notice + reason |
| 80% athlete limit | Admin | Capacity alert + upgrade prompt |
| 100% athlete limit | Admin | Enrollment blocked notice |
| Data deletion warning | Admin | 7-day warning before permanent deletion |

---

# PART 7 — BUILD ORDER & STATUS

## 7.1 Phase Tracker

### ✅ Phase 1 — Planning (Complete)
- [x] Project scope, name, business model
- [x] 4 roles and full hierarchy
- [x] All 4 dashboards planned in full detail
- [x] Super Admin dashboard planned
- [x] Pricing & subscription plans finalized
- [x] Plan feature gating strategy
- [x] Badge & achievement system
- [x] Leaderboard (class + institute scope, 5 types)
- [x] Discipline system (warning → suspension → removal)
- [x] Performance metrics hybrid system
- [x] Grade system: numeric 1–10 confirmed
- [x] Sports library: 15 sports + general fitness
- [x] Events & competition calendar
- [x] All 4 enrollment journeys mapped
- [x] All email touchpoints defined
- [x] Edge cases documented
- [x] Folder structure finalized
- [x] Tech stack confirmed

### 🔲 Phase 2 — Frontend Public Pages
- [ ] Landing page
- [ ] Pricing page
- [ ] Login page
- [ ] Blog listing + individual post page
- [ ] About / Contact page

### 🔲 Phase 3 — Frontend Dashboards
- [ ] Super Admin dashboard + all sub-pages
- [ ] Institute Admin dashboard + all sub-pages
- [ ] Coach dashboard + all sub-pages
- [ ] Athlete dashboard + all sub-pages

### 🔲 Phase 4 — Backend
- [ ] Database schema (schema.sql)
- [ ] All models
- [ ] Auth system (JWT, RBAC, plan gating)
- [ ] API routes per role
- [ ] Stripe integration (subscriptions, webhooks, proration)
- [ ] Automated email system
- [ ] Badge trigger logic (badgeTrigger.js)
- [ ] Leaderboard calculation logic (leaderboardCalc.js)

### 🔲 Phase 5 — Connect & Deploy
- [ ] Frontend connected to backend API
- [ ] All role flows tested end to end
- [ ] Deploy to production server

---

# PART 8 — DECISIONS LOG & OPEN ITEMS

## 8.1 All Decisions Made (Chronological)

| Session | Decision | Detail |
|---|---|---|
| 1 | Project name | Athlete 360 |
| 1 | Scope | All sports, general |
| 1 | 4 user roles | Owner, Admin, Coach, Athlete |
| 1 | PROJECT_NOTES.md created | Claude memory continuity |
| 2 | Business model | SaaS subscription via Stripe |
| 2 | Blog | Public, SEO, owner-only publishing |
| 2 | Announcements | Internal, role-scoped |
| 2 | Owner dashboard | Private, separate from admin |
| 2 | Role hierarchy | Owner → Admin → Coach → Athlete |
| 2 | Enrollment flow direction | Admin enrolls coaches, coaches enroll athletes |
| 2 | Expandability | Modular architecture from day one |
| 2 | Frontend stack | Plain HTML / CSS / JS |
| 3 | Cross-institute coaching | Not allowed — one coach per institute only |
| 3 | Performance metrics | Hybrid system (predefined + custom per sport) |
| 3 | Events calendar | Full calendar, coach-created, athletes auto-notified |
| 3 | Discipline system | Two-level: Warning → Suspension → Admin-only removal |
| 3 | Competition panel | Past + upcoming tabs, clickable detail, winner marking |
| 3 | Fitness grading | Separate entry type within performance logging |
| 3 | Leaderboard scopes | Class Board + Institute Board, athlete toggles both |
| 3 | Leaderboard types | Competition, Performance, Attendance, Grades, Overall |
| 3 | Badge system | Hybrid: automated triggers + coach-awarded |
| 3 | Athlete medical notes | Athletes can view their own only |
| 3 | Parent role | Future expansion — security-first, invite-only |
| 4 | Super Admin dashboard | Fully planned — separate from institute admin |
| 4 | Pricing | 3 tiers: Starter $24, Pro $59, Elite $129/month |
| 4 | Annual discount | 25% off all plans when billed annually |
| 4 | Free trial | 14 days, no card required at signup |
| 4 | Grade system | Numeric 1–10, platform-wide, confirmed |
| 4 | Sports library | 15 sports + general fitness predefined |
| 4 | Badminton added | With full metrics |
| 4 | Kabaddi added | With full metrics |
| 4 | Backend stack | Node.js + Express confirmed |
| 4 | Database | PostgreSQL confirmed |
| 4 | Plan gating | Two-layer enforcement: backend + frontend |
| 4 | Core principle | Functional and reliable over feature-rich and broken |

## 8.2 Open Items (Resolve Before Starting That Phase)

| # | Item | Needed For |
|---|---|---|
| 1 | Choose email service (SendGrid / Resend / Mailgun) | Backend Phase 4 |
| 2 | Choose hosting platform (Render / Railway / VPS) | Deploy Phase 5 |
| 3 | Finalize exact leaderboard overall score weightings | Backend leaderboard logic |
| 4 | Finalize exact attendance flagging threshold % | Alerts system |
| 5 | Any additional sports to add to library? | Sports library (can add anytime) |

## 8.3 Future Expansions (Planned but Not Built Yet)

**Parent Role**
- Read-only: attendance and performance only
- Invite-only — initiated by coach or admin only, never self-registered
- Linked to one specific athlete only, revocable instantly
- Every login logged for audit trail
- GDPR compliance required for minor athlete data

**Other Future Ideas**
- Mobile app (iOS / Android)
- In-app messaging (coach ↔ athlete)
- Video upload for performance analysis
- Wearable / fitness tracker integration
- Multi-language support

---

*Document version: Final — Session 4*
*Planning status: ✅ Complete*
*Last updated: All four dashboards, pricing, sports library, enrollment flows, email touchpoints, tech stack all confirmed*
*Next action: Resolve 5 open items above → Begin Phase 2 (Frontend Public Pages) starting with Landing Page*
