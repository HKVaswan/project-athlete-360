// prisma/seed.ts
import { PrismaClient, Role, Severity } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  console.log("Running seed...");

  const pw = "password123";
  const hash = await bcrypt.hash(pw, 10);

  // ---------- Create Users ----------
  const admin = await prisma.user.upsert({
    where: { username: "admin" },
    update: {},
    create: {
      username: "admin",
      email: "admin@example.com",
      passwordHash: hash,
      name: "Platform Admin",
      role: Role.admin
    }
  });

  const coach = await prisma.user.upsert({
    where: { username: "coach1" },
    update: {},
    create: {
      username: "coach1",
      email: "coach1@example.com",
      passwordHash: hash,
      name: "Head Coach",
      role: Role.coach
    }
  });

  const athleteUser = await prisma.user.upsert({
    where: { username: "athlete1" },
    update: {},
    create: {
      username: "athlete1",
      email: "athlete1@example.com",
      passwordHash: hash,
      name: "Sample Athlete",
      role: Role.athlete
    }
  });

  // ---------- Create Athlete Profile ----------
  const athlete = await prisma.athlete.upsert({
    where: { userId: athleteUser.id },
    update: {},
    create: {
      user: { connect: { id: athleteUser.id } }, // Link User relation
      athleteCode: "ATH-0001",                  // Required unique code
      name: "Sample Athlete",
      dob: new Date("2002-01-01"),
      sport: "Athletics",
      gender: "male",
      contactInfo: "athlete1@example.com"
    }
  });

  // ---------- Create Sessions ----------
  const session1 = await prisma.session.create({
    data: {
      name: "Speed Training - Day 1",
      coachId: coach.id,
      date: new Date(),
      duration: 60,
      notes: "Warmup + sprint drills"
    }
  });

  // ---------- Create Assessments ----------
  await prisma.assessment.createMany({
    data: [
      {
        athleteId: athlete.id,
        sessionId: session1.id,
        metric: "100m_time",
        valueNumber: 12.4,
        valueText: "12.4s",
        notes: "Good form"
      },
      {
        athleteId: athlete.id,
        sessionId: session1.id,
        metric: "vertical_jump_cm",
        valueNumber: 45,
        valueText: "45 cm",
        notes: "Decent"
      }
    ]
  });

  // ---------- Create Performance Records ----------
  await prisma.performance.createMany({
    data: [
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.4, date: new Date("2025-01-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.2, date: new Date("2025-02-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 12.0, date: new Date("2025-03-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 11.9, date: new Date("2025-04-01") },
      { athleteId: athlete.id, assessmentType: "100m_time", score: 11.8, date: new Date("2025-05-01") }
    ]
  });

  // ---------- Create Injury ----------
  await prisma.injury.create({
    data: {
      athleteId: athlete.id,
      description: "Ankle sprain during practice",
      date: new Date("2025-03-15"),
      severity: Severity.moderate
    }
  });

  console.log("Seed finished. Credentials:");
  console.log("admin / password123");
  console.log("coach1 / password123");
  console.log("athlete1 / password123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
