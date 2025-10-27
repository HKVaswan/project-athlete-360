// prisma/seed.ts
import { PrismaClient, Role, Severity, AttendanceStatus } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Running Project Athlete 360 seed...");

  const password = "password123";
  const hash = await bcrypt.hash(password, 10);

  // ───────────────────────────────
  // 1️⃣ Create Users
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "admin@example.com",
      passwordHash: hash,
      name: "Platform Admin",
      role: Role.admin,
    },
  });

  const coach = await prisma.user.upsert({
    where: { username: "coach1" },
    update: {},
    create: {
      username: "coach1",
      email: "coach1@example.com",
      passwordHash: hash,
      name: "Head Coach",
      role: Role.coach,
    },
  });

  const athleteUser = await prisma.user.upsert({
    where: { username: "athlete1" },
    update: {},
    create: {
      username: "athlete1",
      email: "athlete1@example.com",
      passwordHash: hash,
      name: "Sample Athlete",
      role: Role.athlete,
    },
  });

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

  // ───────────────────────────────
  // 3️⃣ Link Coach to Institution
  const coachInstitution = await prisma.coachInstitution.upsert({
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

  // ───────────────────────────────
  // 4️⃣ Create Athlete Profile (pending approval)
  const athlete = await prisma.athlete.upsert({
    where: { userId: athleteUser.id },
    update: {},
    create: {
      user: { connect: { id: athleteUser.id } },
      athleteCode: "ATH-0001",
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

  // ───────────────────────────────
  // 5️⃣ Create Session & Attendance
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
      remarks: "On time and active participation",
    },
  });

  // ───────────────────────────────
  // 6️⃣ Add Assessments & Performance
  await prisma.assessment.createMany({
    data: [
      {
        athleteId: athlete.id,
        sessionId: session.id,
        metric: "100m_time",
        valueNumber: 12.4,
        valueText: "12.4s",
        notes: "Good form",
      },
      {
        athleteId: athlete.id,
        sessionId: session.id,
        metric: "vertical_jump_cm",
        valueNumber: 45,
        valueText: "45 cm",
        notes: "Decent",
      },
    ],
  });

  await prisma.performance.createMany({
    data: [
      {
        athleteId: athlete.id,
        assessmentType: "100m_time",
        score: 12.4,
        date: new Date("2025-01-01"),
      },
      {
        athleteId: athlete.id,
        assessmentType: "100m_time",
        score: 12.2,
        date: new Date("2025-02-01"),
      },
      {
        athleteId: athlete.id,
        assessmentType: "100m_time",
        score: 12.0,
        date: new Date("2025-03-01"),
      },
    ],
  });

  // ───────────────────────────────
  // 7️⃣ Add Injury Record
  await prisma.injury.create({
    data: {
      athleteId: athlete.id,
      description: "Ankle sprain during practice",
      date: new Date("2025-03-15"),
      severity: Severity.moderate,
    },
  });

  // ───────────────────────────────
  // 8️⃣ Competition Setup
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
      performanceNotes: "Excellent acceleration",
    },
  });

  // ───────────────────────────────
  // 9️⃣ Message System (Admin → Coach & Coach → Athlete)
  await prisma.message.createMany({
    data: [
      {
        senderId: admin.id,
        receiverId: coach.id,
        title: "Welcome Coach!",
        content: "Welcome to National Sports Academy’s digital platform.",
      },
      {
        senderId: coach.id,
        receiverId: athleteUser.id,
        title: "Your First Training Session",
        content: "Report to ground at 7 AM sharp for sprint training.",
      },
    ],
  });

  // ───────────────────────────────
  // 🔟 Resource Sharing
  const resource = await prisma.resource.create({
    data: {
      uploaderId: coach.id,
      institutionId: institution.id,
      title: "Sprint Techniques PDF",
      description: "Guide for improving 100m sprint time.",
      type: "pdf",
      fileUrl: "https://example.com/sprint_guide.pdf",
    },
  });

  await prisma.resourceShare.create({
    data: {
      resourceId: resource.id,
      receiverId: athleteUser.id,
    },
  });

  console.log("✅ Seed finished successfully!");
  console.log("Login Credentials:");
  console.log("🔹 Admin → admin / password123");
  console.log("🔹 Coach → coach1 / password123");
  console.log("🔹 Athlete → athlete1 / password123");
  console.log("🏫 Institution: National Sports Academy (Code: INST-001)");
}

main()
  .catch((e) => {
    console.error("❌ Seeding error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });