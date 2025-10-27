// prisma/seed.ts
import {
  PrismaClient,
  Role,
  Severity,
  AttendanceStatus,
  InviteStatus,
  ResourceVisibility,
} from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

// ───────────────────────────────
// 🔧 Helpers
const generateCode = (prefix: string) =>
  `${prefix}-${Math.floor(1000 + Math.random() * 9000)}`;
const generateInvitationCode = () =>
  `INV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

async function main() {
  console.log("\n🌱 Starting Project Athlete 360 Database Seed...");
  console.log("───────────────────────────────────────────────");

  const password = "password123";
  const hash = await bcrypt.hash(password, 10);

  // ───────────────────────────────
  // 1️⃣ Create Users: Admin, Coach, Athlete
  const [admin, coach, athleteUser] = await Promise.all([
    prisma.user.upsert({
      where: { username: "admin" },
      update: {},
      create: {
        username: "admin",
        email: "admin@example.com",
        passwordHash: hash,
        name: "Platform Admin",
        role: Role.admin,
      },
    }),
    prisma.user.upsert({
      where: { username: "coach1" },
      update: {},
      create: {
        username: "coach1",
        email: "coach1@example.com",
        passwordHash: hash,
        name: "Head Coach",
        role: Role.coach,
        coachCode: generateCode("COACH"),
      },
    }),
    prisma.user.upsert({
      where: { username: "athlete1" },
      update: {},
      create: {
        username: "athlete1",
        email: "athlete1@example.com",
        passwordHash: hash,
        name: "Sample Athlete",
        role: Role.athlete,
      },
    }),
  ]);

  console.log("✅ Users created:", { admin: admin.username, coach: coach.username });

  // ───────────────────────────────
  // 2️⃣ Create Institution
  const institution = await prisma.institution.upsert({
    where: { code: "INST-001" },
    update: {},
    create: {
      name: "National Sports Academy",
      code: "INST-001",
      address: "Sector 21, New Delhi",
      contactEmail: "info@nsa.in",
      contactNumber: "+91-9999999999",
      admin: { connect: { id: admin.id } },
    },
  });

  console.log("🏫 Institution created:", institution.name);

  // ───────────────────────────────
  // 3️⃣ Link Coach to Institution
  await prisma.coachInstitution.upsert({
    where: {
      coachId_institutionId: {
        coachId: coach.id,
        institutionId: institution.id,
      },
    },
    update: {},
    create: {
      coach: { connect: { id: coach.id } },
      institution: { connect: { id: institution.id } },
    },
  });

  console.log("👨‍🏫 Coach linked to institution");

  // ───────────────────────────────
  // 4️⃣ Create Athlete Profile
  const athlete = await prisma.athlete.upsert({
    where: { userId: athleteUser.id },
    update: {},
    create: {
      user: { connect: { id: athleteUser.id } },
      athleteCode: generateCode("ATH"),
      name: "Sample Athlete",
      dob: new Date("2002-01-01"),
      sport: "Athletics",
      gender: "male",
      contactInfo: "athlete1@example.com",
      institution: { connect: { id: institution.id } },
      approved: true,
      approvedBy: coach.id,
    },
  });

  console.log("🏃 Athlete profile created and approved");

  // ───────────────────────────────
  // 5️⃣ Training Session & Attendance
  const session = await prisma.session.create({
    data: {
      name: "Speed Training - Day 1",
      coachId: coach.id,
      date: new Date(),
      duration: 60,
      notes: "Warmup + sprint drills",
      institutionId: institution.id,
      athletes: { connect: [{ id: athlete.id }] },
    },
  });

  await prisma.attendance.create({
    data: {
      sessionId: session.id,
      athleteId: athlete.id,
      status: AttendanceStatus.present,
      remarks: "On time and fully engaged",
    },
  });

  console.log("🗓️ Session & attendance data seeded");

  // ───────────────────────────────
  // 6️⃣ Assessments & Performance Metrics
  await prisma.assessment.createMany({
    data: [
      {
        athleteId: athlete.id,
        sessionId: session.id,
        metric: "100m_time",
        valueNumber: 12.4,
        valueText: "12.4s",
        notes: "Good form and drive phase",
      },
      {
        athleteId: athlete.id,
        sessionId: session.id,
        metric: "vertical_jump_cm",
        valueNumber: 45,
        valueText: "45 cm",
        notes: "Strong lower body",
      },
    ],
  });

  await prisma.performance.createMany({
    data: [
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.4, date: new Date("2025-01-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.2, date: new Date("2025-02-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.0, date: new Date("2025-03-01") },
    ],
  });

  console.log("📊 Assessments & performance metrics seeded");

  // ───────────────────────────────
  // 7️⃣ Injury Record
  await prisma.injury.create({
    data: {
      athleteId: athlete.id,
      description: "Ankle sprain during practice",
      date: new Date("2025-03-15"),
      severity: Severity.moderate,
    },
  });

  console.log("🩹 Injury record added");

  // ───────────────────────────────
  // 8️⃣ Competition Data
  const competition = await prisma.competition.create({
    data: {
      name: "National Sprint Championship",
      location: "Delhi Stadium",
      startDate: new Date("2025-04-10"),
      endDate: new Date("2025-04-12"),
      institutionId: institution.id,
    },
  });

  await prisma.athleteCompetition.create({
    data: {
      athleteId: athlete.id,
      competitionId: competition.id,
      result: "Gold",
      position: 1,
      performanceNotes: "Excellent start and top speed consistency",
    },
  });

  console.log("🏆 Competition data seeded");

  // ───────────────────────────────
  // 9️⃣ Message System
  await prisma.message.createMany({
    data: [
      {
        senderId: admin.id,
        receiverId: coach.id,
        title: "Welcome Coach!",
        content:
          "Welcome to National Sports Academy’s digital platform. Start managing your athletes efficiently!",
      },
      {
        senderId: coach.id,
        receiverId: athleteUser.id,
        title: "Your First Session",
        content: "Report to the main ground at 7 AM sharp for sprint training.",
      },
    ],
  });

  console.log("💬 Messages seeded");

  // ───────────────────────────────
  // 🔟 Resource Sharing
  const resource = await prisma.resource.create({
    data: {
      uploaderId: coach.id,
      institutionId: institution.id,
      title: "Sprint Techniques PDF",
      description: "Comprehensive guide to sprint mechanics and form correction.",
      type: "pdf",
      fileUrl: "https://example.com/sprint_guide.pdf",
      visibility: ResourceVisibility.institution,
    },
  });

  await prisma.resourceShare.create({
    data: {
      resourceId: resource.id,
      receiverId: athleteUser.id,
    },
  });

  console.log("📂 Resource sharing setup complete");

  // ───────────────────────────────
  // 1️⃣1️⃣ Invitation System Example
  await prisma.invitation.create({
    data: {
      code: generateInvitationCode(),
      senderId: coach.id,
      receiverEmail: "newathlete@example.com",
      role: Role.athlete,
      institutionId: institution.id,
      status: InviteStatus.pending,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  console.log("✉️  Invitation seeded successfully");

  // ───────────────────────────────
  console.log("\n✅ Seed completed successfully!");
  console.log("───────────────────────────────────────────────");
  console.log(`🏫 Institution: ${institution.name} (Code: ${institution.code})`);
  console.log(`👨‍💼 Admin → admin / ${password}`);
  console.log(`👨‍🏫 Coach → coach1 / ${password}`);
  console.log(`🏃 Athlete → athlete1 / ${password}`);
  console.log("───────────────────────────────────────────────\n");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });